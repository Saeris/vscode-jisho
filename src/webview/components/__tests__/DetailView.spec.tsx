import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, screen } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery
} from "@tanstack/react-query";
import { renderWithNavigation as render } from "../../__tests__/navigationHarness";
import { DetailView } from "../DetailView";

// The four states DetailView decides between. Only the shape it reads is needed, not a real query.
const q = <T,>(
  over: Partial<{
    data: T;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  }>
) => ({
  data: undefined as T | undefined,
  isPending: false,
  isError: false,
  error: null,
  ...over
});

describe("detailView", () => {
  it("shows content only once data has resolved", () => {
    render(
      <DetailView query={q({ data: "本" })}>
        {(data) => <p>loaded {data}</p>}
      </DetailView>
    );
    expect(screen.getByText(/loaded 本/)).toBeDefined();
  });

  it("never calls children while pending or errored", () => {
    // WHY: children take the RESOLVED data, which is the point of the wrapper — a body can assume
    // its data exists instead of re-narrowing it. If children ran during pending, every view would
    // have to handle undefined again and the abstraction would buy nothing.
    const children = vi.fn<() => React.ReactElement>(() => <p>body</p>);
    render(<DetailView query={q({ isPending: true })}>{children}</DetailView>);
    expect(children).not.toHaveBeenCalled();
    expect(screen.getByText("Loading…")).toBeDefined();
  });

  it("prefers the error message over the empty message", () => {
    // WHY: a failed request and an empty answer are different facts. Five views previously conflated
    // them — two showed "no breakdown for this kanji" when the bridge had actually failed, which
    // sends the user looking for a data problem instead of a connection one.
    render(
      <DetailView
        query={q({ isError: true, error: new Error("bridge died") })}
        empty="nothing here"
      >
        {() => <p>body</p>}
      </DetailView>
    );
    expect(screen.getByText("bridge died")).toBeDefined();
    expect(screen.queryByText("nothing here")).toBeNull();
  });

  it("treats null as empty, and lets a view widen what empty means", () => {
    const { unmount } = render(
      <DetailView query={q({ data: null })} empty="no name">
        {() => <p>body</p>}
      </DetailView>
    );
    expect(screen.getByText("no name")).toBeDefined();
    unmount();

    // A non-null but contentless payload — MoreExamples' "resolved, but no sentences" case.
    render(
      <DetailView
        query={q({ data: { items: [] as string[] } })}
        empty="no examples"
        isEmpty={(d) => d.items.length === 0}
      >
        {() => <p>body</p>}
      </DetailView>
    );
    expect(screen.getByText("no examples")).toBeDefined();
  });

  it("keeps `above` visible in every state", () => {
    // WHY: StrokeOrder and ComponentTree show the character's own title, which they know without the
    // query. Rendering it only on success made it flash in late.
    for (const state of [
      { isPending: true },
      { isError: true, error: new Error("x") },
      { data: "ok" }
    ]) {
      const { unmount } = render(
        <DetailView query={q(state)} above={<h1>水</h1>}>
          {() => <p>body</p>}
        </DetailView>
      );
      expect(screen.getByText("水")).toBeDefined();
      unmount();
    }
  });
});

describe("detail view recovery", () => {
  /** A view backed by a real query that fails the first time and succeeds after. */
  const Flaky = ({
    load
  }: {
    load: () => Promise<string>;
  }): React.ReactElement => {
    const query = useQuery({ queryKey: ["flaky"], queryFn: load });
    return (
      <DetailView query={query} context="loading">
        {(word) => <p>{word}</p>}
      </DetailView>
    );
  };

  it("recovers from a failed load with Try again", async () => {
    // WHY: the app runs every query with `retry: false` and `staleTime: Infinity` and never
    // invalidates, so a failed load was final while the view stayed open. This uses those same
    // settings, so it fails the way the app did (audit SM-9).
    let calls = 0;
    const load = async (): Promise<string> => {
      calls++;
      if (calls === 1) throw new Error("the dictionary is being updated");
      return "食べる";
    };
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <Flaky load={load} />
      </QueryClientProvider>
    );
    await screen.findByText("the dictionary is being updated");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("食べる");
    expect(calls).toBe(2);
  });
});
