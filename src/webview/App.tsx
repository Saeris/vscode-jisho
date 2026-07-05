import { useMachine } from "@xstate/react";
import { activeView, navigationMachine } from "./machines/navigation";
import { SearchResults } from "./views/SearchResults";
import { WordDetail } from "./views/WordDetail";

export const App = (): React.ReactElement => {
  const [state, send] = useMachine(navigationMachine);
  const view = activeView(state.context);

  switch (view.name) {
    case "search":
      return (
        <SearchResults onOpenWord={(id) => send({ type: "openWord", id })} />
      );
    case "wordDetail":
      return <WordDetail id={view.id} onBack={() => send({ type: "back" })} />;
  }
};
