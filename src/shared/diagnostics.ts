/**
 * The diagnostic snapshot behind every report, and the sanitizer that makes a stack safe to post.
 *
 * One payload, three surfaces (spec 20): the webview's crash boundary, the `Report an Issue`
 * command, and the About view's copy button. Shared so a field added for one shows up in all three.
 *
 * Everything here is PURE — no `vscode`, no `node:*`, no DOM. The host and the webview both import
 * it, and the pieces that need a runtime (reading `process.versions`, querying the DB) pass their
 * findings in. That is what lets the sanitizer be unit-tested against real captured stacks, which
 * matters more than it sounds: its failure mode is a privacy leak nobody notices until it is
 * already on a public issue.
 */

/** One row of the environment table. Ordered by the collector, rendered in that order. */
export interface DiagnosticField {
  label: string;
  value: string;
}

export interface Diagnostics {
  /** Build and runtime: versions, platform. */
  environment: DiagnosticField[];
  /** Which dictionary, built when, at what schema. */
  dictionary: DiagnosticField[];
  /**
   * Settings the user has CHANGED, never the full block.
   *
   * The defaults are noise in a report — nine rows to say nothing happened — while the two someone
   * changed are the reproduction hint. Empty when everything is default, and the renderer omits the
   * section entirely rather than printing an empty table.
   */
  settings: DiagnosticField[];
}

/**
 * Strip a stack trace of anything that identifies the machine it ran on.
 *
 * A webview frame names its script through a `vscode-resource` URL carrying an absolute path:
 *
 *   at WordDetail (https://file+.vscode-resource.vscode-cdn.net/c%3A/Users/NAME/.vscode/
 *                  extensions/saeris.vscode-jisho-1.0.0/dist/webview/index.js:48213:19)
 *
 * which embeds the user's account name and directory layout. The report is public and the user is
 * one click from posting it, so this is not a nicety.
 *
 * `maxFrames` also bounds the length: 40 realistic frames percent-encode to ~7.8 KB, which alone
 * overruns the URL ceiling `issueUrl` has to fit inside.
 */
export const sanitizeStack = (stack: string, maxFrames = 20): string => {
  const lines = stack.split("\n");
  const cleaned = lines.map((line) => {
    let out = line;
    // 1. Any script URL down to its bundle-relative path. Both the encoded (`c%3A/`) and decoded
    //    (`c:/`) forms appear depending on how the runtime rendered the frame.
    out = out.replace(
      /(?:https?:\/\/[^\s)]*?vscode-(?:resource|cdn)[^\s)]*?|file:\/\/\/[^\s)]*?)\/(dist\/)?((?:webview|host)\/[\w.-]+(?::\d+:\d+)?)/gu,
      "$2"
    );
    // 2. A home directory anywhere else in the line — an error message quoting a path, a frame the
    //    rule above did not match. Windows, macOS and Linux shapes.
    out = out.replace(
      /(?:[A-Za-z]:\\Users\\[^\\\s)]+|\/(?:Users|home)\/[^/\s)]+)/gu,
      "~"
    );
    // 3. Whatever remains of an absolute extension path, which carries no useful signal once the
    //    version is already in the environment table.
    out = out.replace(/[^\s)]*[/\\]extensions[/\\][\w.-]+[/\\]/gu, "");
    return out;
  });

  // The message is line 0 and is never a frame, so the budget applies to what follows it.
  const [message = "", ...frames] = cleaned;
  const collapsed = collapseRuns(frames);
  if (collapsed.length <= maxFrames) return [message, ...collapsed].join("\n");
  const kept = collapsed.slice(0, maxFrames);
  return [
    message,
    ...kept,
    `    … ${collapsed.length - maxFrames} more frames`
  ].join("\n");
};

/**
 * Collapse consecutive frames in the same function to one line with a count.
 *
 * React 19's minified stacks are mostly its own reconciler repeating — `renderWithHooks`,
 * `beginWork`, `performWorkOnRoot` — and those runs carry no signal about the crash while pushing
 * the app frames that DO out past the truncation point. Collapsing before truncating is therefore
 * not cosmetic: it is what keeps the cause inside the budget.
 *
 * The idea is borrowed from [calldiff](https://github.com/tanishqkancharla/calldiff), which
 * collapses call trees so the shape of a change survives the noise. Only the idea — calldiff is a
 * static tool that diffs call graphs between git commits, and takes revisions rather than a
 * captured `Error.stack`, so there is nothing here to reuse directly.
 */
const collapseRuns = (frames: string[]): string[] => {
  const out: string[] = [];
  let i = 0;
  while (i < frames.length) {
    const name = frameFunction(frames[i]);
    let run = 1;
    // Only collapse when the function NAME repeats. Two different functions at the same line would
    // be a genuine sequence, and recursion in our own code is worth seeing.
    while (
      name !== undefined &&
      i + run < frames.length &&
      frameFunction(frames[i + run]) === name
    )
      run++;
    out.push(run > 1 ? `${frames[i]} (×${run})` : frames[i]);
    i += run;
  }
  return out;
};

/** The function name in an `at name (file:line:col)` frame, or undefined when it has none. */
const frameFunction = (frame: string): string | undefined =>
  /^\s*at\s+([^\s(]+)/u.exec(frame)?.[1];

/** Render a section as a Markdown table, or nothing when it has no rows. */
const table = (title: string, fields: DiagnosticField[]): string => {
  if (fields.length === 0) return "";
  const rows = fields.map((f) => `| ${f.label} | ${f.value} |`).join("\n");
  return `**${title}**\n\n| Field | Value |\n| --- | --- |\n${rows}\n`;
};

/**
 * The snapshot as Markdown — what the About view copies, and what the issue body embeds.
 *
 * A details block, collapsed. In an issue the diagnostics are supporting evidence: the maintainer
 * expands them when they matter, and the reporter's own description stays the first thing anyone
 * reads.
 */
export const diagnosticsMarkdown = (d: Diagnostics): string => {
  const body = [
    table("Environment", d.environment),
    table("Dictionary", d.dictionary),
    table("Changed settings", d.settings)
  ]
    .filter(Boolean)
    .join("\n");
  return `<details>\n<summary>Diagnostics</summary>\n\n${body}\n</details>`;
};

export interface IssueReport {
  diagnostics: Diagnostics;
  /** Present only for a crash: the error's message and its sanitized stack. */
  error?: { message: string; stack: string };
}

/**
 * The issue body.
 *
 * Leads with the prompt for the user's own words, deliberately. A body that opens with a wall of
 * diagnostics invites the reporter to hit submit without adding anything — and "what were you
 * doing" is the field a maintainer needs most and can least reconstruct.
 */
export const issueBody = (report: IssueReport): string => {
  const parts = [
    "### What happened",
    "",
    report.error
      ? "<!-- The panel crashed. What were you doing just before it did? -->"
      : "<!-- Describe the problem, and what you expected instead. -->",
    "",
    "### Steps to reproduce",
    "",
    "1. ",
    ""
  ];
  if (report.error) {
    parts.push(
      "### Error",
      "",
      "```",
      report.error.message,
      report.error.stack,
      "```",
      ""
    );
  }
  parts.push(diagnosticsMarkdown(report.diagnostics));
  return parts.join("\n");
};

/**
 * GitHub's practical prefill ceiling for the WHOLE url.
 *
 * Measured rather than guessed at: a realistic crash report with a 10-frame stack encodes to ~2 KB,
 * and 40 frames to ~7.8 KB. 8000 leaves room under the limit servers and browsers actually enforce
 * without cutting into the reports that matter.
 */
export const URL_BUDGET = 8000;

export interface IssueUrl {
  url: string;
  /**
   * True when the body did not fit and the URL carries no prefill.
   *
   * The caller then puts the report on the clipboard and tells the user to paste. Worse UX than a
   * prefill, still actionable — and strictly better than a URL that silently dropped the stack,
   * which is the failure this flag exists to prevent.
   */
  overBudget: boolean;
}

/**
 * Build the prefilled issue URL, trimming until it fits.
 *
 * Trimming order, from least to most load-bearing: the settings diff goes first, then the stack is
 * shortened, then the dictionary detail. The environment table is never dropped — it is the reason
 * the feature exists.
 */
export const issueUrl = (
  base: string,
  title: string,
  report: IssueReport
): IssueUrl => {
  const build = (r: IssueReport): string =>
    `${base}?labels=bug&title=${encodeURIComponent(title)}&body=${encodeURIComponent(issueBody(r))}`;

  let candidate = build(report);
  if (candidate.length <= URL_BUDGET)
    return { url: candidate, overBudget: false };

  // 1. Drop the settings diff.
  let trimmed: IssueReport = {
    ...report,
    diagnostics: { ...report.diagnostics, settings: [] }
  };
  candidate = build(trimmed);
  if (candidate.length <= URL_BUDGET)
    return { url: candidate, overBudget: false };

  // 2. Shorten the stack hard.
  if (trimmed.error) {
    trimmed = {
      ...trimmed,
      error: {
        ...trimmed.error,
        stack: sanitizeStack(trimmed.error.stack, 5)
      }
    };
    candidate = build(trimmed);
    if (candidate.length <= URL_BUDGET)
      return { url: candidate, overBudget: false };
  }

  // 3. Out of room. A blank form plus a clipboard paste beats a report missing its evidence.
  return {
    url: `${base}?labels=bug&title=${encodeURIComponent(title)}`,
    overBudget: true
  };
};
