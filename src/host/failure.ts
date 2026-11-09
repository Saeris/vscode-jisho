/**
 * Turn a dictionary failure into the reason the panel explains it by.
 *
 * Each reason has a different recovery, which is the point of telling them apart. Before this, every
 * failure reached the webview as a bare message, so the only thing on offer was to report it — a
 * user who was simply offline, or whose dictionary needed updating, was asked to file a bug (audit
 * SM-10, I-2).
 */
import { SchemaVersionError } from "./db";
import type { FailureReason } from "../shared/messages";

/** Node's codes for a connection that never got an answer. */
const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET"
]);

/** An error and every `cause` beneath it — `fetch` wraps the useful one. */
const chain = (error: unknown): unknown[] => {
  const errors: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && errors.length < 5) {
    errors.push(current);
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return errors;
};

const isNetworkFailure = (error: unknown): boolean =>
  chain(error).some(
    (e) =>
      (typeof e === "object" &&
        e !== null &&
        "code" in e &&
        typeof e.code === "string" &&
        NETWORK_CODES.has(e.code)) ||
      // `fetch` itself, before any cause is attached.
      (e instanceof TypeError && e.message === "fetch failed") ||
      // The release answered, but with a server error: worth retrying, so treated like no answer.
      (e instanceof Error && /^Download failed: .* → 5\d\d\b/u.test(e.message))
  );

export const classifyFailure = (error: unknown): FailureReason => {
  if (error instanceof SchemaVersionError) {
    // Which side is newer decides the recovery: an older file is fixed by updating the dictionary,
    // a newer one only by updating Jisho. `SchemaVersionError`'s own message always said the
    // former, which sent users to an update check that then reported "up to date".
    return error.found > error.expected ? "schema-newer" : "schema-older";
  }
  if (isNetworkFailure(error)) return "offline";
  return "io";
};
