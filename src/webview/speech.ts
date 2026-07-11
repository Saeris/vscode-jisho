/**
 * Japanese text-to-speech via the Web Speech API. Selects a `ja-JP` voice explicitly (a naive
 * `speak()` can read kanji with a Chinese voice), prefers higher-quality voices by name where the
 * OS offers them (see PREFERRED_VOICE_HINTS), and supports a cancellable sequence for reading a
 * list of readings.
 *
 * All webview-side; no host or data involvement. Degrades gracefully — `isSpeechAvailable()`
 * returns false when the runtime has no Japanese voice, so callers can hide their play controls.
 */

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
 * loaded, or after `voiceschanged`, with a short timeout so we never hang).
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

let cachedJa: SpeechSynthesisVoice | null | undefined;

/** The preferred Japanese voice, or null if none exists. Cached. */
const japaneseVoice = async (): Promise<SpeechSynthesisVoice | null> => {
  if (cachedJa !== undefined) return cachedJa;
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
  cachedJa = preferred ?? (ja.length > 0 ? ja[0] : null);
  return cachedJa;
};

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

/** Cancel any in-progress speech. */
export const cancelSpeech = (): void => synth?.cancel();

/** Speak one reading. Cancels anything currently playing first. */
export const speak = async (text: string): Promise<void> => {
  const voice = await japaneseVoice();
  if (!synth || !voice) return;
  synth.cancel();
  synth.speak(utter(text, voice));
};

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
    synth.cancel();
    this.#onStateChange(true);
    for (const reading of readings) {
      if (token !== this.#token) return; // superseded/cancelled
      await this.#speakOne(utter(reading, voice), token);
      if (token !== this.#token) return;
      await delay(250);
    }
    if (token === this.#token) this.#onStateChange(false);
  }

  cancel(): void {
    this.#token++;
    synth?.cancel();
    this.#onStateChange(false);
  }

  async #speakOne(u: SpeechSynthesisUtterance, token: number): Promise<void> {
    return new Promise((resolve) => {
      u.onend = (): void => resolve();
      u.onerror = (): void => resolve();
      if (token !== this.#token) {
        resolve();
        return;
      }
      synth?.speak(u);
    });
  }
}

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
