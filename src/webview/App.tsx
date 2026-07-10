import { Activity } from "react";
import { useMachine } from "@xstate/react";
import { activeView, navigationMachine } from "./machines/navigation";
import { About } from "./views/About";
import { SearchResults } from "./views/SearchResults";
import { WordDetail } from "./views/WordDetail";

export const App = (): React.ReactElement => {
  const [state, send] = useMachine(navigationMachine);
  const view = activeView(state.context);

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
          onOpenAbout={() => send({ type: "openAbout" })}
        />
      </Activity>
      {view.name === "wordDetail" ? (
        <WordDetail
          id={view.id}
          onBack={() => send({ type: "back" })}
          onSearchTerm={(term) => send({ type: "searchFor", term })}
        />
      ) : null}
      {view.name === "about" ? (
        <About onBack={() => send({ type: "back" })} />
      ) : null}
    </>
  );
};
