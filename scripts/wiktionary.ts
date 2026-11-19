/**
 * Wiktionary for the regional forms (spec 22, phase 6): the notes the view shows, and a cross-check of
 * the grouping against Wiktionary's own labels.
 *
 * The data build reads the extraction pinned below, which `scripts/extract-wiktionary.ts` made from
 * Wiktextract's full dump and the `wiktionary` workflow published. To take fresher notes, run that
 * workflow and copy the tag and checksum it prints into these two constants.
 *
 * Wiktionary's text is CC BY-SA 4.0 (THIRD_PARTY_NOTICES.md): the view shows every note with a credit
 * and a link to its page.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type {
  ChineseSense,
  NoteBlock,
  NoteItem
} from "../src/shared/messages.ts";
import { ASSET_NAME, type WiktionaryEntry } from "./extract-wiktionary.ts";
import type { RegionalGroup } from "./regional.ts";

export const WIKTIONARY_TAG = "wiktionary-2026-11-13";
export const WIKTIONARY_SHA256 =
  "7d8c248eaadcff7a1b207c037a53debdc6205c56829e0d4b17facb62507fe790";
const WIKTIONARY_URL = `https://github.com/Saeris/vscode-jisho/releases/download/${WIKTIONARY_TAG}/${ASSET_NAME}`;

/** The section of the page a note is from. */
export type NoteSection = "Translingual" | "Chinese" | "Japanese";

export interface Wiktionary {
  /**
   * Each character's notes by section: Translingual says how its forms relate across languages
   * (学: "Simplified from 學 … in simplified Chinese and Japanese shinjitai"), Chinese where the
   * shape came from (學: "Possibly a phono-semantic compound …"), and Japanese where each of its
   * Japanese words came from, labelled by reading (国: くに from Old Japanese, こく from Middle
   * Chinese).
   */
  notes: Map<string, Partial<Record<NoteSection, NoteBlock[]>>>;
  /** Each character's meanings in Chinese, as `chineseSenses` keeps them. */
  meanings: Map<string, ChineseSense[]>;
  /** The pairs Wiktionary labels as Japan's new and old form, as `[shinjitai, kyūjitai]`. */
  reformPairs: Array<[string, string]>;
  /** Each character's page, and the characters it names: as a form, a redirect, or in a note. */
  links: Map<string, Set<string>>;
}

const HAN = /\p{Script=Han}/gu;

/**
 * A list item that only names a Chinese variety ("Mandarin", "Cantonese (Jyutping): gaan¹"): the
 * first line of a pronunciation table. Wiktextract leaves these in 31 etymologies (奸's runs to 78
 * lines), and they say nothing of the character's shape or history.
 */
const VARIETY =
  /^(?:Mandarin|Cantonese|Hakka|Wu|Gan|Xiang|Jin|Hokkien|Teochew|Taishanese|Dungan|(?:Eastern|Northern|Southern|Central|Puxian) Min|Middle Chinese|Old Chinese)(?:\s*\([^)]*\))?(?::.*)?$/u;

/** One line of the etymology: its leading wiki markup (`#`, `*`, `:`, `;`) and its text. */
interface MarkedLine {
  marks: string;
  text: string;
}

/**
 * A list's lines as nested items. Each `*` or `#` in a line's marks is one level; marks ending in `:`
 * (`*:`) continue the item above at that level rather than starting one.
 */
const listItems = (lines: readonly MarkedLine[]): NoteItem[] => {
  const top: NoteItem[] = [];
  // The last item at each level, so a deeper line knows its parent.
  const last: NoteItem[] = [];
  for (const { marks, text } of lines) {
    // At least 1: every line here holds a `*` or `#`, so `at` never counts from the end.
    const levels = marks.replaceAll(":", "").length;
    const above = last.at(levels - 1);
    if (marks.endsWith(":") && above !== undefined) {
      above.text = `${above.text} ${text}`;
      continue;
    }
    const item: NoteItem = { text, items: [] };
    // A level with no parent above it (a page that starts at `**`) joins the deepest one there is.
    const parent = last.slice(0, levels - 1).findLast(Boolean);
    (parent?.items ?? top).push(item);
    last.length = levels - 1;
    last.push(item);
  }
  return top;
};

/**
 * A note as blocks, from Wiktextract's etymology text, which keeps the page's wiki markup at the start
 * of each line: `#` numbered and `*` bulleted list items (`**` one level in), `:` a paragraph set in,
 * and `;` the label of a sense the following lines discuss. Null when nothing is left to show.
 *
 * Left out: a page that only sends the reader elsewhere ("For pronunciation and definitions of 台 –
 * see 鮐"), a pronunciation table left in the text, and a label with nothing after it. Wiktextract
 * keeps the labels of 商's etymology ("dynasty's name") but not the paragraphs under them.
 */
export const noteBlocks = (etymology: string): NoteBlock[] | null => {
  if (etymology.startsWith("For pronunciation and definitions of")) return null;
  const lines = etymology
    .split("\n")
    .map((line): MarkedLine => {
      const marks = /^[#*:;]*/u.exec(line)?.[0] ?? "";
      return { marks, text: line.slice(marks.length).trim() };
    })
    .filter((line) => line.text.length > 0);
  const blocks: NoteBlock[] = [];
  for (let i = 0; i < lines.length;) {
    const { marks, text } = lines[i];
    if (marks === "") {
      blocks.push({ kind: "paragraph", text, indent: false });
      i++;
    } else if (marks.startsWith(";")) {
      blocks.push({ kind: "label", text });
      i++;
    } else if (!/^:*[*#]/u.test(marks)) {
      // `:`, or any other run of marks that starts no list: a paragraph set in. Every line must be
      // consumed here or below, or the loop would never end.
      blocks.push({ kind: "paragraph", text, indent: true });
      i++;
    } else {
      // A list: every line from here whose marks hold a `*` or `#` (`:*` is a list set in).
      const run: MarkedLine[] = [];
      for (; i < lines.length && /^:*[*#]/u.test(lines[i].marks); i++)
        run.push({ ...lines[i], marks: lines[i].marks.replace(/^:+/u, "") });
      const items = listItems(run);
      if (!items.some((item) => VARIETY.test(item.text))) {
        blocks.push({
          kind: "list",
          ordered: run[0]?.marks.startsWith("#") ?? false,
          items
        });
        continue;
      }
      // A table can end in a "Note:" on its readings ("¹ke - vernacular; ¹ji - literary"), and a
      // list under it: part of the table, so it goes too.
      if (lines[i]?.marks === "" && /^Note:?$/u.test(lines[i].text))
        for (i++; i < lines.length && /^[*#]/u.test(lines[i].marks); i++);
    }
  }
  const kept = blocks.filter((block, index) => {
    const next = blocks.at(index + 1);
    return (
      block.kind !== "label" || (next !== undefined && next.kind !== "label")
    );
  });
  return kept.length > 0 ? kept : null;
};

/**
 * The tags a kept sense may carry, and the label each shows ("" for none). Any other tag drops the
 * sense: Wiktionary tags a sense with its variety (Cantonese, Hokkien and some 150 places), its age
 * (obsolete, archaic, historical) or what it points at (alt-of, abbreviation), and "Meanings in
 * Chinese" is the standard language's living meanings. An allow-list, so a new tag drops rather than
 * slips in. The three regions this view compares keep their names: a sense used only in Taiwan is
 * a regional difference too.
 */
const SENSE_TAGS: ReadonlyMap<string, string> = new Map([
  ["literary", "literary"],
  ["regional", "regional"],
  ["Mandarin", ""],
  ["Taiwan", "Taiwan"],
  ["Taiwanese-Mandarin", "Taiwan"],
  ["Mainland-China", "mainland China"],
  ["Hong-Kong", "Hong Kong"],
  ["colloquial", "colloquial"],
  ["figuratively", "figurative"],
  ["Classical", "Classical Chinese"],
  ["in-compounds", "in compounds"],
  ["formal", "formal"],
  ["informal", "informal"],
  ["honorific", "honorific"],
  ["humble", "humble"],
  ["polite", "polite"],
  ["transitive", ""],
  ["intransitive", ""],
  ["broadly", ""],
  ["usually", ""],
  ["often", ""],
  ["especially", ""],
  ["specifically", ""]
]);

/** Glosses that name a use rather than a meaning: a surname, a classifier, another form, a compound. */
const NOT_A_MEANING =
  /^(?:a surname|surname|used in |only used in |Classifier |\(Chinese linguistics\)|(?:alternative|original|variant|synonym|simplified|traditional)(?: (?:form|spelling|character|variant))? of )/iu;

/** How many meanings a character keeps: the first few, as Wiktionary orders them. */
export const MAX_SENSES = 5;

/**
 * A character's meanings in Chinese from its entries' senses, in the page's order: top-level senses
 * only (a sub-sense refines one above it), with an allowed register, that say what it means. A
 * sense's raw tags are its context ("of devices", "used in the negative"), set before the gloss as
 * Wiktionary sets them: "to run; to work" alone would misdescribe 走.
 */
export const chineseSenses = (
  senses: NonNullable<WiktionaryEntry["senses"]>
): ChineseSense[] => {
  const kept: ChineseSense[] = [];
  for (const { glosses, tags = [], raw_tags: context = [] } of senses) {
    const meaning = glosses.at(0);
    if (glosses.length !== 1 || meaning === undefined) continue;
    if (NOT_A_MEANING.test(meaning)) continue;
    if (!tags.every((tag) => SENSE_TAGS.has(tag))) continue;
    const gloss =
      context.length > 0 ? `(${context.join(", ")}) ${meaning}` : meaning;
    if (kept.some((sense) => sense.gloss === gloss)) continue;
    kept.push({
      gloss,
      labels: [
        ...new Set(
          tags.flatMap((tag) => {
            const label = SENSE_TAGS.get(tag);
            return label === undefined || label === "" ? [] : [label];
          })
        )
      ]
    });
    if (kept.length === MAX_SENSES) break;
  }
  return kept;
};

const addLink = (
  links: Map<string, Set<string>>,
  from: string,
  to: string
): void => {
  if (from === to) return;
  const held = links.get(from) ?? new Set<string>();
  held.add(to);
  links.set(from, held);
};

/**
 * Read the extraction's entries into notes, meanings, Japan's reform pairs and the links between
 * pages.
 */
export const parseWiktionary = (
  entries: Iterable<WiktionaryEntry>
): Wiktionary => {
  const notes = new Map<string, Partial<Record<NoteSection, NoteBlock[]>>>();
  const senses = new Map<string, NonNullable<WiktionaryEntry["senses"]>>();
  const japanese = new Map<
    string,
    Array<{ text: string; readings: Set<string> }>
  >();
  const reformPairs: Array<[string, string]> = [];
  const links = new Map<string, Set<string>>();
  for (const entry of entries) {
    const { word, lang } = entry;
    for (const { form } of entry.forms ?? []) addLink(links, word, form);
    for (const target of entry.redirects ?? []) addLink(links, word, target);
    for (const [char] of (entry.etymology_text ?? "").matchAll(HAN))
      addLink(links, word, char);
    // A page can hold several entries of one language (one per etymology or part of speech); the
    // note is the first that has one.
    if (
      (lang === "Translingual" || lang === "Chinese") &&
      entry.etymology_text !== undefined
    ) {
      const held = notes.get(word) ?? {};
      const blocks = noteBlocks(entry.etymology_text);
      if (held[lang] === undefined && blocks !== null) {
        held[lang] = blocks;
        notes.set(word, held);
      }
    }
    // Every Chinese entry's senses, in the page's order (one entry per etymology); filtered below.
    if (lang === "Chinese" && entry.senses !== undefined)
      senses.set(word, [...(senses.get(word) ?? []), ...entry.senses]);
    // Every Japanese word's etymology on the page, with the readings it is the history of: one entry
    // per reading and part of speech, so 後's あと repeats its text as noun, adverb and conjunction.
    // Left out: an entry that only points at another spelling, and a given name, whose readings
    // (学: さとる, まなぶ) are names rather than the character's words.
    if (
      lang === "Japanese" &&
      entry.etymology_text !== undefined &&
      entry.redirects === undefined &&
      entry.pos !== "name"
    ) {
      const held = japanese.get(word) ?? [];
      const readings = japaneseReadings(entry);
      const same = held.find(({ text }) => text === entry.etymology_text);
      if (same === undefined)
        held.push({ text: entry.etymology_text, readings: new Set(readings) });
      else for (const reading of readings) same.readings.add(reading);
      japanese.set(word, held);
    }
    // Japan's labels are on the character entry: 学 lists 學 as its kyūjitai, 學 lists 学 as its
    // shinjitai. Both directions name the same pair; the cross-check dedupes.
    if (lang === "Japanese" && entry.pos === "character")
      for (const { form, tags } of entry.forms ?? []) {
        if (tags.includes("kyūjitai")) reformPairs.push([word, form]);
        if (tags.includes("shinjitai")) reformPairs.push([form, word]);
      }
  }
  for (const [word, etymologies] of japanese) {
    // Each etymology under the label of its readings, in the page's order.
    const blocks = etymologies.flatMap(({ text, readings }): NoteBlock[] => {
      const body = noteBlocks(text);
      if (body === null) return [];
      return readings.size === 0
        ? body
        : [{ kind: "label", text: [...readings].join("、") }, ...body];
    });
    if (blocks.length > 0)
      notes.set(word, { ...notes.get(word), Japanese: blocks });
  }
  const meanings = new Map<string, ChineseSense[]>();
  for (const [word, all] of senses) {
    const kept = chineseSenses(all);
    if (kept.length > 0) meanings.set(word, kept);
  }
  return { notes, meanings, reformPairs, links };
};

/** Kana in brackets, as a Japanese headword line gives its reading: "国(くに) • (kuni)". */
const KANA_READING = /\(([\p{Script=Hiragana}\p{Script=Katakana}ー]+)\)/gu;

/** The readings a Japanese entry is of, from its headword lines: 国's two nouns give くに and こく. */
export const japaneseReadings = (entry: WiktionaryEntry): string[] => [
  ...new Set(
    (entry.head_templates ?? []).flatMap(({ expansion }) =>
      Array.from(expansion.matchAll(KANA_READING), ([, kana]) => kana)
    )
  )
];

/** What the cross-check found, in a stable order. */
export interface CrossCheck {
  /** Pairs Wiktionary labels shinjitai and kyūjitai that no group holds together, as "间閒". */
  split: string[];
  /** Groups whose forms Wiktionary's pages do not connect, by key. */
  unconnected: string[];
}

const formsOf = (group: RegionalGroup): string[] => [
  ...new Set(
    group.old === undefined ? group.chars : [...group.chars, group.old]
  )
];

/**
 * Cross-check the grouping against Wiktionary (spec 22, phase 6), in both directions:
 *
 * - **Split**: a pair Wiktionary labels as Japan's shinjitai and kyūjitai, both forms in some group,
 *   that no one group holds together. These labels are the cleanest Wiktionary has.
 * - **Unconnected**: a group whose forms cannot all be reached from one another through Wiktionary's
 *   pages, going only through the group's own forms (专 to 專 to 専 joins 專's three forms).
 *   Wiktionary has no clean label for China's simplification, so any mention counts as a link here.
 */
export const crossCheck = (
  groups: readonly RegionalGroup[],
  wiktionary: Wiktionary
): CrossCheck => {
  const groupsOf = new Map<string, Set<string>>();
  for (const group of groups)
    for (const form of formsOf(group)) {
      const held = groupsOf.get(form) ?? new Set<string>();
      held.add(group.key);
      groupsOf.set(form, held);
    }
  const split = new Set<string>();
  for (const [shinjitai, kyujitai] of wiktionary.reformPairs) {
    if (shinjitai === kyujitai) continue;
    const a = groupsOf.get(shinjitai);
    const b = groupsOf.get(kyujitai);
    if (a === undefined || b === undefined) continue;
    if (![...a].some((key) => b.has(key))) split.add(shinjitai + kyujitai);
  }

  const linked = (a: string, b: string): boolean =>
    (wiktionary.links.get(a)?.has(b) ?? false) ||
    (wiktionary.links.get(b)?.has(a) ?? false);
  const unconnected: string[] = [];
  for (const group of groups) {
    const forms = formsOf(group);
    const reached = new Set(forms.slice(0, 1));
    const queue = forms.slice(0, 1);
    for (let form = queue.pop(); form !== undefined; form = queue.pop())
      for (const other of forms)
        if (!reached.has(other) && linked(form, other)) {
          reached.add(other);
          queue.push(other);
        }
    if (reached.size < forms.length) unconnected.push(group.key);
  }
  return { split: [...split].toSorted(), unconnected: unconnected.toSorted() };
};

/**
 * The cross-check's differences as of the pinned extraction, each with its reason. The data build
 * fails on a difference not listed here, and on a listed one that no longer occurs, so a change to the
 * grouping or a new extraction gets looked at rather than passed.
 */
export const EXPLAINED: {
  split: ReadonlyArray<readonly [reason: string, pairs: readonly string[]]>;
  unconnected: ReadonlyArray<readonly [reason: string, keys: string]>;
} = {
  split: [
    [
      "Japan's form is a variant that OpenCC's shinjitai table does not name, so each code point is a group of its own (as in hanji)",
      ["喻喩", "娯娛", "駄馱"]
    ],
    [
      "Wiktionary names an old form that OpenCC's table does not give this character, so the two stay apart (as in hanji)",
      ["間閒", "弁辦", "弁辮", "扣控", "育毓", "沪瀘"]
    ]
  ],
  unconnected: [
    [
      "Wiktionary's pages name each other, but not in the parts the extraction keeps: Wiktextract drops some of a simplified page's redirects (业 loses 業), and some links are only in definitions",
      "僅僉劃勳叄呂咼園團屓柺桿業榦歎毀溼滙澀濬灑灧燄牠牴癢硃簾籙絃綳線縕膠舉蓴術豔蹟達還醃釦鈡鉅鉳鍅鑑靦鞝颱颳餈鷀鼕"
    ],
    [
      "Wiktionary gives 韝 another simplified form (𫖕); China's list writes 鞲",
      "韝"
    ],
    ["Wiktionary links both forms only to 鷳, a third form", "鷴"]
  ]
};

/**
 * What the cross-check found that `EXPLAINED` does not account for: differences with no reason, and
 * reasons for differences that no longer occur. Both empty when the grouping matches the record.
 */
export const unexplained = (
  found: CrossCheck,
  explained: typeof EXPLAINED = EXPLAINED
): { differences: string[]; stale: string[] } => {
  const splits = new Set(explained.split.flatMap(([, pairs]) => pairs));
  const keys = new Set(
    // Han characters are one code point each, so splitting by code point is splitting by character.
    explained.unconnected.flatMap(([, chars]) => Array.from(chars))
  );
  const foundSplits = new Set(found.split);
  const foundKeys = new Set(found.unconnected);
  return {
    differences: [
      ...found.split
        .filter((pair) => !splits.has(pair))
        .map((pair) => `split ${pair}`),
      ...found.unconnected
        .filter((key) => !keys.has(key))
        .map((key) => `unconnected ${key}`)
    ],
    stale: [
      ...[...splits]
        .filter((pair) => !foundSplits.has(pair))
        .map((pair) => `split ${pair}`),
      ...[...keys]
        .filter((key) => !foundKeys.has(key))
        .map((key) => `unconnected ${key}`)
    ]
  };
};

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Download the pinned extraction, check it is the one pinned, and parse it. `file` reads it from disk
 * instead (`JISHO_WIKTIONARY_FILE`), to build with an extraction before it is published; the checksum
 * must still match the pin.
 */
export const fetchWiktionary = async (
  fetch: Fetch,
  file?: string
): Promise<Wiktionary> => {
  const source = file === undefined || file === "" ? WIKTIONARY_URL : file;
  let bytes: Uint8Array;
  if (source === WIKTIONARY_URL) {
    const res = await fetch(WIKTIONARY_URL);
    if (!res.ok)
      throw new Error(`${WIKTIONARY_URL}: ${res.status} ${res.statusText}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } else bytes = await readFile(source);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== WIKTIONARY_SHA256)
    throw new Error(
      `${source}: sha256 ${actual}, but ${WIKTIONARY_SHA256} is pinned`
    );
  const entries = gunzipSync(bytes)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): WiktionaryEntry => JSON.parse(line));
  return parseWiktionary(entries);
};
