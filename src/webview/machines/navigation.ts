/**
 * Navigation state as an explicit view stack (XState). The webview has no URL/history, so this
 * machine is the single source of navigation truth: `search` is the base view, opening a word
 * pushes a `wordDetail` view, and `back` pops. Designed to grow (a `kanjiDetail` view slots in as
 * another stack entry) without restructuring.
 */
import { assign, setup } from "xstate";

export type View =
  | { name: "search" }
  | { name: "wordDetail"; id: string }
  | { name: "kanjiDetail"; literal: string }
  | { name: "strokeOrder"; literal: string }
  | { name: "nameDetail"; id: string }
  /** `preselect` seeds the picker's selection — used when tapping a kanji's component. */
  | { name: "radicals"; preselect?: string[] }
  | { name: "handwriting" }
  | { name: "about" };

export interface NavContext {
  /** The view stack; the last element is the active view. Never empty (search is the floor). */
  stack: View[];
  /**
   * The search view's query text. Held here (not in component state) so it survives the search
   * view unmounting while a detail view is on top — Back restores the query, and TanStack Query's
   * cache restores its results.
   */
  searchQuery: string;
}

export type NavEvent =
  | { type: "openWord"; id: string }
  | { type: "openKanji"; literal: string }
  | { type: "openStrokeOrder"; literal: string }
  | { type: "openName"; id: string }
  /** Open the radical picker; `preselect` seeds its selection (tapping a component part). */
  | { type: "openRadicals"; preselect?: string[] }
  | { type: "openHandwriting" }
  | { type: "openAbout" }
  | { type: "back" }
  | { type: "home" }
  | { type: "setSearchQuery"; query: string }
  /** Jump to the search view with a new query — the tap-through action for cross-references. */
  | { type: "searchFor"; term: string }
  /** Append a character to the query and return to search — the handwriting-pick action. */
  | { type: "appendToSearch"; char: string };

export const navigationMachine = setup({
  // `{} as T` is XState v5's documented idiom for declaring machine types — there is no
  // cast-free alternative, so the assertion is expected here.
  types: {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    context: {} as NavContext,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    events: {} as NavEvent
  },
  actions: {
    pushWord: assign({
      stack: ({ context, event }) =>
        event.type === "openWord"
          ? [
              ...context.stack,
              { name: "wordDetail", id: event.id } satisfies View
            ]
          : context.stack
    }),
    pushKanji: assign({
      stack: ({ context, event }) =>
        event.type === "openKanji"
          ? [
              ...context.stack,
              { name: "kanjiDetail", literal: event.literal } satisfies View
            ]
          : context.stack
    }),
    pushStrokeOrder: assign({
      stack: ({ context, event }) =>
        event.type === "openStrokeOrder"
          ? [
              ...context.stack,
              { name: "strokeOrder", literal: event.literal } satisfies View
            ]
          : context.stack
    }),
    pushName: assign({
      stack: ({ context, event }) =>
        event.type === "openName"
          ? [
              ...context.stack,
              { name: "nameDetail", id: event.id } satisfies View
            ]
          : context.stack
    }),
    pushRadicals: assign({
      stack: ({ context, event }) => [
        ...context.stack,
        {
          name: "radicals",
          preselect: event.type === "openRadicals" ? event.preselect : undefined
        } satisfies View
      ]
    }),
    pushHandwriting: assign({
      stack: ({ context }) => [
        ...context.stack,
        { name: "handwriting" } satisfies View
      ]
    }),
    pushAbout: assign({
      stack: ({ context }) => [
        ...context.stack,
        { name: "about" } satisfies View
      ]
    }),
    pop: assign({
      // Never pop past the base search view.
      stack: ({ context }) =>
        context.stack.length > 1 ? context.stack.slice(0, -1) : context.stack
    }),
    reset: assign({ stack: () => [{ name: "search" } satisfies View] }),
    setQuery: assign({
      searchQuery: ({ context, event }) =>
        event.type === "setSearchQuery" ? event.query : context.searchQuery
    }),
    searchFor: assign({
      stack: () => [{ name: "search" } satisfies View],
      searchQuery: ({ context, event }) =>
        event.type === "searchFor" ? event.term : context.searchQuery
    }),
    appendToSearch: assign({
      // Return to the search view and append the chosen character (handwriting → search flow).
      stack: () => [{ name: "search" } satisfies View],
      searchQuery: ({ context, event }) =>
        event.type === "appendToSearch"
          ? context.searchQuery + event.char
          : context.searchQuery
    })
  }
}).createMachine({
  id: "navigation",
  context: { stack: [{ name: "search" }], searchQuery: "" },
  on: {
    openWord: { actions: "pushWord" },
    openKanji: { actions: "pushKanji" },
    openStrokeOrder: { actions: "pushStrokeOrder" },
    openName: { actions: "pushName" },
    openRadicals: { actions: "pushRadicals" },
    openHandwriting: { actions: "pushHandwriting" },
    openAbout: { actions: "pushAbout" },
    back: { actions: "pop" },
    home: { actions: "reset" },
    setSearchQuery: { actions: "setQuery" },
    searchFor: { actions: "searchFor" },
    appendToSearch: { actions: "appendToSearch" }
  }
});

/** The active (top-of-stack) view for a given context. */
export const activeView = (context: NavContext): View =>
  context.stack[context.stack.length - 1];

/** Whether a back action is possible (there is something above the base view). */
export const canGoBack = (context: NavContext): boolean =>
  context.stack.length > 1;

/**
 * Whether "home" is meaningfully distinct from "back" — i.e. more than one view sits above search,
 * so link-driven drill-down can be escaped in one step. (At depth 2, Back already returns home.)
 */
export const canGoHome = (context: NavContext): boolean =>
  context.stack.length > 2;
