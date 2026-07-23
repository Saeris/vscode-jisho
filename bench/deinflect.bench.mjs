/**
 * Deinflection deopt profile — the "WHY is this slow / is it well-shaped?" companion to
 * deinflect.bench.ts's "did it get faster?".
 *
 * Unlike the tokenizer (WASM, opaque) this is pure JS deoptkit sees fully, so a finding here is
 * actionable. The hot inner loop is the ~90-rule `endsWith`/`slice` scan re-run over the frontier
 * at each depth; the object shapes to watch are the `[from, tos]` rule tuples, the string
 * candidates, and the Set/array frontier bookkeeping.
 *
 * Run:  vp run bench:build && vp exec node bench/deinflect.bench.mjs
 * Then: profile_run { command: ["node", "bench/deinflect.bench.mjs"] }
 *       get_findings { sessionId, fromMark: "deinflect_start", toMark: "deinflect_end" }
 *       list_functions { sessionId }
 */
import { observed } from "deoptkit/harness";
import { deinflect } from "../dist/bench/entry.mjs";

// The same realistic spread the throughput bench uses, cycled so V8 sees VARIED input shapes rather
// than one repeated string — the input distribution, not a single case, is what a real query stream
// looks like (bench/README.md rule 3).
const QUERIES = [
  "ねこ",
  "いぬ",
  "みず",
  "ほん",
  "はなします",
  "たべます",
  "のみます",
  "いった",
  "きって",
  "たべなかった",
  "たかくない",
  "たべています",
  "られる",
  "させる"
];

let sink = 0;

// ~200k calls: enough for V8's inline caches to escalate and optimizing tiers to engage on the
// rule-scan loop, which is the state a long search session reaches.
observed(
  "deinflect",
  (i) => {
    sink += deinflect(QUERIES[i % QUERIES.length]).length;
  },
  { iterations: 200_000 }
);

console.log(`sink=${sink}`);
