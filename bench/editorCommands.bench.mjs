/**
 * Editor-command deopt profile — the "WHY is this slow / is it well-shaped?" companion to
 * editorCommands.bench.ts's "did it get faster?".
 *
 * Scope caveat up front: the ADD direction is dominated by the tokenizer, which is WASM and opaque to
 * deoptkit (bench/README.md, Scope). So a finding in an `add*` window can only ever be about OUR
 * string assembly around the tokenizer, and the ticks will be mostly unattributable. The REMOVE
 * direction tokenizes nothing, which makes it the window where a finding is unambiguous — it is all
 * our own code.
 *
 * Windows are marked per command so findings can be attributed to one, rather than to "the editor
 * commands" as a blob.
 *
 * Run:  vp run bench:build && vp exec node bench/editorCommands.bench.mjs
 * Then: profile_run { command: ["node", "bench/editorCommands.bench.mjs"] }
 *       get_findings { sessionId, fromMark: "removeFurigana_start", toMark: "removeFurigana_end" }
 *       list_functions { sessionId }
 * Or headless (no MCP): vp exec deoptkit ci bench/editorCommands.bench.mjs
 */
import { readFileSync } from "node:fs";
import { observed } from "deoptkit/harness";
import {
  addFuriganaToLine,
  addSpacingToLine,
  removeFuriganaFromLine
} from "../dist/entry.mjs";

const lines = readFileSync(
  new URL("fixtures/rashomon.txt", import.meta.url),
  "utf8"
)
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "");

let sink = 0;

// Pre-annotate once: the remove window must measure removal, not the addition feeding it. Concurrent
// rather than serial because this is setup — nothing here depends on line order being processed in
// sequence, only on the RESULTS staying in order, which Promise.all guarantees.
const annotated = await Promise.all(lines.map(addFuriganaToLine));

// The add direction is ~2 orders of magnitude slower per call, so it gets proportionally fewer
// iterations — enough for V8 to optimize the JS around the tokenizer without the profile taking
// minutes. The remove direction is cheap, so it gets the iteration count that actually escalates ICs.
observed(
  "addFurigana",
  async (i) => {
    sink += (await addFuriganaToLine(lines[i % lines.length])).length;
  },
  { iterations: 5_000 }
);

observed(
  "addSpacing",
  async (i) => {
    sink += (await addSpacingToLine(lines[i % lines.length])).length;
  },
  { iterations: 5_000 }
);

observed(
  "removeFurigana",
  (i) => {
    sink += removeFuriganaFromLine(annotated[i % annotated.length]).length;
  },
  { iterations: 200_000 }
);

console.log(`sink=${sink}`);
