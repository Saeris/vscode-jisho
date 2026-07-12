import { Activity } from "react";
import { useMachine } from "@xstate/react";
import {
  activeView,
  canGoHome,
  navigationMachine
} from "./machines/navigation";
import { About } from "./views/About";
import { Handwriting } from "./views/Handwriting";
import { KanjiDetail } from "./views/KanjiDetail";
import { NameDetail } from "./views/NameDetail";
import { RadicalPicker } from "./views/RadicalPicker";
import { SearchResults } from "./views/SearchResults";
import { WordDetail } from "./views/WordDetail";

export const App = (): React.ReactElement => {
  const [state, send] = useMachine(navigationMachine);
  const view = activeView(state.context);
  // The Home escape hatch is only offered when it differs from Back (drilled >1 level deep).
  const onHome: (() => void) | undefined = canGoHome(state.context)
    ? (): void => send({ type: "home" })
    : undefined;

  return (
    <>
      {/* The search view stays mounted inside an <Activity> instead of unmounting when a detail
          view is pushed on top: its scroll position, list state, and query subscriptions all
          survive Back natively. The navigation machine remains the source of truth for which
          view is active; the query text lives in machine context because tap-through
          (`searchFor`) also writes it. */}
      <Activity mode={view.name === "search" ? "visible" : "hidden"}>
        <SearchResults
          query={state.context.searchQuery}
          onQueryChange={(query) => send({ type: "setSearchQuery", query })}
          onOpenWord={(id) => send({ type: "openWord", id })}
          onOpenKanji={(literal) => send({ type: "openKanji", literal })}
          onOpenName={(id) => send({ type: "openName", id })}
          onOpenRadicals={() => send({ type: "openRadicals" })}
          onOpenHandwriting={() => send({ type: "openHandwriting" })}
          onOpenAbout={() => send({ type: "openAbout" })}
        />
      </Activity>
      {view.name === "wordDetail" ? (
        <WordDetail
          id={view.id}
          onBack={() => send({ type: "back" })}
          onHome={onHome}
          onSearchTerm={(term) => send({ type: "searchFor", term })}
          onOpenKanji={(literal) => send({ type: "openKanji", literal })}
        />
      ) : null}
      {view.name === "kanjiDetail" ? (
        <KanjiDetail
          literal={view.literal}
          onBack={() => send({ type: "back" })}
          onHome={onHome}
          onOpenKanji={(literal) => send({ type: "openKanji", literal })}
          onOpenWord={(id) => send({ type: "openWord", id })}
        />
      ) : null}
      {view.name === "nameDetail" ? (
        <NameDetail
          id={view.id}
          onBack={() => send({ type: "back" })}
          onHome={onHome}
        />
      ) : null}
      {view.name === "radicals" ? (
        <RadicalPicker
          onBack={() => send({ type: "back" })}
          onOpenKanji={(literal) => send({ type: "openKanji", literal })}
        />
      ) : null}
      {view.name === "handwriting" ? (
        <Handwriting
          onBack={() => send({ type: "back" })}
          onPick={(char) => send({ type: "appendToSearch", char })}
        />
      ) : null}
      {view.name === "about" ? (
        <About onBack={() => send({ type: "back" })} />
      ) : null}
    </>
  );
};
