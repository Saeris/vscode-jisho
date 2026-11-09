import { describe, expect, it } from "vite-plus/test";
import type { Handlers } from "../messages";

/**
 * The protocol's guarantees are TYPES, so these tests are checked by the type checker: each
 * `@ts-expect-error` marks a line that must NOT compile. If the protocol stops catching the mistake,
 * the directive is unused and `vp check` fails. The runtime assertions only keep the test runner
 * honest about what ran.
 */
describe("the request protocol", () => {
  it("rejects a handler that answers with another request's shape", () => {
    // WHY (audit I-3): nothing used to tie an answer to its request. The host could answer `search`
    // with a `getWord` shape, and only a runtime check in the webview would notice — as an error the
    // user sees, not one the build catches.
    const handlers: Pick<Handlers, "search"> = {
      // @ts-expect-error — a `getWord` answer is not a `search` answer.
      search: async () => ({ word: null })
    };
    expect(handlers.search).toBeTypeOf("function");
  });

  it("hands each handler its own request", () => {
    // WHY: the other half of the tie. A handler reading a field its request does not have would get
    // `undefined` at runtime and answer for the wrong input.
    const handlers: Pick<Handlers, "search"> = {
      // @ts-expect-error — a `search` request has a `query`, not an `id`.
      search: async ({ id: _id }) => ({ results: [], kanji: [], segments: [] })
    };
    expect(handlers.search).toBeTypeOf("function");
  });
});
