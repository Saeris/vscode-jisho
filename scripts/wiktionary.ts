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
import { ASSET_NAME, type WiktionaryEntry } from "./extract-wiktionary.ts";
import type { RegionalGroup } from "./regional.ts";

export const WIKTIONARY_TAG = "wiktionary-2026-11-12";
export const WIKTIONARY_SHA256 =
  "61ccaa604b59558a5c34986dd11c50419669e07906751a58e87f97b6f4489a85";
const WIKTIONARY_URL = `https://github.com/Saeris/vscode-jisho/releases/download/${WIKTIONARY_TAG}/${ASSET_NAME}`;

/** The section of the page a note is from. */
export type NoteSection = "Translingual" | "Chinese";

export interface Wiktionary {
  /**
   * Each character's notes by section: Translingual says how its forms relate across languages
   * (学: "Simplified from 學 … in simplified Chinese and Japanese shinjitai"), Chinese where the
   * shape came from (學: "Possibly a phono-semantic compound …").
   */
  notes: Map<string, Partial<Record<NoteSection, string>>>;
  /** The pairs Wiktionary labels as Japan's new and old form, as `[shinjitai, kyūjitai]`. */
  reformPairs: Array<[string, string]>;
  /** Each character's page, and the characters it names: as a form, a redirect, or in a note. */
  links: Map<string, Set<string>>;
}

const HAN = /\p{Script=Han}/gu;

/**
 * A note's prose. Wiktextract sometimes leaves a pronunciation table in the etymology (lines starting
 * with `*`), and a page that only sends the reader elsewhere ("For pronunciation and definitions of
 * 台 – see 鮐") says nothing of the shape; neither is a note.
 */
export const noteText = (etymology: string): string | null => {
  if (etymology.startsWith("For pronunciation and definitions of")) return null;
  const prose = etymology
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("*"));
  return prose.length > 0 ? prose.join("\n") : null;
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

/** Read the extraction's entries into notes, Japan's reform pairs and the links between pages. */
export const parseWiktionary = (
  entries: Iterable<WiktionaryEntry>
): Wiktionary => {
  const notes = new Map<string, Partial<Record<NoteSection, string>>>();
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
      const text = noteText(entry.etymology_text);
      if (held[lang] === undefined && text !== null) {
        held[lang] = text;
        notes.set(word, held);
      }
    }
    // Japan's labels are on the character entry: 学 lists 學 as its kyūjitai, 學 lists 学 as its
    // shinjitai. Both directions name the same pair; the cross-check dedupes.
    if (lang === "Japanese" && entry.pos === "character")
      for (const { form, tags } of entry.forms ?? []) {
        if (tags.includes("kyūjitai")) reformPairs.push([word, form]);
        if (tags.includes("shinjitai")) reformPairs.push([form, word]);
      }
  }
  return { notes, reformPairs, links };
};

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
