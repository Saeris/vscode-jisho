/**
 * Japanese text-to-speech via the Web Speech API. Selects a `ja-JP` voice explicitly (a naive
 * `speak()` can read kanji with a Chinese voice), prefers higher-quality "natural"/neural voices
 * where the OS offers them, and supports a cancellable sequence for reading a list of readings.
 *
 * All webview-side; no host or data involvement. Degrades gracefully — `isSpeechAvailable()`
 * returns false when the runtime has no Japanese voice, so callers can hide their play controls.
 */

const synth: SpeechSynthesis | undefined =
  typeof window !== "undefined" ? window.speechSynthesis : undefined;

/** Voice names that tend to mark higher-quality synthesis across platforms. */
const NATURAL_HINT = /natural|neural|premium|enhanced|siri/i;

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

/** The preferred Japanese voice (natural-quality first), or null if none exists. Cached. */
const japaneseVoice = async (): Promise<SpeechSynthesisVoice | null> => {
  if (cachedJa !== undefined) return cachedJa;
  const voices = await loadVoices();
  const ja = voices.filter((v) => v.lang.toLowerCase().startsWith("ja"));
  // Prefer non-local (cloud/neural) voices, then name-hinted natural ones, then any ja voice.
  const preferred =
    ja.find((v) => !v.localService) ??
    ja.find((v) => NATURAL_HINT.test(v.name));
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
