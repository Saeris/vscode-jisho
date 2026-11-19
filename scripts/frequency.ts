/**
 * Each region's character frequency (spec 22, phase 5): a rank per character, from a different
 * corpus per region. The view labels each rank with its region and corpus and never compares them
 * as one scale, because they are not one: news, forums, film and an encyclopedia count differently.
 *
 * - China: Jun Da's Modern Chinese Character Frequency List (© Jun Da, MTSU; it states no licence,
 *   used with credit at the user's decision, 2026-11-12), through hanziDB.csv (MIT, Rudd Fawcett).
 * - Hong Kong: words.hk's character counts (public domain, credit appreciated).
 * - Taiwan: NAER's 2023 corpus character frequency (National Academy for Educational Research,
 *   open with attribution).
 * - Japan: scriptin/kanji-frequency, Japanese Wikipedia (CC BY 4.0).
 *
 * The CSV reader, the ranking and the workbook reader are ported from hanji's scripts/sources.ts
 * (https://github.com/sxzz/hanji, MIT, © Kevin Deng).
 */
import { unzipSync } from "fflate";

const HANZIDB_SHA = "3e9f908d25f70674862343b201f6b641a36cd226";
const KANJI_FREQUENCY_SHA = "62df93626e51a61c3dec58b51bfa20bef79491d7";
const SOURCES = {
  china: `https://raw.githubusercontent.com/ruddfawcett/hanziDB.csv/${HANZIDB_SHA}/data/hanziDB.csv`,
  hongKong: "https://words.hk/faiman/analysis/charcount.csv",
  taiwan:
    "https://teric.naer.edu.tw/wSite/DoDownload?xmlId=2068770&fileName=1761555949158&format=xlsx",
  japan: `https://raw.githubusercontent.com/scriptin/kanji-frequency/${KANJI_FREQUENCY_SHA}/data/wikipedia_characters.csv`
} as const;
/** The sheet of NAER's workbook that holds the combined 2023 corpus ("character frequency table, year 112"). */
const NAER_SHEET = "112年語料字頻表";

const HAN = /^\p{Script=Han}$/u;

/** A minimal RFC 4180 reader: quoted commas, doubled quotes and newlines inside quotes. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

/**
 * Counts to a 1-based competition rank (equal counts share a rank), single Han characters only:
 * the count files also count punctuation, digits and Latin letters.
 */
export const rankCounts = (
  entries: Iterable<readonly [string, number]>
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const [char, count] of entries)
    if (HAN.test(char) && Number.isSafeInteger(count) && count > 0)
      counts.set(char, (counts.get(char) ?? 0) + count);
  const ranked = [...counts].toSorted(
    ([a, x], [b, y]) =>
      y - x || (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0)
  );
  const out = new Map<string, number>();
  let rank = 0;
  let previous: number | undefined;
  for (const [index, [char, count]] of ranked.entries()) {
    if (count !== previous) rank = index + 1;
    out.set(char, rank);
    previous = count;
  }
  return out;
};

/** hanziDB.csv: `frequency_rank,charcter,…`, a rank per character already. */
export const parseHanziDb = (text: string): Map<string, number> => {
  const out = new Map<string, number>();
  for (const [rank = "", char = ""] of parseCsv(text).slice(1)) {
    const value = Number(rank);
    if (HAN.test(char) && Number.isInteger(value) && !out.has(char))
      out.set(char, value);
  }
  return out;
};

/** A CSV of counts: the character and its count in the given columns. */
export const parseCounts = (
  text: string,
  charColumn: number,
  countColumn: number
): Map<string, number> =>
  rankCounts(
    parseCsv(text).map(
      (row) => [row[charColumn] ?? "", Number(row[countColumn])] as const
    )
  );

const decodeXml = (text: string): string =>
  text.replaceAll(/&(?:amp|apos|gt|lt|quot|#\d+|#x[\da-f]+);/giu, (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&apos;": "'",
      "&gt;": ">",
      "&lt;": "<",
      "&quot;": '"'
    };
    if (Object.hasOwn(named, entity)) return named[entity];
    const hex = entity[2]?.toLowerCase() === "x";
    const value = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
  });

const attribute = (tag: string, name: string): string | undefined => {
  const value = new RegExp(String.raw`(?:^|\s)${name}="([^"]*)"`, "u").exec(
    tag
  )?.[1];
  return value === undefined ? undefined : decodeXml(value);
};

/**
 * NAER's workbook: the combined 2023 sheet, found by name rather than position, its characters in
 * column B and counts in column C, read straight from the OOXML so the build needs no spreadsheet
 * library.
 */
export const parseNaerWorkbook = (bytes: Uint8Array): Map<string, number> => {
  const files = unzipSync(bytes);
  const decoder = new TextDecoder();
  const read = (path: string): string => {
    if (!Object.hasOwn(files, path))
      throw new Error(`NAER's workbook has no ${path}`);
    return decoder.decode(files[path]);
  };
  const sheet = [...read("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/gu)]
    .map((match) => match[0])
    .find((tag) => attribute(tag, "name") === NAER_SHEET);
  const relation = sheet === undefined ? undefined : attribute(sheet, "r:id");
  const target = [
    ...read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/gu)
  ]
    .map((match) => match[0])
    .find((tag) => attribute(tag, "Id") === relation);
  const path = target === undefined ? undefined : attribute(target, "Target");
  if (path === undefined)
    throw new Error(`NAER's workbook has no sheet named ${NAER_SHEET}`);
  const shared = [
    ...read("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)
  ].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)]
      .map((part) => decodeXml(part[1]))
      .join("")
  );
  const counts: Array<[string, number]> = [];
  const sheetPath = path.startsWith("/")
    ? path.slice(1)
    : `xl/${path.replace(/^\.\//u, "")}`;
  for (const row of read(sheetPath).matchAll(
    /<row\b[^>]*>([\s\S]*?)<\/row>/gu
  )) {
    const values: Record<string, string> = {};
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)) {
      const column = /^[A-Z]+/u.exec(attribute(cell[1], "r") ?? "")?.[0];
      const raw = /<v>([\s\S]*?)<\/v>/u.exec(cell[2])?.[1];
      if (column === undefined || raw === undefined) continue;
      values[column] =
        attribute(cell[1], "t") === "s"
          ? (shared[Number(raw)] ?? "")
          : decodeXml(raw);
    }
    counts.push([values["B"] ?? "", Number(values["C"])]);
  }
  return rankCounts(counts);
};

/** Each region's ranks, and the date each was fetched or last changed, for the build's provenance. */
export interface Frequencies {
  china: Map<string, number>;
  hongKong: Map<string, number>;
  taiwan: Map<string, number>;
  japan: Map<string, number>;
  /** words.hk's file is live and unversioned; the day it was read stands in for a version. */
  hongKongFetched: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const ok = async (
  fetch: Fetch,
  url: string,
  init?: RequestInit
): Promise<Response> => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res;
};

/**
 * A list far smaller than its corpus says its source changed shape, and a rank built from it would
 * be wrong without failing: each holds thousands of characters.
 */
const atLeast = (
  name: string,
  ranks: Map<string, number>,
  floor: number
): Map<string, number> => {
  if (ranks.size < floor)
    throw new Error(
      `${name} frequency has ${ranks.size} characters, fewer than ${floor}: its source changed shape`
    );
  return ranks;
};

/** Download and parse every region's frequency. `fetch` is the build's retrying fetch. */
export const fetchFrequencies = async (fetch: Fetch): Promise<Frequencies> => {
  const [china, hongKong, taiwan, japan] = await Promise.all([
    ok(fetch, SOURCES.china).then(async (res) =>
      parseHanziDb(await res.text())
    ),
    ok(fetch, SOURCES.hongKong).then(async (res) =>
      parseCounts(await res.text(), 0, 1)
    ),
    // NAER refuses anonymous clients, and reports the uncompressed size even when gzip is
    // negotiated, which strict clients reject (hanji's notes).
    ok(fetch, SOURCES.taiwan, {
      headers: {
        "User-Agent": "vscode-jisho-build",
        Referer:
          "https://teric.naer.edu.tw/wSite/ct?ctNode=645&mp=teric_b&xItem=2068770",
        "Accept-Encoding": "identity"
      }
    }).then(async (res) =>
      parseNaerWorkbook(new Uint8Array(await res.arrayBuffer()))
    ),
    ok(fetch, SOURCES.japan).then(async (res) =>
      parseCounts(await res.text(), 2, 3)
    )
  ]);
  return {
    china: atLeast("China's", china, 5000),
    hongKong: atLeast("Hong Kong's", hongKong, 3000),
    taiwan: atLeast("Taiwan's", taiwan, 5000),
    japan: atLeast("Japan's", japan, 5000),
    hongKongFetched: new Date().toISOString().slice(0, 10)
  };
};
