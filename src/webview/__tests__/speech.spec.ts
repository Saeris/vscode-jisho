import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vite-plus/test";

/**
 * Speech, against a fake `speechSynthesis`: real synthesis depends on the voices the machine has, so
 * a real one would test the runner's audio setup instead of how this module shares the queue.
 *
 * The fake behaves like the real engines in the one way that matters here: `cancel()` ENDS the
 * utterance being spoken, firing its `end` event — which is how an interrupted sequence used to
 * carry on to its next reading.
 */
class FakeUtterance {
  voice: unknown;
  lang = "";
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

class FakeSynth extends EventTarget {
  voices = [{ lang: "ja-JP", name: "Kyoko" }];
  spoken: string[] = [];
  /** Off for a test of an engine that never reports the end of a reading. */
  endsOnCancel = true;
  #current: FakeUtterance | undefined;

  getVoices(): typeof this.voices {
    return this.voices;
  }

  speak(utterance: FakeUtterance): void {
    this.spoken.push(utterance.text);
    this.#current = utterance;
  }

  cancel(): void {
    const current = this.#current;
    this.#current = undefined;
    if (this.endsOnCancel) current?.onend?.();
  }

  /** The reading being spoken finishes on its own. */
  finish(): void {
    const current = this.#current;
    this.#current = undefined;
    current?.onend?.();
  }
}

const synth = new FakeSynth();
// Installed BEFORE the module loads: it takes `window.speechSynthesis` once, at import.
Object.defineProperty(window, "speechSynthesis", {
  configurable: true,
  value: synth
});
// Not `vi.stubGlobal`: the config restores stubbed globals between tests, and this must last for
// the whole file. The real constructor refuses a voice that is not a real `SpeechSynthesisVoice`.
Object.defineProperty(window, "SpeechSynthesisUtterance", {
  configurable: true,
  value: FakeUtterance
});

const { SpeechSequence, isSpeechAvailable, onVoicesChanged, speak } =
  await import("../speech");

const japanese = [{ lang: "ja-JP", name: "Kyoko" }];

describe("speech", () => {
  beforeEach(() => {
    synth.voices = japanese;
    synth.spoken = [];
    synth.endsOnCancel = true;
    // Forget the voice the last test cached.
    synth.dispatchEvent(new Event("voiceschanged"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops a sequence when a single word is spoken over it", async () => {
    // WHY (audit SM-7): `speak()` cleared the queue, which ended the sequence's current reading — and
    // the sequence took that as "done" and went on to its NEXT reading, still showing Stop.
    const states: boolean[] = [];
    const sequence = new SpeechSequence((playing) => states.push(playing));
    const played = sequence.play(["いち", "に", "さん"]);
    await vi.waitFor(() => expect(synth.spoken).toEqual(["いち"]));

    await speak("ほか");
    await played;
    // Past the 250 ms gap a sequence leaves between readings: nothing more of it may play.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(synth.spoken).toEqual(["いち", "ほか"]);
    expect(states.at(-1)).toBe(false);
  });

  it("stops one sequence when another starts", async () => {
    // WHY: two Stop buttons can be on screen (a kanji's on- and kun-readings). Starting one must
    // stop the other, and the other must stop showing Stop.
    const first: boolean[] = [];
    const a = new SpeechSequence((playing) => first.push(playing));
    const b = new SpeechSequence(() => undefined);
    const playedA = a.play(["いち", "に"]);
    await vi.waitFor(() => expect(synth.spoken).toEqual(["いち"]));

    void b.play(["ア"]);
    await playedA;
    await vi.waitFor(() => expect(synth.spoken).toEqual(["いち", "ア"]));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(synth.spoken).toEqual(["いち", "ア"]);
    expect(first.at(-1)).toBe(false);
    b.cancel();
  });

  it("notices voices that arrive after the first check", async () => {
    // WHY (audit SM-7): a first check that found no Japanese voice cached that answer for the
    // session, so every play button stayed hidden — even once the voices had loaded.
    let changes = 0;
    const unsubscribe = onVoicesChanged(() => {
      changes++;
    });
    synth.voices = [];
    synth.dispatchEvent(new Event("voiceschanged"));
    const first = isSpeechAvailable();
    // Still none when the list next changes.
    synth.dispatchEvent(new Event("voiceschanged"));
    await expect(first).resolves.toBe(false);

    synth.voices = japanese;
    synth.dispatchEvent(new Event("voiceschanged"));
    await expect(isSpeechAvailable()).resolves.toBe(true);
    expect(changes).toBeGreaterThan(0);
    unsubscribe();
  });

  it("does not wait forever for a reading the engine never ends", async () => {
    // WHY: engines do not always fire `end` (Chromium drops it for interrupted or long speech). A
    // sequence waiting for it kept showing Stop, and nothing could clear it but another play.
    vi.useFakeTimers();
    synth.endsOnCancel = false;
    const states: boolean[] = [];
    const sequence = new SpeechSequence((playing) => states.push(playing));
    const played = sequence.play(["あ"]);
    await vi.advanceTimersByTimeAsync(5000);
    await played;
    expect(states).toEqual([true, false]);
  });
});
