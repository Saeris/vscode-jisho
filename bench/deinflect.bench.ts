/**
 * Throughput benchmark for rule-based deinflection — the "did my change make it faster?" measure.
 *
 * `deinflect()` runs on EVERY search, before the SQL query, expanding a conjugated query into
 * candidate dictionary forms. It is pure JS (deoptkit can see it; see deinflect.bench.mjs), so a
 * regression here is a regression on the search hot path.
 *
 * Input design, measured before writing (bench/README.md rule 2 — find the driver, vary that):
 * cost tracks the NUMBER OF DERIVATION STEPS, i.e. how deep the chain recurses, not how wide it
 * branches. Each depth re-scans all ~90 rules over the whole frontier, so a query that normalizes
 * through intermediate forms (なかった → ない → verb stems) is the expensive class. Measured spread:
 *
 *   no-match (0 candidates)          0.49 µs   — pure rule-scan floor
 *   simple polite (2-3 candidates)   2.7  µs
 *   broad branch られる (1 cand)      1.3  µs   — wide at depth 0, but shallow: cheap
 *   adjective / progressive chains   ~6   µs
 *   negative chain (8 candidates)    8.3  µs   — the worst: chains through multiple depths
 *
 * A 17× spread. The sample below spans it. Absolute cost is tiny (~8µs worst), so this bench exists
 * to CATCH A REGRESSION on the search path, not because deinflection is slow today.
 *
 * Run:      vp run bench
 * Baseline: vp run bench:save
 * Compare:  vp run bench:compare
 */
import { it, describe } from "vite-plus/test";
import { against, baselineFor } from "./baseline";
import { deinflect } from "../src/host/deinflect";

let sink = 0;

describe("deinflect", () => {
  // A realistic search MIX — the aggregate a user's session produces, weighted toward the common
  // cases (nouns and simple polite forms) with the expensive chains present but not dominant. This
  // is the headline number: "did deinflection over a realistic query stream get slower?".
  const mix = [
    "ねこ",
    "いぬ",
    "みず",
    "ほん", // no-match nouns — the plurality of real queries
    "はなします",
    "たべます",
    "のみます", // simple polite
    "いった",
    "きって", // past/te
    "たべなかった", // negative chain (worst class)
    "たかくない", // adjective
    "たべています" // progressive chain
  ];
  it("realistic query mix", async ({ bench, expect }) => {
    await against(
      bench,
      expect,
      "deinflect-realistic-query-mix",
      bench(
        "realistic query mix",
        baselineFor("deinflect-realistic-query-mix"),
        () => {
          for (const q of mix) sink += deinflect(q).length;
        }
      )
    );
  });

  // The extremes, isolated, so a change's effect can be attributed: an optimization to the rule
  // scan should move the no-match floor; one to chain handling should move the negative case.
  it("no-match floor (plain noun)", async ({ bench, expect }) => {
    await against(
      bench,
      expect,
      "deinflect-no-match-floor-plain-noun",
      bench(
        "no-match floor (plain noun)",
        baselineFor("deinflect-no-match-floor-plain-noun"),
        () => {
          sink += deinflect("ねこ").length;
        }
      )
    );
  });

  it("worst: negative chain (たべなかった)", async ({ bench, expect }) => {
    await against(
      bench,
      expect,
      "deinflect-worst-negative-chain",
      bench(
        "worst: negative chain (たべなかった)",
        baselineFor("deinflect-worst-negative-chain"),
        () => {
          sink += deinflect("たべなかった").length;
        }
      )
    );
  });

  it("common: simple polite (はなします)", async ({ bench, expect }) => {
    await against(
      bench,
      expect,
      "deinflect-common-simple-polite",
      bench(
        "common: simple polite (はなします)",
        baselineFor("deinflect-common-simple-polite"),
        () => {
          sink += deinflect("はなします").length;
        }
      )
    );
  });
});

// Keep `sink` observable so the compiler can't delete the calls (bench/README.md rule 5).
if (sink === -1) throw new Error(String(sink));
