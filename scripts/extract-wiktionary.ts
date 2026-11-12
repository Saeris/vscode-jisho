/**
 * The Wiktionary extraction job (spec 22, phase 6): stream Wiktextract's full English Wiktionary dump
 * once and keep what the regional-forms notes use, for every single Han character.
 *
 *   vp exec node scripts/extract-wiktionary.ts <out-dir> [dump-path-or-url]
 *
 * Run on demand (the `wiktionary` workflow), not per data build: the dump is 2.9 GB compressed, and
 * kaikki.org's per-language files are due to be removed. The result is published as a release asset
 * that `scripts/wiktionary.ts` pins by tag and checksum, so a data build reads the same notes until
 * someone re-runs this job and updates the pin.
 *
 * It keeps every single Han character rather than the characters the data build groups today, so a
 * change to the grouping never needs a new extraction. Wiktionary's text is CC BY-SA 4.0; Wiktextract
 * (kaikki.org) asks to be cited by its LREC 2022 paper (THIRD_PARTY_NOTICES.md).
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";

export const DUMP_URL =
  "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz";
export const ASSET_NAME = "wiktionary-han.jsonl.gz";

const LANGS = new Set(["Translingual", "Chinese", "Japanese"]);

/** One kept entry: the fields `scripts/wiktionary.ts` reads, under Wiktextract's own names. */
export interface WiktionaryEntry {
  word: string;
  lang: string;
  pos: string;
  etymology_text?: string;
  /** A Chinese "soft redirect": a variant page that only points at its standard form. */
  redirects?: string[];
  forms?: Array<{ form: string; tags: string[] }>;
}

/** One Han character, as one code point. */
const HAN = /^\p{Script=Han}$/u;

/**
 * A cheap test before parsing: does the line hold a one-character `word` at all? Nested objects carry
 * `word` and `lang` keys too, so a match only says the line may qualify; the parsed entry's own
 * top-level fields decide (phase 0 lost 2,700 Japanese entries to a filter that trusted the first).
 */
const WORD = /"word": "([^"\\]{1,2})"/g;
const mayQualify = (line: string): boolean => {
  for (const [, word] of line.matchAll(WORD)) if (HAN.test(word)) return true;
  return false;
};

/** The entry pruned to what the notes and the cross-check use, or `null` when it is out of scope. */
export const pruneEntry = (raw: unknown): WiktionaryEntry | null => {
  if (typeof raw !== "object" || raw === null) return null;
  // Read field by field: the dump is untrusted JSON, so nothing about its shape is assumed.
  const field = (name: string): unknown => Reflect.get(raw, name);
  const [word, lang, pos] = [field("word"), field("lang"), field("pos")];
  if (typeof word !== "string" || !HAN.test(word)) return null;
  if (typeof lang !== "string" || !LANGS.has(lang)) return null;
  const kept: WiktionaryEntry = {
    word,
    lang,
    pos: typeof pos === "string" ? pos : ""
  };
  const etymology = field("etymology_text");
  if (typeof etymology === "string") kept.etymology_text = etymology;
  const redirects = field("redirects");
  if (Array.isArray(redirects))
    kept.redirects = redirects.filter(
      (target): target is string => typeof target === "string"
    );
  const allForms = field("forms");
  if (Array.isArray(allForms)) {
    const forms = allForms.flatMap((form: unknown) => {
      if (typeof form !== "object" || form === null) return [];
      const text: unknown = Reflect.get(form, "form");
      const tags: unknown = Reflect.get(form, "tags");
      // Only a form that is itself one character can name a variant of this one.
      if (typeof text !== "string" || !HAN.test(text)) return [];
      return [
        {
          form: text,
          tags: Array.isArray(tags)
            ? tags.filter((tag): tag is string => typeof tag === "string")
            : []
        }
      ];
    });
    if (forms.length > 0) kept.forms = forms;
  }
  return kept;
};

const openDump = async (source: string): Promise<Readable> => {
  if (!/^https?:/u.test(source)) return createReadStream(source);
  const res = await fetch(source);
  if (!res.ok || !res.body) throw new Error(`${source}: ${res.status}`);
  // Readable.from takes the fetch body's web stream directly (as build-data.ts does).
  return Readable.from(res.body);
};

const main = async (): Promise<void> => {
  const outDir = process.argv.at(2);
  const source = process.argv.at(3) ?? DUMP_URL;
  if (outDir === undefined)
    throw new Error(
      "usage: extract-wiktionary.ts <out-dir> [dump-path-or-url]"
    );
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, ASSET_NAME);
  const started = Date.now();
  const gzip = createGzip({ level: 9 });
  const written = pipeline(gzip, createWriteStream(outPath));
  const lines = createInterface({
    input: (await openDump(source)).pipe(createGunzip()),
    crlfDelay: Infinity
  });
  let read = 0;
  let kept = 0;
  const byLang: Record<string, number> = {};
  for await (const line of lines) {
    read++;
    if (!mayQualify(line)) continue;
    const entry = pruneEntry(JSON.parse(line));
    if (entry === null) continue;
    if (!gzip.write(`${JSON.stringify(entry)}\n`))
      await new Promise((resolve) => gzip.once("drain", resolve));
    kept++;
    byLang[entry.lang] = (byLang[entry.lang] ?? 0) + 1;
  }
  gzip.end();
  await written;
  const hash = createHash("sha256");
  await pipeline(createReadStream(outPath), hash);
  await writeFile(`${outPath}.sha256`, hash.digest("hex"), "utf8");
  console.log(
    JSON.stringify({
      read,
      kept,
      byLang,
      seconds: Math.round((Date.now() - started) / 1000)
    })
  );
};

if (process.argv[1]?.endsWith("extract-wiktionary.ts")) await main();
