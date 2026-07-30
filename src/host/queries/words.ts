import type {
  ExampleGroupDto,
  KanaDto,
  KanjiDto,
  MoreExamplesDto,
  SenseDto,
  SentenceDto,
  TagDto,
  WordDetailDto
} from "../../shared/messages";
import type { SqliteStore } from "../store";
import { WORD_LEVEL_SENSE } from "../../shared/schema";
import { flattenXrefs, parseNumbers, parseStrings } from "./parse";

/**
 * The word-detail queries: one entry hydrated for its page, and the pooled example set behind it.
 *
 * Split out of `db.ts` with the other verticals — see `Dictionary`, which is now a facade over these.
 */

/** Full detail for one entry, or `null` if the id is unknown. */
export const getWord = async (
  store: SqliteStore,
  id: string
): Promise<WordDetailDto | null> => {
  const word = await store.get<{
    id: string;
    is_common: number;
    jlpt: number | null;
  }>("SELECT id, is_common, jlpt FROM words WHERE id = ?", id);
  if (!word) return null;

  const kanjiRows = await store.all<{
    text: string;
    is_common: number;
    tags_json: string;
  }>(
    "SELECT text, is_common, tags_json FROM kanji WHERE word_id = ? ORDER BY position",
    id
  );
  const kanji: KanjiDto[] = kanjiRows.map((r) => ({
    text: r.text,
    common: r.is_common === 1,
    tags: parseStrings(r.tags_json)
  }));

  const kanaRows = await store.all<{
    text: string;
    is_common: number;
    tags_json: string;
    applies_to_kanji_json: string;
  }>(
    `SELECT text, is_common, tags_json, applies_to_kanji_json
       FROM kana WHERE word_id = ? ORDER BY position`,
    id
  );
  // Pitch accents are keyed by (word_id, reading); load them once and attach per reading.
  const pitchRows = await store.all<{
    reading: string;
    accents_json: string;
  }>("SELECT reading, accents_json FROM pitch_accents WHERE word_id = ?", id);
  const pitchByReading = new Map<string, number[]>();
  for (const p of pitchRows) {
    pitchByReading.set(p.reading, parseNumbers(p.accents_json));
  }
  const kana: KanaDto[] = kanaRows.map((r) => ({
    text: r.text,
    common: r.is_common === 1,
    tags: parseStrings(r.tags_json),
    appliesToKanji: parseStrings(r.applies_to_kanji_json),
    pitchAccents: pitchByReading.get(r.text) ?? []
  }));

  const senseRows = await store.all<{
    id: number;
    position: number;
    info_json: string;
    applies_to_kanji_json: string;
    applies_to_kana_json: string;
    related_json: string;
    antonym_json: string;
  }>(
    `SELECT id, position, info_json, applies_to_kanji_json, applies_to_kana_json,
            related_json, antonym_json
       FROM senses WHERE word_id = ? ORDER BY position`,
    id
  );

  // Tags and glosses for every sense in one query each, grouped in memory. Both were previously
  // per-sense — the glosses as an awaited query inside the sense loop.
  const tagRows = await store.all<{
    sense_id: number;
    kind: string;
    code: string;
  }>(
    `SELECT t.sense_id AS sense_id, t.kind AS kind, t.code AS code
       FROM sense_tags t JOIN senses s ON s.id = t.sense_id
      WHERE s.word_id = ?`,
    id
  );
  const tagsBySense = new Map<number, Map<string, TagDto[]>>();
  for (const t of tagRows) {
    const byKind = tagsBySense.get(t.sense_id) ?? new Map<string, TagDto[]>();
    byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), store.tag(t.code)]);
    tagsBySense.set(t.sense_id, byKind);
  }
  const glossRows = await store.all<{ sense_id: number; text: string }>(
    `SELECT g.sense_id AS sense_id, g.text AS text
       FROM glosses g JOIN senses s ON s.id = g.sense_id
      WHERE s.word_id = ? ORDER BY s.position, g.position`,
    id
  );
  const glossesBySense = new Map<number, string[]>();
  for (const g of glossRows) {
    glossesBySense.set(g.sense_id, [
      ...(glossesBySense.get(g.sense_id) ?? []),
      g.text
    ]);
  }

  // Inline example sentences: the curated per-sense Tanaka set (source='tanaka'), keyed by
  // sense_position. The fuller Tatoeba pool (source='tatoeba') is deliberately excluded here — it
  // feeds the separate "more examples" surface (F1), not the inline per-sense list. Loaded once and
  // grouped by sense.
  const sentenceRows = await store.all<{
    sense_position: number;
    ja_furigana: string;
    en: string;
  }>(
    "SELECT sense_position, ja_furigana, en FROM sentences WHERE word_id = ? AND source = 'tanaka' ORDER BY sense_position, position",
    id
  );
  const sentencesBySense = new Map<number, SentenceDto[]>();
  for (const r of sentenceRows) {
    const list = sentencesBySense.get(r.sense_position) ?? [];
    list.push({ jaFurigana: r.ja_furigana, en: r.en });
    sentencesBySense.set(r.sense_position, list);
  }

  const senses: SenseDto[] = [];
  for (const s of senseRows) {
    const tags = tagsBySense.get(s.id);
    senses.push({
      partOfSpeech: tags?.get("pos") ?? [],
      field: tags?.get("field") ?? [],
      misc: tags?.get("misc") ?? [],
      info: parseStrings(s.info_json),
      dialect: tags?.get("dialect") ?? [],
      glosses: glossesBySense.get(s.id) ?? [],
      appliesToKanji: parseStrings(s.applies_to_kanji_json),
      appliesToKana: parseStrings(s.applies_to_kana_json),
      related: flattenXrefs(s.related_json),
      antonym: flattenXrefs(s.antonym_json),
      sentences: sentencesBySense.get(s.position) ?? []
    });
  }

  return {
    id: word.id,
    common: word.is_common === 1,
    jlpt: word.jlpt,
    kanji,
    kana,
    senses
  };
};

/**
 * The fuller Tatoeba example pool for a word (F1 "more examples" page), or `null` if the word has
 * no pooled examples. Sentences the source tagged to a sense are grouped under that sense's gloss;
 * the rest (sense_position = -1) are the word-level pool. `ja_furigana` carries build-time ruby.
 */
export const getMoreExamples = async (
  store: SqliteStore,
  id: string
): Promise<MoreExamplesDto | null> => {
  const rows = await store.all<{
    sense_position: number;
    position: number;
    ja_furigana: string;
    en: string;
  }>(
    `SELECT sense_position, position, ja_furigana, en
       FROM sentences
      WHERE word_id = ? AND source = 'tatoeba'
      ORDER BY sense_position, position`,
    id
  );
  if (rows.length === 0) return null;

  // The page title: the word's first kanji writing, or first kana reading if kana-only.
  const headwordRow =
    (await store.get<{ text: string }>(
      "SELECT text FROM kanji WHERE word_id = ? ORDER BY position LIMIT 1",
      id
    )) ??
    (await store.get<{ text: string }>(
      "SELECT text FROM kana WHERE word_id = ? ORDER BY position LIMIT 1",
      id
    ));

  const wordLevel: SentenceDto[] = [];
  const bySense = new Map<number, SentenceDto[]>();
  for (const r of rows) {
    const sentence: SentenceDto = { jaFurigana: r.ja_furigana, en: r.en };
    if (r.sense_position === WORD_LEVEL_SENSE) {
      wordLevel.push(sentence);
    } else {
      const list = bySense.get(r.sense_position) ?? [];
      list.push(sentence);
      bySense.set(r.sense_position, list);
    }
  }

  // Header each sense group with its first gloss. Read them for just the senses that have pooled
  // sentences, keyed by sense position.
  const senses: ExampleGroupDto[] = [];
  for (const [position, sentences] of [...bySense.entries()].sort(
    (a, b) => a[0] - b[0]
  )) {
    const gloss = await store.get<{ text: string }>(
      `SELECT g.text AS text
         FROM senses s JOIN glosses g ON g.sense_id = s.id
        WHERE s.word_id = ? AND s.position = ?
        ORDER BY g.position LIMIT 1`,
      id,
      position
    );
    senses.push({ gloss: gloss?.text ?? "", sentences });
  }

  return {
    headword: headwordRow?.text ?? "",
    senses,
    wordLevel
  };
};
