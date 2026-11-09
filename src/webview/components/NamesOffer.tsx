import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { declineNames, installNames } from "../bridge";
import styles from "./NamesOffer.module.css";

/**
 * The names dictionary's size, as offered. The archive is ~84 MB and grows a little with each data
 * refresh, so it is rounded rather than quoted to the megabyte.
 */
const DOWNLOAD_SIZE = "about 85 MB";

/**
 * Names are opt-in, and this is where the user opts in.
 *
 * They used to download on the first search of anything — 84 MB, about 400 MB on disk — while the
 * README said they cost that "if you use name lookups" (audit I-0). Now nothing downloads them
 * except this.
 *
 * Two placements:
 *   - `search`: one quiet line under the results, with "No thanks". Declining is remembered across
 *     windows, so a user who never wants names stops seeing it.
 *   - `about`: always available while names are missing, so declining under the results is never
 *     permanent.
 */
export const NamesOffer = ({
  placement
}: {
  placement: "search" | "about";
}): React.ReactElement => {
  // Both invalidate EVERY `browseCounts` entry, because that query carries the names state: whether
  // it is installed (which shows the `#name`/`#place` tags, the Browse categories and the Names
  // section) and whether to keep offering it. One invalidation updates all of them together.
  const client = useQueryClient();
  const refresh = async (): Promise<void> =>
    client.invalidateQueries({ queryKey: ["browseCounts"] });
  const install = useMutation({ mutationFn: installNames, onSuccess: refresh });
  const decline = useMutation({ mutationFn: declineNames, onSuccess: refresh });

  if (install.isPending) {
    // The download's progress is VS Code's own notification; this says where it went.
    return (
      <p className={styles.offer} role="status">
        Installing names and places…
      </p>
    );
  }
  if (install.isError) {
    return (
      <p className={styles.offer} role="alert">
        Couldn’t install names and places: {install.error.message}{" "}
        <Button className={styles.action} onPress={() => install.mutate()}>
          Try again
        </Button>
      </p>
    );
  }
  return (
    <p className={styles.offer}>
      {placement === "search"
        ? "Names and places aren’t installed."
        : `An optional dictionary of personal and place names (${DOWNLOAD_SIZE} to download, about 400 MB on disk).`}{" "}
      <Button className={styles.action} onPress={() => install.mutate()}>
        {placement === "search"
          ? `Install (${DOWNLOAD_SIZE})`
          : "Install names and places"}
      </Button>
      {placement === "search" ? (
        <>
          {" "}
          <Button
            className={styles.dismiss}
            onPress={() => decline.mutate()}
            isDisabled={decline.isPending}
          >
            No thanks
          </Button>
        </>
      ) : null}
    </p>
  );
};
