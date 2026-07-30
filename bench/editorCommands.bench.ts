/**
 * Throughput benchmark for the four editor-text commands — `addFurigana`, `removeFurigana`,
 * `addSpacing`, `removeSpacing` — the "did my change make it faster?" measure for the transforms the
 * user invokes on a selection and then WAITS for.
 *
 * Why this exists: these are registered VS Code commands (extension.ts) that rewrite the editor's
 * text, and they were the one user-facing path with no benchmark at all. `bench/entry.ts` had been
 * exporting `addFuriganaToLine`/`addSpacingToLine`/`removeFuriganaFromLine` for a profile that was
 * never written.
 *
 * Input design, measured before writing (bench/README.md rule 2 — find the driver, vary that): cost
 * is linear in JAPANESE characters, not in line count or in total length. Measured on rashomon.txt:
 *
 *   Japanese lines, avg  60 chars    1.84 µs/char
 *   Japanese lines, avg 217 chars    2.65 µs/char
 *   ASCII line,         90 chars     0.04 µs/char   — 60x cheaper
 *
 * ASCII falls off a cliff because `japaneseRuns` finds nothing to tokenize and the line short-circuits
 * before reaching the tokenizer. So a mixed-script document costs whatever its Japanese fraction is,
 * and "lines" is the wrong unit to think in.
 *
 * The tokenizer (WASM) dominates, which also bounds what this can tell you: deoptkit cannot see
 * inside it (bench/README.md, Scope), so a finding here would have to be in OUR string assembly. The
 * inverse direction is the interesting contrast — `removeFurigana` never tokenizes at all, and is
 * ~35x cheaper per line as a result.
 *
 * Scale, MEASURED rather than extrapolated: "add furigana" over a whole novel (wagahai-neko.txt,
 * 295,713 Japanese characters) takes 916 ms. Note that this is 3.10 µs/char against the 2.3 µs/char a
 * short story shows — the per-character rate is NOT constant across scales, so extrapolating from the
 * small cases understates the big one by ~30% (which is exactly what a first draft of this comment
 * did). ~0.9s is the case a 2x regression would be felt in, which is why this file is a gate rather
 * than an optimization target.
 * Document-scale TOKENIZATION is already covered by tokenize.bench.ts, so the cases here stop at a
 * short story to keep the sample count high enough to mean something.
 *
 * Run:      vp run bench
 * Baseline: vp run bench:save
 * Compare:  vp run bench:compare
 */
import { readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import { addFurigana, removeFurigana } from "../src/host/furigana";
import { addSpacing, removeSpacing } from "../src/host/spacing";

const rashomon = readFileSync(
  new URL("fixtures/rashomon.txt", import.meta.url),
  "utf8"
);

/** What someone actually selects: a few sentences, not a whole file. */
const paragraph = rashomon
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "")
  .slice(0, 3)
  .join("\n");

// Annotated/spaced inputs for the inverse commands, prepared once so the benches measure only the
// direction they name.
const annotated = await addFurigana(paragraph);
const spaced = await addSpacing(paragraph);

let sink = 0;

describe("editor commands", () => {
  // The common interaction: a selection of a few sentences.
  bench("addFurigana: a 3-line selection", async () => {
    sink += (await addFurigana(paragraph)).length;
  });

  bench("addSpacing: a 3-line selection", async () => {
    sink += (await addSpacing(paragraph)).length;
  });

  // The inverse pair tokenizes nothing, so these isolate our own string work — the only part of this
  // path a deoptkit finding could be about.
  bench("removeFurigana: a 3-line selection", async () => {
    sink += (await removeFurigana(annotated)).length;
  });

  bench("removeSpacing: a 3-line selection", async () => {
    sink += (await removeSpacing(spaced)).length;
  });

  // Whole-file scale, at a size that still samples enough times to have a usable margin of error.
  bench("addFurigana: a whole short story (47 lines)", async () => {
    sink += (await addFurigana(rashomon)).length;
  });
});

// Keep `sink` observable so the compiler can't delete the calls (bench/README.md rule 5).
if (sink === -1) throw new Error(String(sink));
