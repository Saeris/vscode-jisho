import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

/**
 * Widen the `findBy*` budget from Testing Library's 1s default.
 *
 * Every view spec awaits a TanStack query resolving, and 1s is wall clock competing with however many
 * other spec files run in parallel — so a green suite depended on machine load. KanjiDetail's parts
 * test failed in the full run and passed alone, reporting "unable to find button" while the DOM showed
 * the view still Loading: a message describing a missing element when the answer was "not yet".
 *
 * 5s can't mask a broken assertion — a view that never resolves still fails, just later.
 */
configure({ asyncUtilTimeout: 5_000 });

/**
 * Unmount rendered components between tests.
 *
 * Testing Library registers this itself only when `afterEach` is a global, which it isn't here — so
 * for a while nothing did, and specs had grown their own copies unevenly. Leaked DOM makes every
 * negative assertion unreliable: a button left mounted by the previous test satisfies "renders
 * nothing", which is how a PlayButton spec passed while asserting the opposite of what it meant.
 */
// A setup file's whole job is registering hooks at module scope; the rule wanting them inside a
// `describe` is aimed at spec files.
// oxlint-disable-next-line vitest/require-top-level-describe
afterEach(cleanup);

/**
 * Stub the webview host API.
 *
 * `bridge.ts` calls `acquireVsCodeApi()` at module load, and it exists only inside a real VS Code
 * webview — so any component that transitively imports the bridge (most views do, for the settings
 * gear and copy-as) fails to LOAD without this, before a single assertion runs. Specs that care about
 * bridge behaviour still mock it explicitly; the rest just work.
 */
// One slot, like the real API: setState replaces rather than merges.
let persisted: unknown;

(globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => persisted,
  setState: (state: unknown) => {
    persisted = state;
  }
});
