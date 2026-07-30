import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

// `speech.ts` reaches for window.speechSynthesis. Chromium HAS it, which is the reason to mock it
// rather than not: real synthesis depends on which voices the machine has installed, so these tests
// would assert the runner's audio configuration instead of the BUTTON's decisions.
const isSpeechAvailable = vi.fn<() => Promise<boolean>>();
const speak = vi.fn<(text: string) => Promise<void>>();
const play = vi.fn<(readings: string[]) => Promise<void>>();
const cancel = vi.fn<() => void>();

vi.mock("../../speech", () => ({
  isSpeechAvailable: async () => isSpeechAvailable(),
  speak: async (text: string) => speak(text),
  SpeechSequence: class {
    constructor(private readonly onStateChange: (playing: boolean) => void) {}
    async play(readings: string[]): Promise<void> {
      this.onStateChange(true);
      await play(readings);
    }
    cancel(): void {
      this.onStateChange(false);
      cancel();
    }
  }
}));

const { PlayButton, SequencePlayButton } = await import("../PlayButton");

/**
 * Availability is a QUERY now (see queries.ts), so these need a client. A fresh one per render keeps
 * the cached answer from leaking between tests that set up different availability.
 */
const render = (ui: React.ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } }
        })
      }
    >
      {ui}
    </QueryClientProvider>
  );

describe("playButton", () => {
  it("renders nothing until the voice check resolves", async () => {
    // WHY: the check is async, and a speaker button that appears and then vanishes is worse than one
    // that arrives late. Callers rely on this so they do not each have to guard.
    isSpeechAvailable.mockResolvedValue(false);
    render(<PlayButton text="たべる" />);
    await waitFor(() => {
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  it("speaks the reading it was given once TTS is available", async () => {
    isSpeechAvailable.mockResolvedValue(true);
    render(<PlayButton text="たべる" />);
    const button = await screen.findByRole("button", {
      name: "Play pronunciation of たべる"
    });
    await userEvent.click(button);
    expect(speak).toHaveBeenCalledWith("たべる");
  });
});

describe("sequencePlayButton", () => {
  it("renders nothing for an empty reading list", async () => {
    // WHY: a kanji with no on-readings would otherwise get a button that plays silence.
    isSpeechAvailable.mockResolvedValue(true);
    render(<SequencePlayButton readings={[]} label="on" />);
    await waitFor(() => {
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  it("toggles to a stop control while playing, and cancels on a second press", async () => {
    // WHY: a kanji's readings take seconds to read out, so the user needs a way to stop that is the
    // same control they started with — and the label has to say which action it now performs, or a
    // screen-reader user cannot tell playback is in progress.
    isSpeechAvailable.mockResolvedValue(true);
    play.mockResolvedValue();
    render(<SequencePlayButton readings={["カ", "ケ"]} label="on" />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Play on readings" })
    );
    expect(play).toHaveBeenCalledWith(["カ", "ケ"]);

    const stop = await screen.findByRole("button", { name: "Stop on" });
    await userEvent.click(stop);
    expect(cancel).toHaveBeenCalledWith();
    await expect(
      screen.findByRole("button", { name: "Play on readings" })
    ).resolves.toBeDefined();
  });

  it("cancels playback when it unmounts", async () => {
    // WHY: navigating away mid-sequence must not leave the synthesiser reading a page the user has
    // left — the audio would outlive the view that started it.
    isSpeechAvailable.mockResolvedValue(true);
    play.mockResolvedValue();
    const { unmount } = render(
      <SequencePlayButton readings={["カ"]} label="on" />
    );
    await screen.findByRole("button", { name: "Play on readings" });
    cancel.mockClear();
    unmount();
    expect(cancel).toHaveBeenCalledWith();
  });
});
