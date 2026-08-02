/**
 * Navigation state as an explicit view stack (XState). The webview has no URL/history, so this
 * machine is the single source of navigation truth: `search` is the base view, opening a word
 * pushes a `wordDetail` view, `back` pops, and `forward` re-enters what `back` left. Designed to
 * grow (a `kanjiDetail` view slots in as another stack entry) without restructuring.
 *
 * WHY NOT THE NAVIGATION API (evaluated 2026-08-02, deliberately rejected)
 *
 * `window.navigation` and `history.pushState` both work inside the webview, and Chromium even
 * traverses session history natively when the X1/X2 mouse buttons are pressed — so on the surface
 * it looks like the platform could own all of this for free.
 *
 * It cannot, because session history is per-DOCUMENT. VS Code deallocates a `WebviewView`'s
 * document whenever the user collapses the view or switches activity-bar containers, and recreates
 * it on the way back; `retainContextWhenHidden` is a `WebviewPanel` option that views do not have
 * (microsoft/vscode#152110). The documented alternative is `setState`/`getState`, which is what
 * `persist` below uses — and that state survives, while `navigation.entries()` comes back empty.
 *
 * Adopting it would therefore mean two histories that disagree exactly when it matters: after a
 * restore we would hold a populated stack and an empty session history, and would have to
 * reconstruct one from the other on every restore. That is more code than the forward stack below,
 * not less. The free native traversal is unreachable for the same reason — the browser can only
 * traverse history it owns.
 */
import { assign, setup } from "xstate";

export type View =
  | { name: "search" }
  | { name: "wordDetail"; id: string }
  | { name: "moreExamples"; id: string }
  | { name: "kanjiDetail"; literal: string }
  | { name: "strokeOrder"; literal: string }
  | { name: "componentTree"; literal: string }
  | { name: "nameDetail"; id: string }
  /** `preselect` seeds the picker's selection — used when tapping a kanji's component. */
  | { name: "radicals"; preselect?: string[] }
  | { name: "handwriting" }
  | { name: "about" };

export interface NavContext {
  /** The view stack; the last element is the active view. Never empty (search is the floor). */
  stack: View[];
  /**
   * Views popped by `back`, newest first — what `forward` re-pushes.
   *
   * Kept separate from `stack` and CLEARED whenever the user navigates somewhere new, which is the
   * behaviour every browser has: going back and then following a different link discards the
   * forward history rather than leaving a branch the UI cannot express.
   */
  forwardStack: View[];
  /**
   * The search view's query text. Held here (not in component state) so it survives the search
   * view unmounting while a detail view is on top — Back restores the query, and TanStack Query's
   * cache restores its results.
   */
  searchQuery: string;
}

export const freshContext = (): NavContext => ({
  stack: [{ name: "search" }],
  forwardStack: [],
  searchQuery: ""
});

export type NavEvent =
  | { type: "openWord"; id: string }
  | { type: "openMoreExamples"; id: string }
  | { type: "openKanji"; literal: string }
  | { type: "openStrokeOrder"; literal: string }
  | { type: "openComponentTree"; literal: string }
  | { type: "openName"; id: string }
  /** Open the radical picker; `preselect` seeds its selection (tapping a component part). */
  | { type: "openRadicals"; preselect?: string[] }
  | { type: "openHandwriting" }
  | { type: "openAbout" }
  | { type: "back" }
  /** Re-enter the view `back` just left — the forward mouse button, and the browser's ⟩. */
  | { type: "forward" }
  | { type: "home" }
  | { type: "setSearchQuery"; query: string }
  /** Jump to the search view with a new query — the tap-through action for cross-references. */
  | { type: "searchFor"; term: string }
  /** Append a character to the query and return to search — the handwriting-pick action. */
  | { type: "appendToSearch"; char: string };

/**
 * Build the machine with a given starting context.
 *
 * A factory rather than XState `input`: declaring input makes it REQUIRED at every `createActor`
 * call, which would force twelve tests to pass a value they do not care about. This keeps the
 * default export the fresh machine those tests already use.
 */
// No explicit return type: XState's machine type is a dozen inferred parameters deep and is not
// practically writable by hand — `NavigationMachine` below names it by inference instead, which is
// what every caller actually uses.
// oxlint-disable-next-line typescript/explicit-function-return-type
/**
 * Where the machine writes its context so it survives the webview document being deallocated.
 *
 * Injected rather than imported so the machine stays testable without a webview — the unit tests pass
 * a no-op, and only App wires in the real `persistState`.
 */
export type Persist = (context: NavContext) => void;

// No explicit return type: XState's machine type is a dozen inferred parameters deep and not
// practically writable by hand — `NavigationMachine` below names it by inference, which is what every
// caller actually uses.
// oxlint-disable-next-line typescript/explicit-function-return-type
const define = (initial: NavContext, persist: Persist) =>
  setup({
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
      pushMoreExamples: assign({
        stack: ({ context, event }) =>
          event.type === "openMoreExamples"
            ? [
                ...context.stack,
                { name: "moreExamples", id: event.id } satisfies View
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
      pushComponentTree: assign({
        stack: ({ context, event }) =>
          event.type === "openComponentTree"
            ? [
                ...context.stack,
                { name: "componentTree", literal: event.literal } satisfies View
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
            preselect:
              event.type === "openRadicals" ? event.preselect : undefined
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
          context.stack.length > 1 ? context.stack.slice(0, -1) : context.stack,
        // The popped view becomes forward history. Guarded by the same length check, so a `back`
        // at the floor is a no-op on both stacks rather than pushing `search` onto forward.
        forwardStack: ({ context }) =>
          context.stack.length > 1
            ? [activeView(context), ...context.forwardStack]
            : context.forwardStack
      }),
      /** Re-enter the most recently popped view. */
      unpop: assign({
        stack: ({ context }) =>
          context.forwardStack.length > 0
            ? [...context.stack, context.forwardStack[0]]
            : context.stack,
        forwardStack: ({ context }) => context.forwardStack.slice(1)
      }),
      /**
       * Discard forward history. Applied on every action that navigates somewhere NEW — the
       * browser behaviour: going back and then following a different link abandons the branch you
       * had gone back from, rather than leaving a fork the UI has no way to express.
       */
      clearForward: assign({ forwardStack: () => [] }),
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
      }),
      /**
       * Write the context out after a navigation.
       *
       * An ACTION rather than a React effect: an effect fires after render, so persistence depended
       * on render timing and on the dependency list naming every field that matters — miss one and
       * the saved copy silently drifts from the stack. Here it cannot miss a transition, because
       * every event that changes context lists it.
       */
      persist: ({ context }) => {
        persist(context);
      }
    }
  }).createMachine({
    id: "navigation",
    context: initial,
    on: {
      // Every `open*` navigates somewhere NEW, so each discards forward history.
      openWord: { actions: ["pushWord", "clearForward", "persist"] },
      openMoreExamples: {
        actions: ["pushMoreExamples", "clearForward", "persist"]
      },
      openKanji: { actions: ["pushKanji", "clearForward", "persist"] },
      openStrokeOrder: {
        actions: ["pushStrokeOrder", "clearForward", "persist"]
      },
      openComponentTree: {
        actions: ["pushComponentTree", "clearForward", "persist"]
      },
      openName: { actions: ["pushName", "clearForward", "persist"] },
      openRadicals: { actions: ["pushRadicals", "clearForward", "persist"] },
      openHandwriting: {
        actions: ["pushHandwriting", "clearForward", "persist"]
      },
      openAbout: { actions: ["pushAbout", "clearForward", "persist"] },
      // Back and Forward move THROUGH history rather than creating it, so neither clears it.
      back: { actions: ["pop", "persist"] },
      forward: { actions: ["unpop", "persist"] },
      // Home and the two search actions all reset the stack to the base view, which makes any
      // forward history unreachable — clear it rather than strand it.
      home: { actions: ["reset", "clearForward", "persist"] },
      setSearchQuery: { actions: ["setQuery", "persist"] },
      searchFor: { actions: ["searchFor", "clearForward", "persist"] },
      appendToSearch: { actions: ["appendToSearch", "clearForward", "persist"] }
    }
  });

/** The machine's type, named once so the two entry points below can be annotated. */
export type NavigationMachine = ReturnType<typeof define>;

/** The machine with a fresh stack and no persistence — the default the unit tests exercise. */
export const navigationMachine: NavigationMachine = define(
  freshContext(),
  () => {}
);

/**
 * The same machine seeded from state a previous incarnation of the webview persisted.
 *
 * VS Code deallocates a WebviewView's document when its container is hidden and recreates it on the
 * way back, and views have no `retainContextWhenHidden`, so this is the only way an open word or a
 * typed query survives the user glancing at their file tree.
 */
export const navigationMachineFrom = (
  persisted: unknown,
  persist: Persist = () => {}
): NavigationMachine => define(hydrateContext(persisted), persist);

/**
 * Rebuild a context from state persisted by a previous incarnation of this document.
 *
 * Validated rather than trusted: the value survives across VS Code sessions and extension UPDATES,
 * so it can have been written by an older build with a different `View` union. An unknown view name
 * or a malformed stack falls back to a fresh context instead of pushing a view `App` cannot render —
 * which would be a blank sidebar the user cannot navigate out of.
 *
 * Only the shape is checked, not the referents: a persisted `wordDetail` id may since have vanished
 * from the dictionary, and that resolves correctly on its own — the view's query returns null and
 * `DetailView` shows "not found" with a working Back button.
 */
export const hydrateContext = (persisted: unknown): NavContext => {
  const fresh = freshContext();
  if (typeof persisted !== "object" || persisted === null) return fresh;
  const { stack, searchQuery } = persisted as Partial<NavContext>;
  if (!Array.isArray(stack) || stack.length === 0) return fresh;

  const names = new Set<string>([
    "search",
    "wordDetail",
    "moreExamples",
    "kanjiDetail",
    "strokeOrder",
    "componentTree",
    "nameDetail",
    "radicals",
    "handwriting",
    "about"
  ]);
  const isView = (view: unknown): view is View =>
    typeof view === "object" &&
    view !== null &&
    "name" in view &&
    typeof view.name === "string" &&
    names.has(view.name);

  if (!stack.every(isView)) return fresh;
  // The base of the stack must be `search`, or Back/Home can strand the user above a view that
  // cannot be popped to.
  if (stack[0].name !== "search") return fresh;

  // Forward history is optional: state written before this field existed simply has none, and an
  // unrecognised entry drops the forward history rather than the whole session — losing a redo is
  // a far smaller harm than sending the user back to an empty search.
  const { forwardStack } = persisted as Partial<NavContext>;
  const forward =
    Array.isArray(forwardStack) && forwardStack.every(isView)
      ? forwardStack
      : [];

  return {
    stack,
    forwardStack: forward,
    searchQuery: typeof searchQuery === "string" ? searchQuery : ""
  };
};

/** The active (top-of-stack) view for a given context. */
export const activeView = (context: NavContext): View =>
  context.stack[context.stack.length - 1];

/** Whether a back action is possible (there is something above the base view). */
export const canGoBack = (context: NavContext): boolean =>
  context.stack.length > 1;

/** Whether a forward action is possible (something was popped and not yet superseded). */
export const canGoForward = (context: NavContext): boolean =>
  context.forwardStack.length > 0;

/**
 * Whether "home" is meaningfully distinct from "back" — i.e. more than one view sits above search,
 * so link-driven drill-down can be escaped in one step. (At depth 2, Back already returns home.)
 */
export const canGoHome = (context: NavContext): boolean =>
  context.stack.length > 2;
