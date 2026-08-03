/**
 * Drive the webview's settings store the way the HOST does — by posting the snapshot the extension
 * posts — rather than by mocking `useHostSettings`.
 *
 * That keeps the component tests honest about the whole path (package.json → host snapshot → bridge
 * → store → component), which is where a regression would actually land: a mocked hook still passes
 * if the bridge stops delivering settings at all.
 *
 * Shared because more than one component now reads settings, and each was otherwise going to
 * reinvent the `postMessage` + macrotask-flush dance.
 */
import type { HostSettings } from "../../shared/messages";

/** Matches package.json's defaults, so a test only states the setting it is actually exercising. */
const DEFAULTS: HostSettings["settings"] = {
  textScale: 1.08,
  guideStyle: "offset",
  palette: "standard",
  tagLabels: "english",
  colorExamples: true
};

/**
 * Push a settings snapshot and wait for it to land.
 *
 * The store is module scope — shared across cases in a file — so a test that changes a setting must
 * reset it afterwards; `afterEach(() => setHostSettings())` restores the defaults.
 */
export const setHostSettings = async (
  overrides: Partial<HostSettings["settings"]> = {}
): Promise<void> => {
  window.postMessage(
    {
      type: "hostSettings",
      settings: { ...DEFAULTS, ...overrides }
    } satisfies HostSettings,
    "*"
  );
  // `postMessage` delivers on a macrotask, so the store has not updated yet when this returns.
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
};
