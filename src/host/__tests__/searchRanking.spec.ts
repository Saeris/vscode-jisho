import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";
import { RANK_ORDER_BY, byRank, type RankKeys } from "../queries/search";

/**
 * Search ranks twice: in SQL for what the query finds, and in JavaScript for what the deinflection
 * merge adds after it. If the two orders drift, results shuffle depending on whether a query took
 * that path — so both run here over the same rows, ties and missing frequencies included.
 */

/** A small deterministic generator, so a failure names rows that can be reproduced. */
const generator = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
};

/** Rows dense in ties: few scores, few frequency bands, unranked words, both commonness values. */
const rows = (count: number, seed: number): RankKeys[] => {
  const next = generator(seed);
  return Array.from({ length: count }, () => ({
    score: [90, 100, 115, 125][Math.floor(next() * 4)],
    freqRank: next() < 0.3 ? null : 1 + Math.floor(next() * 5),
    common: next() < 0.5 ? 1 : 0
  }));
};

const keyOf = (r: RankKeys): string => `${r.score}/${r.freqRank}/${r.common}`;

describe("search ranking", () => {
  it.for([1, 2, 3])(
    "orders rows the same in SQL and in JavaScript (seed %i)",
    (seed) => {
      // WHY (audit I-8): the order was written twice, in two languages, kept in step by a comment
      // saying they "must agree". This is what holds them to it — including the unranked words,
      // which SQL and JavaScript put last only if both are told to.
      const data = rows(300, seed);
      using db = new DatabaseSync(":memory:");
      db.exec(
        "CREATE TABLE r (score INTEGER, freq_rank INTEGER, common INTEGER)"
      );
      const insert = db.prepare("INSERT INTO r VALUES (?, ?, ?)");
      for (const r of data) insert.run(r.score, r.freqRank, r.common);

      const sql = (
        db
          .prepare(
            `SELECT score, freq_rank, common FROM r ORDER BY ${RANK_ORDER_BY}`
          )
          .all() as {
          score: number;
          freq_rank: number | null;
          common: number;
        }[]
      ).map((r) => ({
        score: r.score,
        freqRank: r.freq_rank,
        common: r.common
      }));

      // Compared as KEYS: rows equal on every key may come back in any order from either side.
      expect(data.toSorted(byRank).map(keyOf)).toEqual(sql.map(keyOf));
    }
  );
});
