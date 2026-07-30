import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

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
