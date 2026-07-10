import { useMachine } from "@xstate/react";
import { activeView, navigationMachine } from "./machines/navigation";
import { About } from "./views/About";
import { SearchResults } from "./views/SearchResults";
import { WordDetail } from "./views/WordDetail";

export const App = (): React.ReactElement => {
  const [state, send] = useMachine(navigationMachine);
  const view = activeView(state.context);

  switch (view.name) {
    case "search":
      return (
        <SearchResults
          // The query lives in the machine context so it survives the detail view being pushed
          // on top; Back restores it (and TanStack Query's cache restores the results).
          query={state.context.searchQuery}
          onQueryChange={(query) => send({ type: "setSearchQuery", query })}
          onOpenWord={(id) => send({ type: "openWord", id })}
          onOpenAbout={() => send({ type: "openAbout" })}
        />
      );
    case "wordDetail":
      return (
        <WordDetail
          id={view.id}
          onBack={() => send({ type: "back" })}
          onSearchTerm={(term) => send({ type: "searchFor", term })}
        />
      );
    case "about":
      return <About onBack={() => send({ type: "back" })} />;
  }
};
