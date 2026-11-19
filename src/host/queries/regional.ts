import type {
  ChineseSense,
  NoteBlock,
  NoteItem,
  RegionalGroupDto,
  RegionalNoteDto
} from "../../shared/messages";
import type { SqliteStore } from "../store";
import { parseStrings } from "./parse";

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
  reading: string | null;
  freq: number | null;
}

/** Form rows joined to their groups, as one DTO per group in row order. */
const assemble = (rows: readonly FormRow[]): RegionalGroupDto[] => {
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
        tiers: [0, 0, 0, 0],
        readings: [null, null, null, null],
        ranks: [null, null, null, null],
        notes: [],
        meanings: [],
        japaneseMeanings: [],
        kanjiLinks: []
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
      group.readings[region] = row.reading;
      group.ranks[region] = row.freq;
    }
  }
  return [...groups.values()];
};

/** Japan's readings are the kanji page's own, on then kun, rather than a second copy in the table. */
const japaneseReading = (
  kanji: { on_json: string; kun_json: string } | undefined
): string | null => {
  const readings = kanji
    ? [...parseStrings(kanji.on_json), ...parseStrings(kanji.kun_json)]
    : [];
  return readings.length > 0 ? readings.join("、") : null;
};

/** A string field of an object read from JSON, or undefined. */
const stringOf = (value: object, key: string): string | undefined => {
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
};

const parseItems = (value: unknown): NoteItem[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        if (typeof item !== "object" || item === null) return [];
        const text = stringOf(item, "text");
        return text === undefined
          ? []
          : [{ text, items: parseItems(Reflect.get(item, "items")) }];
      })
    : [];

/**
 * A note's blocks from `regional_notes.blocks_json`, as the build wrote them. Tolerant, as the other
 * column parsers are: a block of an unknown shape is left out rather than failing the lookup.
 */
const parseBlocks = (json: string): NoteBlock[] => {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return [];
  return value.flatMap((block: unknown): NoteBlock[] => {
    if (typeof block !== "object" || block === null) return [];
    const kind = stringOf(block, "kind");
    const text = stringOf(block, "text") ?? "";
    if (kind === "paragraph")
      return [{ kind, text, indent: Reflect.get(block, "indent") === true }];
    if (kind === "label") return [{ kind, text }];
    if (kind === "list")
      return [
        {
          kind,
          ordered: Reflect.get(block, "ordered") === true,
          items: parseItems(Reflect.get(block, "items"))
        }
      ];
    return [];
  });
};

/** A character's senses from `regional_meanings.senses_json`. */
const parseSenses = (json: string): ChineseSense[] => {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return [];
  return value.flatMap((sense: unknown) => {
    if (typeof sense !== "object" || sense === null) return [];
    const gloss = stringOf(sense, "gloss");
    const labels: unknown = Reflect.get(sense, "labels");
    return gloss === undefined
      ? []
      : [
          {
            gloss,
            labels: Array.isArray(labels)
              ? labels.filter((label) => typeof label === "string")
              : []
          }
        ];
  });
};

const FORM_COLUMNS =
  "g.id, g.key, g.glyph_sig, g.cp_sig, f.region, f.char, f.strokes, f.tier, f.reading, f.freq";

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
  const groups = assemble(
    await store.all<FormRow>(
      `SELECT ${FORM_COLUMNS}
       FROM (SELECT group_id, MIN(region = 'old') AS match FROM regional_forms
              WHERE char = ? AND region IN ('jp', 'old') GROUP BY group_id) m
       JOIN regional_groups g ON g.id = m.group_id
       JOIN regional_forms f ON f.group_id = g.id
      ORDER BY m.match, g.key <> ?, g.key, g.id`,
      literal,
      literal
    )
  );
  for (const group of groups) {
    const kanji = await store.get<{
      on_json: string;
      kun_json: string;
      meanings_json: string;
    }>(
      "SELECT on_json, kun_json, meanings_json FROM kanji_characters WHERE literal = ?",
      group.chars[3] ?? ""
    );
    group.readings[3] = japaneseReading(kanji);
    // Japan's meanings are the kanji page's own, beside Wiktionary's Chinese ones.
    group.japaneseMeanings =
      kanji === undefined ? [] : parseStrings(kanji.meanings_json);
    // Wiktionary's notes on every character the group writes (spec 22, phase 6).
    const chars = [
      ...new Set(
        group.old === undefined ? group.chars : [...group.chars, group.old]
      )
    ];
    const placeholders = chars.map(() => "?").join(", ");
    group.notes = (
      await store.all<{
        char: string;
        section: RegionalNoteDto["section"];
        blocks_json: string;
      }>(
        `SELECT char, section, blocks_json FROM regional_notes
          WHERE char IN (${placeholders})`,
        ...chars
      )
    ).map(({ char, section, blocks_json }) => ({
      char,
      section,
      blocks: parseBlocks(blocks_json)
    }));
    group.meanings = (
      await store.all<{ char: string; senses_json: string }>(
        `SELECT char, senses_json FROM regional_meanings
          WHERE char IN (${placeholders})`,
        ...chars
      )
    ).map(({ char, senses_json }) => ({
      char,
      senses: parseSenses(senses_json)
    }));
    // The characters the quoted text names that have a kanji page, so the view links only those:
    // a component with no entry (𦥑) stays plain, and no link can lead nowhere.
    const named = [...new Set(quotedText(group).match(HAN) ?? [])];
    group.kanjiLinks =
      named.length === 0
        ? []
        : (
            await store.all<{ literal: string }>(
              `SELECT literal FROM kanji_characters
                WHERE literal IN (${named.map(() => "?").join(", ")})`,
              ...named
            )
          ).map(({ literal }) => literal);
  }
  return groups;
};

const HAN = /\p{Script=Han}/gu;

/** Every text the view quotes from Wiktionary for a group: its notes, their lists, its meanings. */
const quotedText = (group: RegionalGroupDto): string => {
  const items = (list: readonly NoteItem[]): string[] =>
    list.flatMap((item) => [item.text, ...items(item.items)]);
  return [
    ...group.notes.flatMap((note) =>
      note.blocks.flatMap((block) =>
        block.kind === "list" ? items(block.items) : [block.text]
      )
    ),
    ...group.meanings.flatMap((m) => m.senses.map((sense) => sense.gloss))
  ].join("\n");
};

/**
 * Every group, for the Kanji tab's "Regional differences" list (spec 22, phase 7), which filters and
 * sorts them in the webview. One query for the forms and one for Japan's readings, rather than one
 * per group: there are 8,418. Without notes or meanings, which the list does not show.
 */
export const browseRegionalGroups = async (
  store: SqliteStore
): Promise<RegionalGroupDto[]> => {
  const groups = assemble(
    await store.all<FormRow>(
      `SELECT ${FORM_COLUMNS}
         FROM regional_groups g JOIN regional_forms f ON f.group_id = g.id
        ORDER BY g.id`
    )
  );
  const kanji = await store.all<{
    literal: string;
    on_json: string;
    kun_json: string;
  }>(
    `SELECT literal, on_json, kun_json FROM kanji_characters
      WHERE literal IN (SELECT char FROM regional_forms WHERE region = 'jp')`
  );
  const readings = new Map(
    kanji.map((row) => [row.literal, japaneseReading(row)])
  );
  for (const group of groups)
    group.readings[3] = readings.get(group.chars[3] ?? "") ?? null;
  return groups;
};
