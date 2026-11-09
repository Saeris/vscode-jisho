/**
 * Throughput benchmarks for the dictionary queries — the hot path no other bench covered.
 *
 * Every case here runs SYNCHRONOUSLY on the extension host's one thread. `node:sqlite` is a
 * synchronous binding (see `SqliteStore`), and that thread is shared with every other installed
 * extension, so a slow query is not only a slow search: it is a stall in everyone's hovers and
 * completions for as long as it runs. That is why these numbers matter beyond our own UI.
 *
 * The cases are what a user's session actually issues, not a synthetic sweep:
 *   - `search`, per keystroke of the query box (after the IME gate, per committed word)
 *   - `resolveByLemma` + `getWord`, per prose hover — the hover is ON by default
 *   - `refineCounts`, per tag added to the query box; the broad case takes the unrestricted path
 *   - `browse`, per category opened
 *
 * Runs against `assets/jisho.db` and skips without it, like the DB-backed specs. Use the FULL
 * dictionary (`vp run build:data:full`) for numbers worth acting on: the common-only build is a
 * fifth of the size and flatters every range scan.
 *
 * Run:      vp run bench
 * Baseline: vp run bench:save     (writes bench/baselines/dictionary-*.json)
 * Compare:  vp run bench:compare  (fails any case >15% slower)
 * Profile:  vp run bench:profile  (V8 logs + .deopt/findings.json; see bench/README.md)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { benchObserved } from "deoptkit/bench";
import { afterAll, beforeAll, describe, it } from "vite-plus/test";
import { against, baselineFor } from "./baseline";
import { Dictionary } from "../src/host/db";
import { CLASSIFIER_BY_ID, type Classifier } from "../src/shared/classifiers";

const DB_PATH = join(process.cwd(), "assets", "jisho.db");

const classifier = (id: string): Classifier => {
  const found = CLASSIFIER_BY_ID.get(id);
  if (!found) throw new Error(`no classifier "${id}" — the bench is stale`);
  return found;
};

/**
 * Cases that take whole seconds rather than microseconds. Five samples resolve a before/after
 * delta on a workload that heavy without making `vp run bench` take minutes (the same trade the
 * whole-document tokenizer cases make).
 */
const heavy = { iterations: 5 };

let sink = 0;

describe.skipIf(!existsSync(DB_PATH))("dictionary", () => {
  let dict: Dictionary;
  beforeAll(async () => {
    dict = await Dictionary.open(DB_PATH);
  });
  afterAll(async () => {
    await dict.close();
  });

  /**
   * One case per query SHAPE rather than one realistic mix: the shapes take different SQL paths
   * (an exact kanji hit, a kana prefix range, romaji converted to kana, a deinflected verb, a
   * miss), and a mix would report one number that a regression in any single path could hide in.
   */
  const queries: [label: string, query: string][] = [
    ["kanji word (日本語)", "日本語"],
    ["kana word (ねこ)", "ねこ"],
    ["romaji (taberu)", "taberu"],
    ["conjugated (食べました)", "食べました"],
    ["single kana — widest prefix range (の)", "の"],
    ["single kanji (日)", "日"],
    ["no match (ぬぬぬぬ)", "ぬぬぬぬ"]
  ];
  it.for(queries)("search: %s", async ([label, query], { bench, expect }) => {
    const id = `dictionary-search-${query}`;
    await against(
      bench,
      expect,
      id,
      benchObserved(
        bench,
        `search ${label}`,
        async () => {
          sink += (await dict.search(query)).length;
        },
        baselineFor(id)
      )
    );
  });

  // The prose hover: tokenizer lemma + POS straight to an entry, then its full detail. These two
  // run on every mouse rest over Japanese text in Markdown or plain text, which is on by default.
  it("hover: resolveByLemma (食べる, verb)", async ({ bench, expect }) => {
    const id = "dictionary-resolve-taberu";
    await against(
      bench,
      expect,
      id,
      benchObserved(
        bench,
        "resolveByLemma 食べる",
        async () => {
          sink += (await dict.resolveByLemma("食べる", "verb")) ? 1 : 0;
        },
        baselineFor(id)
      )
    );
  });

  it("hover: getWord (a common verb's full entry)", async ({
    bench,
    expect
  }) => {
    const id = "dictionary-getword";
    const resolved = await dict.resolveByLemma("食べる", "verb");
    if (!resolved)
      throw new Error(
        "食べる did not resolve — the DB is not the one expected"
      );
    await against(
      bench,
      expect,
      id,
      benchObserved(
        bench,
        "getWord 食べる",
        async () => {
          sink += (await dict.getWord(resolved.id))?.senses.length ?? 0;
        },
        baselineFor(id)
      )
    );
  });

  /**
   * The tag autocomplete's counts, per tag added (#27).
   *
   * Three regimes, chosen by the size of the applied filter's word pool against the 900-entry cap
   * on the `IN (…)` list in `refineCounts`:
   *   - nothing applied: the counts the build precomputed — a single small read
   *   - jlpt-n5 (667 words): under the cap, so the scan is restricted in SQL
   *   - jlpt-n1 (3,061) and noun (189,798): over it, so EVERY `sense_tags` row is read and the pool
   *     is applied in JS. Most tags are over 900, so this is the common path, not the edge case.
   */
  it("refineCounts: nothing applied (precomputed)", async ({
    bench,
    expect
  }) => {
    const id = "dictionary-refine-none";
    await against(
      bench,
      expect,
      id,
      benchObserved(
        bench,
        "refineCounts none",
        async () => {
          sink += Object.keys(await dict.refineCounts([])).length;
        },
        baselineFor(id)
      )
    );
  });

  it.for(["jlpt-n5", "jlpt-n1", "noun"])(
    "refineCounts: #%s applied",
    async (tag, { bench, expect }) => {
      const id = `dictionary-refine-${tag}`;
      const applied = [classifier(tag)];
      await against(
        bench,
        expect,
        id,
        benchObserved(
          bench,
          `refineCounts ${tag}`,
          async () => {
            sink += Object.keys(await dict.refineCounts(applied)).length;
          },
          baselineFor(id)
        ),
        heavy
      );
    }
  );

  // Opening a category from the Vocab tab: up to 2,000 hydrated rows.
  it.for(["jlpt-n5", "noun"])(
    "browse: #%s (frequency order)",
    async (tag, { bench, expect }) => {
      const id = `dictionary-browse-${tag}`;
      const target = classifier(tag);
      await against(
        bench,
        expect,
        id,
        benchObserved(
          bench,
          `browse ${tag}`,
          async () => {
            sink += (await dict.browse(target)).length;
          },
          baselineFor(id)
        ),
        heavy
      );
    }
  );

  it("getKanji (日)", async ({ bench, expect }) => {
    const id = "dictionary-getkanji";
    await against(
      bench,
      expect,
      id,
      benchObserved(
        bench,
        "getKanji 日",
        async () => {
          sink += (await dict.getKanji("日"))?.literal.length ?? 0;
        },
        baselineFor(id)
      )
    );
  });
});

// Keeps the optimizer from proving the results unused and eliding the work being measured.
export const benchSink = (): number => sink;
