import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

/**
 * Widen the `findBy*` budget from Testing Library's 1s default.
 *
 * Every view spec awaits a TanStack query resolving, and 1s is a wall-clock budget competing with
 * however many other spec files this project happens to run in parallel. That made a passing suite
 * depend on machine load: KanjiDetail's parts test failed in the full run and passed on its own,
 * reporting "unable to find button" while the DOM plainly showed the view still in its Loading state
 * — a message that describes a missing element when the real answer is "not yet".
 *
 * 5s cannot mask a broken assertion (a view that never resolves still fails, just later), so this
 * only removes the load sensitivity.
 */
configure({ asyncUtilTimeout: 5_000 });

/**
 * Component-project setup: stub the webview host API.
 *
 * `bridge.ts` calls `acquireVsCodeApi()` at module load — it exists only inside a real VS Code
 * webview. Any component that transitively imports the bridge (most views do now, for the settings
 * gear and copy-as) would otherwise fail to LOAD under jsdom, before a single assertion runs.
 * Stubbing it here beats repeating a `vi.mock("../../bridge")` in every spec: specs that care
 * about bridge behaviour still mock it explicitly, and the rest just work.
 */
/**
 * Unmount rendered components between tests.
 *
 * Testing Library registers this itself when `afterEach` is a global — but Vitest's `globals: true`
 * is not reaching this project's worker, so it never did, and 6 of 16 rendering specs had grown their
 * own `afterEach(cleanup)` while the rest had none. Leaked DOM makes every negative assertion
 * unreliable: a button left mounted by the previous test satisfies "renders nothing", which is how a
 * PlayButton spec passed while asserting the opposite of what it meant.
 *
 * Registered here so it is a property of the project, not a convention 62% of files remembered.
 */
// A setup file's whole job is registering hooks at module scope; the rule that wants them inside a
// `describe` is aimed at spec files.
// oxlint-disable-next-line vitest/require-top-level-describe
afterEach(cleanup);

const postedMessages: unknown[] = [];
// A single slot, like the real API: setState replaces rather than merges.
let persisted: unknown;

(globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
  postMessage: (message: unknown) => postedMessages.push(message),
  getState: () => persisted,
  setState: (state: unknown) => {
    persisted = state;
  }
});
