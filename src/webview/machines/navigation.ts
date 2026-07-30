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
   * The search view's query text. Held here (not in component state) so it survives the search
   * view unmounting while a detail view is on top — Back restores the query, and TanStack Query's
   * cache restores its results.
   */
  searchQuery: string;
}

export const freshContext = (): NavContext => ({
  stack: [{ name: "search" }],
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
      openWord: { actions: ["pushWord", "persist"] },
      openMoreExamples: { actions: ["pushMoreExamples", "persist"] },
      openKanji: { actions: ["pushKanji", "persist"] },
      openStrokeOrder: { actions: ["pushStrokeOrder", "persist"] },
      openComponentTree: { actions: ["pushComponentTree", "persist"] },
      openName: { actions: ["pushName", "persist"] },
      openRadicals: { actions: ["pushRadicals", "persist"] },
      openHandwriting: { actions: ["pushHandwriting", "persist"] },
      openAbout: { actions: ["pushAbout", "persist"] },
      back: { actions: ["pop", "persist"] },
      home: { actions: ["reset", "persist"] },
      setSearchQuery: { actions: ["setQuery", "persist"] },
      searchFor: { actions: ["searchFor", "persist"] },
      appendToSearch: { actions: ["appendToSearch", "persist"] }
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
  const valid = stack.every(
    (view: unknown) =>
      typeof view === "object" &&
      view !== null &&
      "name" in view &&
      typeof view.name === "string" &&
      names.has(view.name)
  );
  if (!valid) return fresh;
  // The base of the stack must be `search`, or Back/Home can strand the user above a view that
  // cannot be popped to.
  if (stack[0].name !== "search") return fresh;

  return {
    stack,
    searchQuery: typeof searchQuery === "string" ? searchQuery : ""
  };
};

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
