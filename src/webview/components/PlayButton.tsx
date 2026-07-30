import { useEffect, useMemo, useState } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { isSpeechAvailable, speak, SpeechSequence } from "../speech";
import styles from "./PlayButton.module.css";

/**
 * Whether Japanese TTS is usable; false until the voice check resolves.
 *
 * A query rather than a useState/useEffect pair: it is async state, which CONVENTIONS.md assigns to
 * TanStack Query, and the effect version re-ran the OS voice check once per mounted play button (a
 * kanji page has several). The answer depends on installed OS voices and so cannot change within a
 * session — `staleTime: Infinity` makes it happen once and be shared.
 *
 * Colocated here rather than in `queries.ts`: that module is the BRIDGE-backed query registry (a
 * request type, a bridge function, a query), and this is a browser capability check. Putting it there
 * also broke every spec that mocks `../queries` wholesale, which is how the distinction surfaced.
 */
const speechAvailableQuery = queryOptions({
  queryKey: ["speechAvailable"],
  queryFn: isSpeechAvailable,
  staleTime: Infinity
});

export const useSpeechAvailable = (): boolean =>
  useQuery(speechAvailableQuery).data ?? false;

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
