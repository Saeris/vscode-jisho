/**
 * Open a prefilled GitHub issue.
 *
 * The single exit point for every report, whichever surface raised it: the `Report an Issue`
 * command, and the webview's crash boundary through the bridge. Both arrive here so the URL budget
 * and the clipboard fallback are decided in one place. See docs/specs/20-crash-and-issue-reporting.md.
 */
import * as vscode from "vscode";
import {
  issueBody,
  issueUrl,
  sanitizeStack,
  type Diagnostics
} from "../shared/diagnostics";
import { collectDiagnostics } from "./diagnostics";

const ISSUES = "https://github.com/Saeris/vscode-jisho/issues/new";

export interface ReportOptions {
  /** Prefills the issue title. A crash names itself; a manual report leaves the user to say. */
  title: string;
  /** Present only for a crash. The stack must already be sanitized by the caller. */
  error?: { message: string; stack: string };
  /** The dictionary's metadata, or undefined when the dictionary is the thing that failed. */
  meta?: Record<string, string>;
}

/**
 * Collect, build the URL, and open it.
 *
 * When the body does not fit GitHub's prefill ceiling, the report goes to the CLIPBOARD and the
 * user is told to paste. That is worse UX and strictly better than the alternative — a URL that
 * silently dropped the stack still looks like a complete report, and a maintainer would never know
 * the evidence had been trimmed away.
 */
export const openIssueReport = async (
  context: vscode.ExtensionContext,
  { title, error, meta }: ReportOptions
): Promise<void> => {
  let diagnostics: Diagnostics;
  try {
    diagnostics = await collectDiagnostics(context, meta);
  } catch {
    // Collection itself failed. Reporting something beats reporting nothing, so fall through with
    // an empty snapshot rather than letting the reporter throw on the way to reporting a crash.
    diagnostics = { environment: [], dictionary: [], settings: [] };
  }
  const report = { diagnostics, error };
  const { url, overBudget } = issueUrl(ISSUES, title, report);

  if (overBudget) {
    await vscode.env.clipboard.writeText(issueBody(report));
    void vscode.window.showInformationMessage(
      "The report was too long to prefill. It has been copied to your clipboard — paste it into the issue."
    );
  }
  await openUrl(url);
};

/**
 * Hand `openExternal` the URL as a STRING, never as a parsed `Uri`.
 *
 * `Uri.parse` DECODES the query into its components, so `%23` (an escaped `#`, which must stay
 * escaped or it would truncate the body at the first heading) is stored as a raw `#`. `toString()`
 * then re-encodes it per-character — and the result reaches GitHub as literal `%23%23%23` text
 * where the body's `###` headings should be. Reported against 0.1.2 as issue #4.
 *
 * `openExternal` accepts a string at runtime and keeps it verbatim when parsing it round-trips
 * unchanged ("called with string and no transformation happened -> keep string", mainThreadWindow),
 * which is exactly our case. The cast is needed only because `@types/vscode` narrows the parameter
 * to `Uri` — see [microsoft/vscode#85930](https://github.com/microsoft/vscode/issues/85930), the
 * still-open request to widen it to `URL`.
 *
 * This is the established workaround, not a local trick: the same string cast is what a VS Code
 * contributor arrived at in
 * [#135949](https://github.com/microsoft/vscode/issues/135949#issuecomment-989333270) after first
 * reaching for the `open` package — which is a dependency to solve what one cast solves. Passing a
 * `Uri` built by `Uri.from` does NOT work either; `from` decodes its components too.
 */
const openUrl = async (url: string): Promise<void> => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const open = vscode.env.openExternal as (
    target: string | vscode.Uri
  ) => Thenable<boolean>;
  await open(url);
};

/**
 * Show an error notification that can be reported.
 *
 * The single place `showErrorMessage` is called, so an error the user sees is never a dead end —
 * the principle spec 21 is built on. Introduced with one caller (activation) rather than left for
 * later, because the value is in it being the only door.
 */
export const showReportableError = async (
  context: vscode.ExtensionContext,
  message: string,
  error: unknown
): Promise<void> => {
  const detail = error instanceof Error ? error.message : String(error);
  const choice = await vscode.window.showErrorMessage(
    `${message} ${detail}`,
    "Report this problem"
  );
  if (choice === undefined) return;
  await openIssueReport(context, {
    title: `${message} ${detail}`,
    // The stack is worth having here in a way it is not for a query rejection: a host throw's stack
    // names OUR code, not the bridge's plumbing.
    error:
      error instanceof Error
        ? { message: detail, stack: sanitizeStack(error.stack ?? "") }
        : undefined
  });
};
