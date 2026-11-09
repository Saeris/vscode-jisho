/**
 * Japanese text-to-speech via the Web Speech API. Selects a `ja-JP` voice explicitly (a naive
 * `speak()` can read kanji with a Chinese voice), prefers higher-quality voices by name where the
 * OS offers them (see PREFERRED_VOICE_HINTS), and supports a cancellable sequence for reading a
 * list of readings.
 *
 * All webview-side; no host or data involvement. Degrades gracefully — `isSpeechAvailable()`
 * returns false when the runtime has no Japanese voice, so callers can hide their play controls.
 *
 * This module is the ONE owner of `speechSynthesis`, which is a single queue for the whole page.
 * Anything that speaks goes through it, so starting new speech can stop everything else that is
 * playing — see `takeQueue`.
 */

import { lazy } from "../shared/lazy";

const synth: SpeechSynthesis | undefined =
  typeof window !== "undefined" ? window.speechSynthesis : undefined;

/**
 * Higher-quality Japanese voices, most-preferred first, matched by substring against the voice
 * name. Chromium/Electron's Web Speech API only exposes OS voices, and quality/availability vary:
 *
 *  - macOS ships "Kyoko" — the Enhanced/Premium variants (downloadable in System Settings) sound
 *    markedly better than the compact default.
 *  - Windows exposes only classic **SAPI5** voices here (Ayumi/Haruka/Ichiro/Sayaka) — the modern
 *    "Natural"/OneCore neural voices (Nanami, Keita) are NOT reachable via this API, a known
 *    Chromium limitation. Among the SAPI5 set we just pick a sensible, consistent default rather
 *    than "whatever the OS lists first" (which was the robotic-sounding Ayumi).
 *
 * The `Natural`/`Neural`/`Online` hints stay in case a runtime ever does expose them.
 */
const PREFERRED_VOICE_HINTS = [
  "Natural",
  "Neural",
  "Online",
  "Premium",
  "Enhanced",
  "Kyoko", // macOS
  "O-Ren", // macOS (also ja)
  "Sayaka", // Windows SAPI5 — a reasonable default among the four
  "Haruka" // Windows SAPI5
];

/**
 * getVoices() populates asynchronously; resolve once it's non-empty (or immediately if already
 * loaded, or after `voiceschanged`, with a short timeout so we never hang). Voices that arrive after
 * the timeout are picked up by the `voiceschanged` listener below.
 */
const loadVoices = async (): Promise<SpeechSynthesisVoice[]> => {
  if (!synth) return [];
  const now = synth.getVoices();
  if (now.length > 0) return now;
  return new Promise((resolve) => {
    const done = (): void => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1000);
  });
};

/** Told when the voices change, so a play control hidden for want of a voice can reappear. */
const voiceListeners = new Set<() => void>();

/**
 * Read the voices again whenever the OS list changes.
 *
 * The answer used to be cached for the session, `null` included: a first check that found no voice
 * in its one second — a slow voice service, a voice pack installed later — hid every play button
 * until VS Code restarted (audit SM-7).
 */
synth?.addEventListener("voiceschanged", () => {
  voice.reset();
  for (const listener of voiceListeners) listener();
});

/** Run `listener` whenever the available voices change. Returns the unsubscribe. */
export const onVoicesChanged = (listener: () => void): (() => void) => {
  voiceListeners.add(listener);
  return (): void => {
    voiceListeners.delete(listener);
  };
};

/** The preferred Japanese voice, or null if none exists. */
const findJapaneseVoice = async (): Promise<SpeechSynthesisVoice | null> => {
  const voices = await loadVoices();
  const ja = voices.filter((v) => v.lang.toLowerCase().startsWith("ja"));
  // Walk the preference hints in order; the first hint that matches a voice name wins. Falls back
  // to the first available Japanese voice. (`localService` is not a useful quality signal in
  // Chromium/Electron — all OS voices report true — so we go by name.)
  let preferred: SpeechSynthesisVoice | undefined;
  for (const hint of PREFERRED_VOICE_HINTS) {
    preferred = ja.find((v) => v.name.includes(hint));
    if (preferred) break;
  }
  return preferred ?? (ja.length > 0 ? ja[0] : null);
};

/**
 * The voice, found once and kept — `null` included — until the OS voices change, when the listener
 * above resets it. Finding it cannot fail, only find nothing, so "keep" only ever keeps an answer.
 */
const voice = lazy(findJapaneseVoice, { onFailure: "keep" });

const japaneseVoice = async (): Promise<SpeechSynthesisVoice | null> =>
  voice.get();

/** Whether Japanese TTS is usable in this runtime (a ja voice exists). */
export const isSpeechAvailable = async (): Promise<boolean> =>
  (await japaneseVoice()) !== null;

const utter = (
  text: string,
  voice: SpeechSynthesisVoice
): SpeechSynthesisUtterance => {
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = "ja-JP"; // belt-and-braces: force Japanese even if the voice's lang is generic
  return u;
};

/** Every sequence that is playing. */
const playing = new Set<SpeechSequence>();

/**
 * Take the page's speech queue: stop every sequence still playing, then clear the queue.
 *
 * A sequence tracked only its own token. When `speak()` or another sequence cleared the queue, the
 * current reading ended, the sequence's wait for it resolved, and it went on to its NEXT reading,
 * still reporting "playing" (audit SM-7). Cancelling it through its own token is what ends it.
 */
const takeQueue = (owner?: SpeechSequence): void => {
  for (const sequence of playing) if (sequence !== owner) sequence.cancel();
  synth?.cancel();
};

/** Speak one reading. Stops anything currently playing first, sequences included. */
export const speak = async (text: string): Promise<void> => {
  const voice = await japaneseVoice();
  if (!synth || !voice) return;
  takeQueue();
  synth.speak(utter(text, voice));
};

/**
 * How long one reading may take before a sequence gives up waiting for its `end` event.
 *
 * Engines do not always fire it — Chromium is known to drop it for interrupted or long utterances —
 * and a sequence waiting forever keeps reporting "playing". Generous: Japanese runs at about eight
 * morae a second, and this allows two characters a second plus two seconds.
 */
const readingLimitMs = (text: string): number => 2000 + text.length * 500;

/**
 * A cancellable player for a list of readings (kanji on/kun/nanori). Reads each in turn with a
 * short gap; `cancel()` stops immediately. `onStateChange` reports playing/idle so the UI can
 * toggle a stop affordance. Only one sequence plays at a time per player.
 */
export class SpeechSequence {
  #token = 0;
  #onStateChange: (playing: boolean) => void;

  constructor(onStateChange: (playing: boolean) => void) {
    this.#onStateChange = onStateChange;
  }

  async play(readings: string[]): Promise<void> {
    const voice = await japaneseVoice();
    if (!synth || !voice || readings.length === 0) return;
    const token = ++this.#token;
    takeQueue(this);
    playing.add(this);
    this.#onStateChange(true);
    for (const reading of readings) {
      if (token !== this.#token) return; // superseded/cancelled
      await this.#speakOne(utter(reading, voice), token);
      if (token !== this.#token) return;
      await delay(250);
    }
    if (token === this.#token) {
      playing.delete(this);
      this.#onStateChange(false);
    }
  }

  cancel(): void {
    this.#token++;
    playing.delete(this);
    synth?.cancel();
    this.#onStateChange(false);
  }

  async #speakOne(u: SpeechSynthesisUtterance, token: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(limit);
        resolve();
      };
      const limit = setTimeout(done, readingLimitMs(u.text));
      u.onend = done;
      u.onerror = done;
      if (token !== this.#token) {
        done();
        return;
      }
      synth?.speak(u);
    });
  }
}

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
