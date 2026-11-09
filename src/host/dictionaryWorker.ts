/**
 * A dictionary database, served from a worker thread.
 *
 * `node:sqlite` is synchronous, and the extension host is ONE thread shared by every installed
 * extension — so every query used to stall all of them for as long as it ran. Measured: adding one
 * tag to the search box ran `refineCounts` for 0.3-2 s, blocking every other extension's hovers and
 * completions for that long (audit P-1, I-5). In here, the same query only delays its own answer.
 *
 * The whole `Dictionary` (or `NamesDictionary`) lives here, not just the SQL: hydrating a result takes
 * several queries plus JavaScript, and running all of it on this side means only the finished DTO
 * crosses back. The tokenizer stays on the main thread, where its callers are.
 *
 * Bundled as its own entry (`dist/dictionaryWorker.cjs`), because a worker is a separate script. It
 * must not import `vscode`: VS Code provides that module only on the extension host's main thread.
 *
 * Protocol: `{ id, method, args }` in; `{ id, ok, value | error }` out. Id 0 reports the open itself.
 * `close` closes the database and ends the worker, releasing the file — which is what lets a
 * dictionary update rename onto it on Windows.
 */
import { parentPort, workerData } from "node:worker_threads";
import { Dictionary, SchemaVersionError } from "./db";
import { NamesDictionary } from "./names";
import type { SerializedError, WorkerReply, WorkerRequest } from "./remote";

/** What `workerData` carries: which database, and where. */
interface Boot {
  kind: "words" | "names";
  path: string;
}

const isBoot = (value: unknown): value is Boot =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  (value.kind === "words" || value.kind === "names") &&
  "path" in value &&
  typeof value.path === "string";

/** Enough of an error to rebuild it on the other side — including a schema mismatch's versions. */
const serialize = (error: unknown): SerializedError => {
  if (error instanceof SchemaVersionError) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      expected: error.expected,
      found: error.found
    };
  }
  if (error instanceof Error)
    return { name: error.name, message: error.message, stack: error.stack };
  return { name: "Error", message: String(error) };
};

const main = async (): Promise<void> => {
  const port = parentPort;
  if (!port) throw new Error("dictionaryWorker must run as a worker thread");
  if (!isBoot(workerData))
    throw new Error("dictionaryWorker needs { kind, path }");
  const { kind, path } = workerData;
  const reply = (message: WorkerReply): void => port.postMessage(message);

  let target: Dictionary | NamesDictionary;
  try {
    target =
      kind === "words"
        ? await Dictionary.open(path)
        : await NamesDictionary.open(path);
    reply({ id: 0, ok: true, value: undefined });
  } catch (error) {
    reply({ id: 0, ok: false, error: serialize(error) });
    port.close();
    return;
  }

  port.on("message", (request: WorkerRequest) => {
    void (async (): Promise<void> => {
      try {
        if (request.method === "close") {
          await target.close();
          reply({ id: request.id, ok: true, value: undefined });
          port.close();
          return;
        }
        const method: unknown = Reflect.get(target, request.method);
        if (typeof method !== "function") {
          throw new Error(`The dictionary has no method "${request.method}".`);
        }
        const value: unknown = await Reflect.apply(
          method,
          target,
          request.args
        );
        reply({ id: request.id, ok: true, value });
      } catch (error) {
        reply({ id: request.id, ok: false, error: serialize(error) });
      }
    })();
  });
};

void main();
