import type { RegionalGroupDto } from "../../shared/messages";
import type { SqliteStore } from "../store";

/**
 * Regional forms (spec 22): the character groups a Japanese kanji belongs to, as built into
 * `regional_groups` and `regional_forms` by scripts/regional.ts.
 */

const REGIONS = ["cn", "hk", "tw", "jp"] as const;

interface FormRow {
  id: number;
  key: string;
  glyph_sig: string;
  cp_sig: string;
  region: string;
  char: string;
  strokes: number | null;
  tier: number;
  /** 0 when the kanji is the group's Japanese form, 1 when only its old form. */
  match: number;
}

/**
 * The groups in which `literal` is Japan's form or Japan's old form.
 *
 * Usually one. Japan's reform made several characters one shape (弁 stands for 辨, 瓣, 辯 and 辦),
 * so there can be several, and a kanji page lists them all. The order puts the groups where the
 * kanji is Japan's form first, led by the one named by the kanji itself (the character 予 before 豫,
 * which Japan also writes 予), and then the groups where it is only the old form (學's page, for 学).
 */
export const getRegionalGroups = async (
  store: SqliteStore,
  literal: string
): Promise<RegionalGroupDto[]> => {
  const rows = await store.all<FormRow>(
    `SELECT g.id, g.key, g.glyph_sig, g.cp_sig, f.region, f.char, f.strokes, f.tier, m.match
       FROM (SELECT group_id, MIN(region = 'old') AS match FROM regional_forms
              WHERE char = ? AND region IN ('jp', 'old') GROUP BY group_id) m
       JOIN regional_groups g ON g.id = m.group_id
       JOIN regional_forms f ON f.group_id = g.id
      ORDER BY m.match, g.key <> ?, g.key, g.id`,
    literal,
    literal
  );
  const groups = new Map<number, RegionalGroupDto>();
  for (const row of rows) {
    let group = groups.get(row.id);
    if (!group) {
      group = {
        key: row.key,
        chars: ["", "", "", ""],
        glyphSig: row.glyph_sig,
        cpSig: row.cp_sig,
        strokes: [null, null, null, null],
        tiers: [0, 0, 0, 0]
      };
      groups.set(row.id, group);
    }
    const region = REGIONS.findIndex((name) => name === row.region);
    if (region === -1) {
      group.old = row.char;
      group.strokes[4] = row.strokes;
    } else {
      group.chars[region] = row.char;
      group.strokes[region] = row.strokes;
      group.tiers[region] = row.tier;
    }
  }
  return [...groups.values()];
};
