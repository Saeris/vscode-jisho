import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { NamesDictionary } from "../names";

// Runs against the JMnedict database from `vp run build:data:names`. That build is large and
// occasional, so skip (rather than fail) when it hasn't been produced.
const DB_PATH = join(process.cwd(), "assets", "jisho-names.db");
const describeIfDb = existsSync(DB_PATH) ? describe : describe.skip;

describeIfDb("NamesDictionary (against built jisho-names.db)", () => {
  let dict: NamesDictionary;
  beforeAll(async () => {
    dict = await NamesDictionary.open(DB_PATH);
  });
  afterAll(async () => {
    await dict?.close();
  });

  // NOTE: JMnedict has many 田中 entries (every notable person/place with that surface), so tests
  // look for the specific たなか/Tanaka surname *among* the results rather than assuming it ranks
  // first — name ranking is coarse (the source has no commonness flag), acceptable for a secondary
  // feature.

  test("finds a name by its kanji and resolves the type tag", async () => {
    // WHY: the whole feature is name lookup with human-readable type badges. Searching 田中 must
    // surface the たなか surname reading, and a broken tag join would show the raw code ("surname")
    // rather than the description "family or surname".
    const results = await dict.searchNames("田中");
    const tanaka = results.find(
      (r) => r.headword === "田中" && r.reading === "たなか"
    );
    expect(tanaka).toBeDefined();
    expect(tanaka!.translationPreview).toBe("Tanaka");
    expect(tanaka!.types.some((t) => /surname/i.test(t))).toBe(true);
  });

  test("returns a populated result set for a common surname surface", async () => {
    // WHY: Japanese-input name lookup is the primary path; a common surname must return results,
    // all sharing the queried kanji. (Correctness of one specific entry is asserted above.)
    const results = await dict.searchNames("田中");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.headword.includes("田"))).toBe(true);
  });

  test("hydrates full name detail with resolved type descriptions", async () => {
    // WHY: the name detail view groups translations with their type badges; this guards the
    // translation + tag hydration end to end for the たなか/Tanaka surname entry specifically.
    const results = await dict.searchNames("田中");
    const surname = results.find(
      (r) => r.headword === "田中" && r.reading === "たなか"
    );
    expect(surname).toBeDefined();
    const detail = await dict.getName(surname!.id);
    expect(detail).not.toBeNull();
    expect(detail!.kanji).toContain("田中");
    expect(detail!.kana).toContain("たなか");
    const types = detail!.translations.flatMap((t) =>
      t.types.map((tt) => tt.description)
    );
    expect(types.some((d) => /surname/i.test(d))).toBe(true);
  });

  test("returns null for an unknown id", async () => {
    await expect(dict.getName("no-such-id")).resolves.toBeNull();
  });
});
