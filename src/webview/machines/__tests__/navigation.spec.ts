import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import {
  activeView,
  canGoBack,
  canGoForward,
  canGoHome,
  hydrateContext,
  navigationMachine,
  navigationMachineFrom
} from "../navigation";
import type { View } from "../navigation";

describe("navigationMachine", () => {
  it("starts on the search view with no back available", () => {
    // WHY: search is the app's entry point and the floor of the stack — the user must never be
    // able to navigate "back" out of it into an empty screen.
    const actor = createActor(navigationMachine).start();
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
    expect(canGoBack(actor.getSnapshot().context)).toBe(false);
  });

  it("switching tabs changes the section without touching history", () => {
    // WHY (#55): the tabs are sections of the ROOT view, not views of their own. If switching
    // pushed a stack entry, Back would walk through tabs you had visited instead of leaving the
    // root, and the tab bar would have to hide itself mid-root. Asserting the stack is UNCHANGED is
    // what pins that distinction — the depth is the whole design.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "selectTab", tab: "kanji" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.tab).toBe("kanji");
    expect(ctx.stack).toHaveLength(1);
    expect(canGoBack(ctx)).toBe(false);
  });

  it("keeps the active tab when a detail view is pushed and popped", () => {
    // WHY: Home returns to "whichever tab you left", which only works if opening a word does not
    // quietly reset the section. The tab has to outlive the round trip.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "selectTab", tab: "vocab" });
    actor.send({ type: "openWord", id: "1358280" });
    expect(actor.getSnapshot().context.tab).toBe("vocab");
    actor.send({ type: "back" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.tab).toBe("vocab");
    expect(activeView(ctx)).toEqual({ name: "search" });
  });

  it("opening a word pushes a detail view and enables back", () => {
    // WHY: tapping a result must navigate *forward* to that word (preserving search beneath), which
    // is what makes returning to the same result list possible.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "1358280" });
    const ctx = actor.getSnapshot().context;
    expect(activeView(ctx)).toEqual({ name: "wordDetail", id: "1358280" });
    expect(canGoBack(ctx)).toBe(true);
  });

  it("opening a kanji pushes a kanjiDetail view", () => {
    // WHY: tapping a kanji (in the results section or a word's headword) must navigate to that
    // character's detail — the M4 kanji-as-first-class entry point.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openKanji", literal: "食" });
    const ctx = actor.getSnapshot().context;
    expect(activeView(ctx)).toEqual({ name: "kanjiDetail", literal: "食" });
    expect(canGoBack(ctx)).toBe(true);
  });

  it("opening more examples pushes a moreExamples view, back returns to the word", () => {
    // WHY: the "more examples" page is a sub-page of a word (F1) — opening it must push onto the
    // stack above the word, and Back must return to that word, not skip it.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "1358280" });
    actor.send({ type: "openMoreExamples", id: "1358280" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "moreExamples",
      id: "1358280"
    });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "wordDetail",
      id: "1358280"
    });
  });

  it("unwinds a mixed word→kanji→word stack one level per back", () => {
    // WHY: cross-navigation (word → its kanji → a word containing that kanji) builds a deep mixed
    // stack; back must pop exactly one level, not jump home.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "w1" });
    actor.send({ type: "openKanji", literal: "食" });
    actor.send({ type: "openWord", id: "w2" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "wordDetail",
      id: "w2"
    });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "kanjiDetail",
      literal: "食"
    });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "wordDetail",
      id: "w1"
    });
  });

  it("offers home only when drilled more than one level deep, and collapses the stack", () => {
    // WHY: Home is the escape hatch from deep link-driven drilling — at depth 2 it's redundant
    // with Back (canGoHome false), but deeper it must jump straight to search in one step.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "w1" });
    expect(canGoHome(actor.getSnapshot().context)).toBe(false); // one level = Back suffices
    actor.send({ type: "openKanji", literal: "食" });
    expect(canGoHome(actor.getSnapshot().context)).toBe(true);
    actor.send({ type: "home" });
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
    expect(canGoBack(actor.getSnapshot().context)).toBe(false);
  });

  it("opening the radical picker pushes a radicals view", () => {
    // WHY: the radical picker is the "I can see it but can't type it" entry point; it must be a
    // stack entry so Back returns to search.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openRadicals" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "radicals"
    });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
  });

  it("back from a detail view restores the search view", () => {
    // WHY: the core navigation loop is search → word → back-to-search; if back didn't restore the
    // prior view the user would lose their results on every lookup.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "1358280" });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
    expect(canGoBack(actor.getSnapshot().context)).toBe(false);
  });

  it("back at the base search view is a no-op (cannot pop the floor)", () => {
    // WHY: a stray back event (e.g. keyboard) at the root must not empty the stack and crash render.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
  });

  it("supports a stack of multiple detail views", () => {
    // WHY: following a cross-reference from one word to another builds depth; back must unwind one
    // level at a time, not jump straight home.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "a" });
    actor.send({ type: "openWord", id: "b" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "wordDetail",
      id: "b"
    });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "wordDetail",
      id: "a"
    });
  });

  it("preserves the search query across openWord → back", () => {
    // WHY: returning from a word detail must restore the user's search, not dump them on an
    // empty view — the query lives in machine context precisely so it survives the view switch.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "setSearchQuery", query: "たべる" });
    actor.send({ type: "openWord", id: "1358280" });
    actor.send({ type: "back" });
    expect(actor.getSnapshot().context.searchQuery).toBe("たべる");
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
  });

  it("searchFor jumps to the search view with the new query", () => {
    // WHY: tapping a cross-reference in a word detail must land the user on the search view
    // showing results for that term — this is the tap-through action's whole contract.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "setSearchQuery", query: "eat" });
    actor.send({ type: "openWord", id: "1358280" });
    actor.send({ type: "searchFor", term: "食う" });
    const ctx = actor.getSnapshot().context;
    expect(activeView(ctx)).toEqual({ name: "search" });
    expect(ctx.searchQuery).toBe("食う");
  });

  it("home resets the stack to just search", () => {
    // WHY: a "home" affordance must collapse arbitrary depth back to the search floor in one step.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "a" });
    actor.send({ type: "openWord", id: "b" });
    actor.send({ type: "home" });
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
    expect(canGoBack(actor.getSnapshot().context)).toBe(false);
  });

  // ── M6/M7 views ─────────────────────────────────────────────────────────

  it("opening a name pushes a nameDetail view (M6 names)", () => {
    // WHY: tapping a result in the Names section must navigate to that name's detail, preserving
    // search beneath — the same forward-nav contract as words/kanji.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openName", id: "5543705" });
    const ctx = actor.getSnapshot().context;
    expect(activeView(ctx)).toEqual({ name: "nameDetail", id: "5543705" });
    expect(canGoBack(ctx)).toBe(true);
  });

  it("opening the handwriting view pushes it and back returns to search (M7)", () => {
    // WHY: the ✏️ affordance opens draw-to-search as a stack entry so Back returns to the search
    // the user was on.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openHandwriting" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "handwriting"
    });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
  });

  it("appendToSearch adds the character to the query and returns to search (M7 pick)", () => {
    // WHY: picking a recognized kanji from the handwriting view must APPEND it to the existing
    // query (not replace) and land back on search — you build a multi-character query by drawing.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "setSearchQuery", query: "日本" });
    actor.send({ type: "openHandwriting" });
    actor.send({ type: "appendToSearch", char: "語" });
    const ctx = actor.getSnapshot().context;
    expect(activeView(ctx)).toEqual({ name: "search" });
    expect(ctx.searchQuery).toBe("日本語");
  });

  it("goes forward into the view back just left", () => {
    // WHY: the mouse's forward button (X2) and the reason `forwardStack` exists at all — back
    // without forward makes a mis-click destructive.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "1" });
    actor.send({ type: "back" });
    expect(canGoForward(actor.getSnapshot().context)).toBe(true);
    actor.send({ type: "forward" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "wordDetail",
      id: "1"
    });
    expect(canGoForward(actor.getSnapshot().context)).toBe(false);
  });

  it("discards forward history when the user navigates somewhere new", () => {
    // WHY: browser behaviour. Going back and then following a DIFFERENT link abandons the branch
    // you left — otherwise forward would re-enter a view the user has since navigated away from,
    // which reads as the panel jumping somewhere unrelated.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "1" });
    actor.send({ type: "back" });
    actor.send({ type: "openKanji", literal: "水" });
    expect(canGoForward(actor.getSnapshot().context)).toBe(false);
    // Forward is now inert rather than resurrecting the abandoned word.
    actor.send({ type: "forward" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "kanjiDetail",
      literal: "水"
    });
  });

  it("does not record forward history when back is a no-op at the floor", () => {
    // WHY: `back` on the search view must not push `search` onto the forward stack — forward would
    // then duplicate the base view onto the stack, which Home could no longer clear.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "back" });
    expect(canGoForward(actor.getSnapshot().context)).toBe(false);
    expect(actor.getSnapshot().context.stack).toHaveLength(1);
  });

  it("walks several steps back and forward again", () => {
    // WHY: the forward stack has to be a stack, not a single slot — a user drilling three levels
    // deep and backing out expects all three to be re-enterable in order.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "1" });
    actor.send({ type: "openKanji", literal: "水" });
    actor.send({ type: "openStrokeOrder", literal: "水" });
    actor.send({ type: "back" });
    actor.send({ type: "back" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "wordDetail",
      id: "1"
    });
    actor.send({ type: "forward" });
    actor.send({ type: "forward" });
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "strokeOrder",
      literal: "水"
    });
  });

  it("clears forward history on home", () => {
    // WHY: Home resets the stack to the base view, which makes any forward entry unreachable —
    // leaving it would let Forward jump back into a view the user explicitly left.
    const actor = createActor(navigationMachine).start();
    actor.send({ type: "openWord", id: "1" });
    actor.send({ type: "openKanji", literal: "水" });
    actor.send({ type: "back" });
    actor.send({ type: "home" });
    expect(canGoForward(actor.getSnapshot().context)).toBe(false);
  });
});

describe("hydrateContext", () => {
  it("restores a persisted stack and query", () => {
    // WHY: this is the whole point — VS Code deallocates the webview document when the sidebar is
    // hidden, so without this a user who glances at their file tree comes back to an empty search
    // box having lost the word they were reading (confirmed in e2e/navigation-persistence).
    const restored = hydrateContext({
      stack: [{ name: "search" }, { name: "wordDetail", id: "1358280" }],
      searchQuery: "食べる"
    });
    expect(activeView(restored)).toEqual({ name: "wordDetail", id: "1358280" });
    expect(restored.searchQuery).toBe("食べる");
    expect(canGoBack(restored)).toBe(true);
  });

  it("falls back to a fresh stack on a view name it cannot render", () => {
    // WHY: persisted state outlives extension UPDATES, so it can carry a view from a build whose
    // `View` union differed. Pushing one App has no case for renders a blank sidebar with no way
    // out — strictly worse than losing the stack.
    const restored = hydrateContext({
      stack: [{ name: "search" }, { name: "someRemovedView", id: "x" }],
      searchQuery: "kept?"
    });
    expect(restored.stack).toEqual([{ name: "search" }]);
    expect(restored.searchQuery).toBe("");
  });

  it("refuses a stack that is not rooted at search", () => {
    // WHY: `search` is the floor. A stack that starts elsewhere lets Back and Home pop to a view the
    // user can never leave.
    const restored = hydrateContext({
      stack: [{ name: "wordDetail", id: "1358280" }],
      searchQuery: ""
    });
    expect(restored.stack).toEqual([{ name: "search" }]);
  });

  it("survives anything that is not a context at all", () => {
    // WHY: getState() returns whatever was last written, including from a build that stored a
    // different shape. Every one of these has to yield a usable app, not a crash on first render.
    for (const junk of [
      undefined,
      null,
      0,
      "",
      "search",
      [],
      {},
      { stack: [] }
    ]) {
      expect(hydrateContext(junk)).toEqual({
        stack: [{ name: "search" }],
        forwardStack: [],
        searchQuery: "",
        selectedSegment: null,
        tab: "search"
      });
    }
  });

  it("ignores a non-string query without discarding a valid stack", () => {
    const restored = hydrateContext({
      stack: [{ name: "search" }, { name: "about" }],
      searchQuery: 42
    });
    expect(activeView(restored)).toEqual({ name: "about" });
    expect(restored.searchQuery).toBe("");
  });

  it("restores EVERY view in the union, not just the ones that predate browse", () => {
    // WHY: the allowlist is a hand-maintained string set, so a view added to `View` without being
    // added there is not a type error — it silently makes that view unrestorable and dumps the user
    // back to a fresh search on the next reload. `browse` and `wordList` were exactly that between
    // #54 shipping and 2026-08-06. Asserting the whole union is what makes the next omission fail.
    const everyView: View[] = [
      { name: "search" },
      { name: "wordDetail", id: "1" },
      { name: "moreExamples", id: "1" },
      { name: "kanjiDetail", literal: "水" },
      { name: "strokeOrder", literal: "水" },
      { name: "componentTree", literal: "水" },
      { name: "nameDetail", id: "1" },
      { name: "browse", group: "jlpt" },
      { name: "wordList", id: "jlpt-n5" },
      { name: "radicals", preselect: ["水"] },
      { name: "handwriting" },
      { name: "about" }
    ];
    for (const view of everyView.slice(1)) {
      const restored = hydrateContext({
        stack: [{ name: "search" }, view],
        searchQuery: ""
      });
      expect(activeView(restored)).toEqual(view);
    }
  });

  it("restores the breakdown filter, and treats a pre-#16 context as unfiltered", () => {
    // WHY: the selection is persisted so Back from a word returns to the FILTERED results. State
    // written before this field existed simply has none, and must restore as "no filter" rather
    // than discarding the whole session.
    const filtered = hydrateContext({
      stack: [{ name: "search" }],
      searchQuery: "図書館に行く",
      selectedSegment: 2
    });
    expect(filtered.selectedSegment).toBe(2);

    const legacy = hydrateContext({
      stack: [{ name: "search" }],
      searchQuery: "図書館に行く"
    });
    expect(legacy.selectedSegment).toBeNull();
  });

  it("restores the active tab, and falls back to Search for anything unknown", () => {
    // WHY (#55): the tab is the one piece of per-tab state the machine holds, because everything
    // else survives in force-mounted panels — but those die with the document, and VSCode
    // deallocates the webview on a sidebar collapse. Without this the panel always reopens on
    // Search. An unrecognised value must not be trusted through: it would select no panel at all,
    // leaving a blank root under a tab bar that looks like it is on nothing.
    expect(
      hydrateContext({ stack: [{ name: "search" }], tab: "kanji" }).tab
    ).toBe("kanji");
    expect(
      hydrateContext({ stack: [{ name: "search" }], tab: "nonsense" }).tab
    ).toBe("search");
    // Written by a build that predates tabs.
    expect(hydrateContext({ stack: [{ name: "search" }] }).tab).toBe("search");
  });
});

describe("navigationMachineFrom", () => {
  it("actually seeds the machine with the restored context", () => {
    // WHY: XState ignores `input` when `context` is a static literal, so the obvious wiring — pass
    // input, declare context as an object — typechecks and silently does nothing. This asserts the
    // seeding takes effect through the real actor, not just that hydrateContext returned something.
    const actor = createActor(
      navigationMachineFrom({
        stack: [{ name: "search" }, { name: "kanjiDetail", literal: "水" }],
        searchQuery: "みず"
      })
    ).start();
    expect(activeView(actor.getSnapshot().context)).toEqual({
      name: "kanjiDetail",
      literal: "水"
    });
    expect(actor.getSnapshot().context.searchQuery).toBe("みず");
  });

  it("starts fresh when nothing was persisted", () => {
    const actor = createActor(navigationMachineFrom(undefined)).start();
    expect(activeView(actor.getSnapshot().context)).toEqual({ name: "search" });
    expect(canGoBack(actor.getSnapshot().context)).toBe(false);
  });
});
