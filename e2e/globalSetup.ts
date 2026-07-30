import { execFileSync, spawnSync } from "node:child_process";
import { DEBUG_PORT } from "./launch";

/**
 * Kill VS Code instances left behind by a previous E2E run, before this one starts.
 *
 * The harness refuses to attach to a debug port it did not open (see `launch.ts`) — a deliberate
 * safety property, since attaching to someone else's CDP target can drive or close the developer's
 * real editor. The cost is that ONE leaked process fails every subsequent run until it is killed by
 * hand, and a run gets interrupted often enough for that to be a routine annoyance rather than a
 * rare one: a timeout, a Ctrl-C, or a `beforeAll` that throws before `afterAll` can clean up.
 *
 * So the port guard stays, and this makes the leak self-healing instead.
 *
 * SCOPE is the whole point. Only processes matching `--remote-debugging-port=<our port>` AND running
 * from this repo's `.vscode-test/` install are eligible. The developer's real VS Code sets neither,
 * so it can never match — the same reasoning that lets `launch.ts` kill by PID tree rather than by
 * name. SIGTERM first, then SIGKILL for survivors, because Electron's main process does not always
 * exit on the former.
 */

/** Matches only the harness's own instances: our debug port, our test install. */
const isOurs = (command: string): boolean =>
  command.includes(`--remote-debugging-port=${DEBUG_PORT}`) &&
  command.includes(".vscode-test");

const harnessPids = (): number[] => {
  if (process.platform === "win32") {
    // No pgrep; WMIC exposes the full command line, which is what the scope test needs.
    // Annotated nullable on purpose: the type says string, but a spawn that fails to launch (no
    // wmic on PATH) yields null, and this must degrade to "found nothing" rather than throw.
    const out: string | null = spawnSync(
      "wmic",
      ["process", "get", "ProcessId,CommandLine", "/format:csv"],
      { encoding: "utf8" }
    ).stdout;
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- typed string, null in practice
    return (out ?? "")
      .split("\n")
      .filter(isOurs)
      .map((line) => Number(line.trim().split(",").at(-1)))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  }
  const out: string | null = spawnSync("ps", ["ax", "-o", "pid=,command="], {
    encoding: "utf8"
  }).stdout;
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- typed string, null in practice
  return (out ?? "")
    .split("\n")
    .filter(isOurs)
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
};

const signal = (pids: number[], sig: "SIGTERM" | "SIGKILL"): void => {
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore"
        });
      } else {
        process.kill(pid, sig);
      }
    } catch {
      // Already gone between listing and signalling — the desired end state either way.
    }
  }
};

const wait = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

// Playwright resolves globalSetup by DEFAULT export; a named one is not picked up.
// oxlint-disable-next-line import/no-default-export
export default async function globalSetup(): Promise<void> {
  let pids = harnessPids();
  if (pids.length === 0) return;

  console.log(
    `e2e: reaping ${pids.length} leaked VS Code process(es) from a previous run: ${pids.join(", ")}`
  );
  signal(pids, "SIGTERM");
  await wait(2000);

  pids = harnessPids();
  if (pids.length > 0) {
    signal(pids, "SIGKILL");
    await wait(1000);
  }

  const survivors = harnessPids();
  if (survivors.length > 0) {
    // Loud rather than silent: if these cannot be killed, every test is about to fail on the port
    // guard, and the reason should be this message instead of a confusing attach error.
    throw new Error(
      `e2e: could not reap leaked VS Code process(es) ${survivors.join(", ")} — kill them manually before rerunning.`
    );
  }
}
