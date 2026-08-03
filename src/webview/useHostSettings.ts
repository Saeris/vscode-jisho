/**
 * Host settings that components RENDER from, as opposed to the ones that land as CSS variables.
 *
 * Most settings never reach React: `applySettings` writes them to the root as custom properties and
 * the stylesheet does the rest, which is why the panel restyles with no re-render. A few are
 * different because they change what is RENDERED, not how it looks: `tagLabels` swaps 名詞 for
 * "noun", and `colorExamples` decides whether a word carries a `data-pos` attribute at all. Neither
 * is expressible in CSS, so a component has to read them.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the settings snapshot is an external
 * store that can change between render and subscribe, and this is the hook React provides for
 * exactly that, without the tearing an effect-based mirror allows.
 */
import { useSyncExternalStore } from "react";
import { onHostSettings } from "./bridge";
import type { HostSettings } from "../shared/messages";

type Settings = HostSettings["settings"];

/**
 * Defaults matching package.json's, for the window before the host's first snapshot arrives — a
 * few milliseconds in which a word page can already be rendering from cache.
 */
const DEFAULTS: Settings = {
  textScale: 1.08,
  guideStyle: "offset",
  palette: "standard",
  tagLabels: "english",
  colorExamples: true
};

let current: Settings = DEFAULTS;
const listeners = new Set<() => void>();

// Subscribed once at module scope, not per component: the host pushes one snapshot to the whole
// webview, and every consumer reads the same object identity so `getSnapshot` stays stable.
onHostSettings((settings) => {
  current = settings;
  for (const listener of listeners) listener();
});

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The current host settings, re-rendering the caller when the user edits them. */
export const useHostSettings = (): Settings =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULTS
  );
