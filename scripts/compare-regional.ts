/**
 * Compare the regional forms in a built database with hanji's published data (spec 22, phase 1).
 *
 *   vp exec node scripts/compare-regional.ts [db-path]
 *
 * Not a CI check: hanji is a reference, not the truth, and it differs from ours on purpose. Run it
 * after changing the grouping in scripts/regional.ts or bumping a pin, and explain every new
 * difference. The ones known on 2026-11-10, and why:
 *
 * - Glyph signatures of 8 groups (搜 冤 乖 拄 蠨 諲 覈 螱): Korea's glyph linked two regions; we
 *   compare only our four. A fifth digit where hanji has none: an old form hanji loses in a merge.
 * - Hong Kong's column: Unihan's kHKGlyph names a different code point than hanji's transcription of
 *   the list (倶 for 俱, 够 for 夠), or gives one index to two code points and the group's own name is
 *   shown (群, not 羣).
 * - Groups hanji has and we do not: Korea's list or Hong Kong's variant code points of one entry
 *   (擧 beside 舉), and pre-reform names that repeat another group (餠 beside 餅).
 * - Stroke counts: Taiwan's come from CNS 11643, and Hong Kong borrows the count of a region that
 *   draws the same glyph. Only differences outside Taiwan are listed.
 */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const HANJI_DATA = "https://hanji.sxzz.moe/data/chars.json";
const REGIONS = ["cn", "hk", "tw", "jp"] as const;

interface HanjiRow {
  key: string;
  /** cn, hk, tw, jp, kr. */
  chars: string[];
  glyph: string;
  strokes: number[];
  tier: number[];
  old?: { char: string; glyph: number };
}

interface Ours {
  key: string;
  chars: string[];
  old?: string;
  glyphSig: string;
  strokes: Array<number | null>;
}

const dbPath = process.argv[2] ?? join(process.cwd(), "assets", "jisho.db");
const db = new DatabaseSync(dbPath, { readOnly: true });
const groups = new Map<string, Ours>();
for (const row of db
  .prepare(
    `SELECT g.key, g.glyph_sig, f.region, f.char, f.strokes
       FROM regional_groups g JOIN regional_forms f ON f.group_id = g.id`
  )
  .all()) {
  const key = String(row["key"]);
  const char = String(row["char"]);
  const held = groups.get(key) ?? {
    key,
    chars: [],
    glyphSig: String(row["glyph_sig"]),
    strokes: []
  };
  const region = REGIONS.findIndex((name) => name === row["region"]);
  if (region === -1) held.old = char;
  else {
    held.chars[region] = char;
    held.strokes[region] =
      row["strokes"] === null ? null : Number(row["strokes"]);
  }
  groups.set(key, held);
}
db.close();

const res = await fetch(HANJI_DATA);
if (!res.ok) throw new Error(`${HANJI_DATA}: ${res.status}`);
const data: { rows: HanjiRow[] } = await res.json();
const { rows } = data;

/** Renumber a partition by first appearance, after dropping Korea's digit. */
const renumber = (digits: number[]): string => {
  const seen = new Map<number, number>();
  return digits
    .map((digit) => {
      if (!seen.has(digit)) seen.set(digit, seen.size);
      return String(seen.get(digit));
    })
    .join("");
};

const onlyHanji: string[] = [];
const columns: string[] = [];
const glyphs: string[] = [];
const strokes: string[] = [];
for (const row of rows) {
  // A row only Korea lists is out of our scope.
  if (!row.tier.slice(0, 4).some((tier) => tier > 0)) continue;
  const theirs = row.chars.slice(0, 4).join("");
  const ours = groups.get(row.key);
  if (!ours) {
    onlyHanji.push(`${row.key} ${theirs}`);
    continue;
  }
  if (ours.chars.join("") !== theirs) {
    columns.push(`${row.key}: ours ${ours.chars.join("")}, hanji ${theirs}`);
    continue;
  }
  const signature = renumber([
    ...row.glyph.slice(0, 4).split("").map(Number),
    ...(row.old ? [row.old.glyph] : [])
  ]);
  if (ours.glyphSig !== signature)
    glyphs.push(
      `${row.key} ${theirs}: ours ${ours.glyphSig}, hanji ${signature}`
    );
  for (const region of [0, 1, 3])
    if (ours.strokes[region] !== row.strokes[region])
      strokes.push(
        `${row.key} ${REGIONS[region]}: ours ${ours.strokes[region]}, hanji ${row.strokes[region]}`
      );
}
const hanjiKeys = new Set(rows.map((row) => row.key));
const onlyOurs = [...groups.values()]
  .filter((group) => !hanjiKeys.has(group.key))
  .map((group) => `${group.key} ${group.chars.join("")}`);

const show = (label: string, lines: string[]): void => {
  console.log(`\n${label}: ${lines.length}`);
  for (const line of lines) console.log(`  ${line}`);
};
console.log(
  `ours ${groups.size} groups, hanji ${rows.length} rows (with Korea)`
);
show("only in hanji", onlyHanji);
show("only in ours", onlyOurs);
show("columns differ", columns);
show("glyph signatures differ", glyphs);
show("stroke counts differ outside Taiwan", strokes);
