import { useNavigate } from "../navigation";
import { DetailHeader } from "./DetailHeader";
import { ErrorState } from "./ErrorState";
import styles from "./DetailView.module.css";

/**
 * The four fields this component reads from a query.
 *
 * Deliberately structural rather than `Pick<UseQueryResult<T>, …>`: TanStack's result is a
 * discriminated union, so depending on it would couple the shell to the query library AND make it
 * untestable without constructing a full fake union member. What this needs is the state, not the
 * library — `useQuery(...)` satisfies it by shape.
 */
export interface QueryState<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

interface DetailViewProps<T> {
  /** The query this view is a rendering of. */
  query: QueryState<T>;
  /**
   * Shown when the query succeeds but there is nothing to render — a missing id, or a word with no
   * examples. Distinct from an error: the request worked, the answer is empty.
   */
  empty?: string;
  /**
   * What this view was loading, for the issue title a failed report files: "the word page", "stroke
   * order". Defaults to something generic rather than being required, so no caller is forced to
   * invent one.
   */
  context?: string;
  /** Whether `data` counts as empty. Defaults to treating only `null` as empty. */
  isEmpty?: (data: NonNullable<T>) => boolean;
  /**
   * Rendered inside the body ABOVE the state switch, so it stays visible while loading. For a title
   * the view already knows without the query — a kanji's own literal, say — which would otherwise
   * flash in only once the request resolved.
   */
  above?: React.ReactNode;
  children: (data: NonNullable<T>) => React.ReactNode;
}

/**
 * The chrome every pushed detail view shares: a back/home header, and the pending → error → empty →
 * content decision.
 *
 * Six views wrote this out individually, down to the same `error instanceof Error ? … : "Failed to
 * load."` expression, which meant six chances for the loading and error treatment to drift apart.
 * Taking `children` as a function of the resolved data is what lets a view's body assume its data
 * exists instead of re-narrowing it.
 */
export const DetailView = <T,>({
  query,
  empty = "Not found.",
  context = "loading this page",
  isEmpty,
  above,
  children
}: DetailViewProps<T>): React.ReactElement => {
  // Back/Home come from the navigation context rather than props: every one of the five callers
  // passed the same two closures over the same machine, and App wrote them out per call site.
  const { back, home } = useNavigate();
  const { data, isPending, isError, error } = query;
  const resolved = data ?? null;
  const blank = resolved === null || isEmpty?.(resolved) === true;

  return (
    <div className={styles.container}>
      <DetailHeader onBack={back} onHome={home} />
      <div className={styles.body}>
        {above}
        {isPending ? (
          <p>Loading…</p>
        ) : isError ? (
          <ErrorState
            error={error}
            context={context}
            fallback="Failed to load."
          />
        ) : blank ? (
          <p className={styles.empty}>{empty}</p>
        ) : (
          children(resolved)
        )}
      </div>
    </div>
  );
};
