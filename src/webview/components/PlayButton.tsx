import { useEffect, useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { isSpeechAvailable, speak, SpeechSequence } from "../speech";
import styles from "./PlayButton.module.css";

/** Whether Japanese TTS is usable; false until the async voice check resolves. */
export const useSpeechAvailable = (): boolean => {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    const check = async (): Promise<void> => {
      const ok = await isSpeechAvailable();
      if (active) setAvailable(ok);
    };
    void check();
    return (): void => {
      active = false;
    };
  }, []);
  return available;
};

interface PlayButtonProps {
  /** The reading to speak. */
  text: string;
  label?: string;
}

/**
 * A speaker button that reads one term aloud. Renders nothing when Japanese TTS is unavailable,
 * so callers don't need to guard.
 */
export const PlayButton = ({
  text,
  label
}: PlayButtonProps): React.ReactElement | null => {
  const available = useSpeechAvailable();
  if (!available) return null;
  return (
    <Button
      className={styles.play}
      onPress={() => void speak(text)}
      aria-label={label ?? `Play pronunciation of ${text}`}
    >
      🔊
    </Button>
  );
};

interface SequencePlayButtonProps {
  /** The readings to read in turn (e.g. a kanji's on-readings). */
  readings: string[];
  label: string;
}

/**
 * Reads a list of readings aloud in sequence, with pauses, and is cancellable — tap to play,
 * tap again (or it finishes) to stop. Renders nothing when TTS is unavailable or the list is empty.
 */
export const SequencePlayButton = ({
  readings,
  label
}: SequencePlayButtonProps): React.ReactElement | null => {
  const available = useSpeechAvailable();
  const [playing, setPlaying] = useState(false);
  const sequence = useMemo(() => new SpeechSequence(setPlaying), []);

  // Stop any in-progress playback if this button unmounts (e.g. navigating away).
  useEffect(() => (): void => sequence.cancel(), [sequence]);

  if (!available || readings.length === 0) return null;
  return (
    <Button
      className={playing ? `${styles.play} ${styles.playing}` : styles.play}
      onPress={() =>
        playing ? sequence.cancel() : void sequence.play(readings)
      }
      aria-label={playing ? `Stop ${label}` : `Play ${label} readings`}
    >
      {playing ? "⏹" : "🔊"}
    </Button>
  );
};
