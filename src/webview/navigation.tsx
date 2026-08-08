import { createContext, useContext, useMemo } from "react";
import type { NavEvent, Tab } from "./machines/navigation";

/**
 * The navigation API views call, instead of receiving a closure per destination as a prop.
 *
 * Ten views declared 48 callback props between them — `WordDetail` alone took 13 — and every one had
 * a one-line body that dispatched a machine event. `App` wrote `() => send({ type: "back" })` nine
 * times. The machine already owned the stack; the props were hand-wiring around it.
 *
 * Named methods rather than the raw `send`: a view asking for `openKanji("水")` says what it wants,
 * and this stays the one place that knows navigation is an XState machine underneath. The research
 * behind keeping XState (rather than a memory-history router) is in docs/specs/06 and the session's
 * findings — briefly, our `View` union is typed discriminated data and a router would stringify it
 * into paths only to parse it back.
 */
export interface Navigation {
  openWord: (id: string) => void;
  openMoreExamples: (id: string) => void;
  openKanji: (literal: string) => void;
  openStrokeOrder: (literal: string) => void;
  openComponentTree: (literal: string) => void;
  openName: (id: string) => void;
  /** The classifier tree; `group` drills straight into one group (#54). */
  openBrowse: (group?: string) => void;
  /** One classifier's word list, by `Classifier.id`. */
  openWordList: (id: string) => void;
  openRadicals: (preselect?: string[]) => void;
  openHandwriting: () => void;
  openAbout: () => void;
  back: () => void;
  /**
   * Re-enter the view Back just left. Undefined when there is no forward history — following the
   * same convention as `home`, so a caller can omit the affordance rather than offer a dead one.
   */
  forward: (() => void) | undefined;
  /**
   * Undefined when Home would just duplicate Back — i.e. only one view sits above search. Kept
   * optional rather than always-present so a header can omit the control instead of rendering a
   * second button that does the same thing.
   */
  home: (() => void) | undefined;
  searchFor: (term: string) => void;
  appendToSearch: (char: string) => void;
  setSearchQuery: (query: string) => void;
  /**
   * Filter the results to one breakdown chip, or `null` for the whole sentence (#16). Not a
   * navigation, but it lives here because the selection lives in the machine's context — for the
   * same reason `searchQuery` does, so Back returns to the filtered view.
   */
  selectSegment: (index: number | null) => void;
  /**
   * Switch the navigation root's section (#55). Like `selectSegment`, not a navigation — it changes
   * what the root view shows rather than pushing anything, so Back is unaffected.
   */
  selectTab: (tab: Tab) => void;
  /**
   * The section the navigation root is currently on.
   *
   * Read by a pushed view's breadcrumb trail, whose root crumb is "the tab you left" — a word list
   * drilled from Vocab says "Vocab", the same list opened from the Kanji tab says "Kanji". Exposed
   * as state rather than derived per view because the machine already owns it.
   */
  tab: Tab;
  /**
   * Which group the browse tab is drilled into; `undefined` is its group list. Set by the tab
   * itself, and by a pushed word list's root crumb — see `NavContext.browseGroup`.
   */
  browseGroup: string | undefined;
  selectBrowseGroup: (group?: string) => void;
}

const NavigationContext = createContext<Navigation | undefined>(undefined);

/**
 * Build the API from the machine's `send` and whether Home is meaningful.
 *
 * Exported so it can be tested — and stubbed — without mounting `App` or a machine.
 */
export const makeNavigation = (
  send: (event: NavEvent) => void,
  canGoHome: boolean,
  canGoForward = false,
  tab: Tab = "search",
  browseGroup?: string
): Navigation => ({
  tab,
  browseGroup,
  selectBrowseGroup: (group): void =>
    send({ type: "selectBrowseGroup", group }),
  openWord: (id): void => send({ type: "openWord", id }),
  openMoreExamples: (id): void => send({ type: "openMoreExamples", id }),
  openKanji: (literal): void => send({ type: "openKanji", literal }),
  openStrokeOrder: (literal): void =>
    send({ type: "openStrokeOrder", literal }),
  openComponentTree: (literal): void =>
    send({ type: "openComponentTree", literal }),
  openName: (id): void => send({ type: "openName", id }),
  openBrowse: (group): void => send({ type: "openBrowse", group }),
  openWordList: (id): void => send({ type: "openWordList", id }),
  openRadicals: (preselect): void => send({ type: "openRadicals", preselect }),
  openHandwriting: (): void => send({ type: "openHandwriting" }),
  openAbout: (): void => send({ type: "openAbout" }),
  back: (): void => send({ type: "back" }),
  forward: canGoForward ? (): void => send({ type: "forward" }) : undefined,
  home: canGoHome ? (): void => send({ type: "home" }) : undefined,
  searchFor: (term): void => send({ type: "searchFor", term }),
  appendToSearch: (char): void => send({ type: "appendToSearch", char }),
  setSearchQuery: (query): void => send({ type: "setSearchQuery", query }),
  selectSegment: (index): void => send({ type: "selectSegment", index }),
  selectTab: (tab): void => send({ type: "selectTab", tab })
});

export const NavigationProvider = ({
  send,
  canGoHome,
  canGoForward = false,
  tab = "search",
  browseGroup,
  children
}: {
  send: (event: NavEvent) => void;
  canGoHome: boolean;
  canGoForward?: boolean;
  tab?: Tab;
  browseGroup?: string;
  children: React.ReactNode;
}): React.ReactElement => {
  // Rebuilt only when `send` or one of the conditional affordances changes, so a navigation does
  // not hand every consumer a new set of function identities.
  const value = useMemo(
    () => makeNavigation(send, canGoHome, canGoForward, tab, browseGroup),
    [send, canGoHome, canGoForward, tab, browseGroup]
  );
  return <NavigationContext value={value}>{children}</NavigationContext>;
};

/**
 * The navigation API. Throws outside a provider rather than returning a no-op: a view that silently
 * cannot navigate is a dead end the user has to restart the panel to escape, and it would pass tests
 * that never click anything.
 */
export const useNavigate = (): Navigation => {
  const navigation = useContext(NavigationContext);
  if (navigation === undefined) {
    throw new Error("useNavigate must be used inside a NavigationProvider");
  }
  return navigation;
};
