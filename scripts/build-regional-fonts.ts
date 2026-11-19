/**
 * Region fonts (spec 22, phase 2): regenerate `src/webview/fonts/regional/` and its stylesheet.
 *
 * Run occasionally, not per build:  vp run build:regional-fonts
 *
 * Noto Sans CJK in each region's version (SC China, HK Hong Kong, TC Taiwan, JP Japan), pinned to
 * the commit hanji pins beside the Source Han CMaps that scripts/regional.ts reads: the glyphs
 * drawn must be the ones whose identity the CMaps measured. Each font is subset to the forms it
 * must draw (`fontRegionOf`: regions that write a form with the same glyph share one font), split
 * into chunks of about 300 characters by code point so the webview loads only the chunks on
 * screen, and renamed: Noto CJK reserves no font name under its OFL, but a modified subset should
 * not present itself as Noto.
 *
 * `renameSfnt` is ported from hanji's scripts/sfnt.ts (https://github.com/sxzz/hanji), MIT,
 * © 2026 Kevin Deng. Licensing of the output: SIL Open Font License 1.1, with the copyright and
 * licence records kept in each font and the licence text in THIRD_PARTY_NOTICES.md.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import {
  OLD_COLUMN,
  REGIONAL_FONT_FAMILIES,
  fontRegionOf,
  type FontedGroup
} from "../src/shared/regionalFonts.ts";
import {
  buildGroups,
  fetchRegionalSources,
  regionalLists
} from "./regional.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = join(root, "src", "webview", "fonts", "regional");
const CSS_PATH = join(root, "src", "webview", "styles", "regionalFonts.css");

/** The noto-cjk commit hanji pins (Noto Sans CJK 2.004), matching the Source Han CMap pins. */
export const NOTO_CJK_SHA = "f8d157532fbfaeda587e826d4cd5b21a49186f7c";
/** Noto's directory and file suffix for each region, in REGIONAL_FONT_FAMILIES order. */
const NOTO_SOURCES = [
  ["SimplifiedChinese", "sc"],
  ["TraditionalChineseHK", "hk"],
  ["TraditionalChinese", "tc"],
  ["Japanese", "jp"]
] as const;
/** Small enough that a page with a few characters loads a few small files, large enough to batch. */
const CHUNK = 300;
/**
 * Name records to keep beyond HarfBuzz's default (IDs 0–6): the licence (13) and its URL (14), which
 * the OFL asks to travel with the font. The copyright (0) is kept by default. The trademark (7),
 * "Noto is a trademark of Google Inc.", is dropped with the name: this font is not Noto.
 */
const KEPT_NAMES = [13, 14];

// ── Choosing the characters ───────────────────────────────────────────────────────────────────────

/** Each font's characters, sorted by code point, and the forms no font can draw. */
export const charsPerFont = (
  groups: Iterable<FontedGroup>,
  covers: (font: number, char: string) => boolean
): { fonts: string[][]; uncovered: string[] } => {
  const sets = REGIONAL_FONT_FAMILIES.map(() => new Set<string>());
  const uncovered = new Set<string>();
  const add = (font: number, char: string): void => {
    if (covers(font, char)) sets[font]?.add(char);
    else uncovered.add(char);
  };
  for (const group of groups) {
    for (const [region, char] of group.chars.entries())
      add(fontRegionOf(group, region), char);
    if (group.old !== undefined)
      add(fontRegionOf(group, OLD_COLUMN), group.old);
  }
  const byCodePoint = (a: string, b: string): number =>
    (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0);
  return {
    fonts: sets.map((set) => [...set].toSorted(byCodePoint)),
    uncovered: [...uncovered].toSorted(byCodePoint)
  };
};

/**
 * A chunk's CSS `unicode-range`: one span, from its first code point to its last.
 *
 * Listing each code point made the stylesheet 131 KB, which the webview parses before its first
 * paint. A span is safe because chunks hold consecutive characters, so their spans never overlap,
 * and the view draws a form only in the family whose font holds it (`fontRegionOf`): a code point
 * inside a span that its chunk lacks is never asked of that family.
 */
export const unicodeRange = (chars: readonly string[]): string => {
  const points = chars.map((char) => char.codePointAt(0) ?? 0);
  const hex = (point: number): string => point.toString(16).toUpperCase();
  const [first, last] = [Math.min(...points), Math.max(...points)];
  return first === last ? `U+${hex(first)}` : `U+${hex(first)}-${hex(last)}`;
};

/** One `@font-face` per chunk; the browser fetches only the chunks whose range a page uses. */
export const fontFaceCss = (
  faces: ReadonlyArray<{
    family: string;
    file: string;
    chars: readonly string[];
  }>
): string =>
  faces
    .map(
      ({ family, file, chars }) => `@font-face {
  font-family: "${family}";
  src: url("../fonts/regional/${file}") format("woff2");
  unicode-range: ${unicodeRange(chars)};
  /* Comparing shapes is the point: a fallback glyph shown while loading would mislead. */
  font-display: block;
}
`
    )
    .join("\n");

// ── Renaming (ported from hanji, MIT) ─────────────────────────────────────────────────────────────

interface TableRecord {
  directoryOffset: number;
  offset: number;
  length: number;
}

const uint32 = (value: number): number => value >>> 0;

const tableRecords = (font: Buffer): Map<string, TableRecord> => {
  const tables = new Map<string, TableRecord>();
  const count = font.readUInt16BE(4);
  for (let index = 0; index < count; index++) {
    const directoryOffset = 12 + index * 16;
    tables.set(font.toString("ascii", directoryOffset, directoryOffset + 4), {
      directoryOffset,
      offset: font.readUInt32BE(directoryOffset + 8),
      length: font.readUInt32BE(directoryOffset + 12)
    });
  }
  return tables;
};

const checksum = (font: Buffer, offset: number, length: number): number => {
  let sum = 0;
  const end = offset + Math.ceil(length / 4) * 4;
  for (let cursor = offset; cursor < end; cursor += 4) {
    let word = 0;
    for (let byte = 0; byte < 4; byte++)
      word = (word << 8) | (font[cursor + byte] ?? 0);
    sum = uint32(sum + uint32(word));
  }
  return sum;
};

/** Platforms 0 (Unicode) and 3 (Windows) store names as UTF-16BE, the others as single bytes. */
const encodeName = (platform: number, value: string): Buffer => {
  if (platform !== 0 && platform !== 3) return Buffer.from(value, "ascii");
  const encoded = Buffer.alloc(value.length * 2);
  for (let index = 0; index < value.length; index++)
    encoded.writeUInt16BE(value.charCodeAt(index), index * 2);
  return encoded;
};

/** The name table's records: name ID → value (the Windows record when there is one). */
export const readSfntNames = (font: Buffer): Map<number, string> => {
  const name = tableRecords(font).get("name");
  if (!name) throw new Error("font has no name table");
  const count = font.readUInt16BE(name.offset + 2);
  const strings = name.offset + font.readUInt16BE(name.offset + 4);
  const out = new Map<number, string>();
  for (let index = 0; index < count; index++) {
    const record = name.offset + 6 + index * 12;
    const platform = font.readUInt16BE(record);
    const id = font.readUInt16BE(record + 6);
    const bytes = font.subarray(
      strings + font.readUInt16BE(record + 10),
      strings + font.readUInt16BE(record + 10) + font.readUInt16BE(record + 8)
    );
    if (platform === 3 || !out.has(id))
      out.set(
        id,
        platform === 0 || platform === 3
          ? Buffer.from(bytes).swap16().toString("utf16le")
          : bytes.toString("latin1")
      );
  }
  return out;
};

/**
 * Replace the family and PostScript names in an SFNT font, leaving its copyright and licence
 * records alone. Each replacement must fit the upstream name's storage, so the table keeps its
 * offsets; HarfBuzz rebuilds the table when it writes the subset.
 */
export const renameSfnt = (
  font: Buffer,
  names: { family: string; postscriptName: string }
): Buffer => {
  const output = Buffer.from(font);
  const tables = tableRecords(output);
  const name = tables.get("name");
  const head = tables.get("head");
  if (!name || !head) throw new Error("font has no name or head table");

  const count = output.readUInt16BE(name.offset + 2);
  const strings = name.offset + output.readUInt16BE(name.offset + 4);
  const replacements: Partial<Record<number, string>> = {
    1: names.family,
    3: names.postscriptName,
    4: names.family,
    6: names.postscriptName,
    16: names.family,
    21: names.family,
    25: names.postscriptName.replace(/-Regular$/u, "")
  };
  for (let index = 0; index < count; index++) {
    const record = name.offset + 6 + index * 12;
    const value = replacements[output.readUInt16BE(record + 6)];
    if (value === undefined) continue;
    const encoded = encodeName(output.readUInt16BE(record), value);
    const capacity = output.readUInt16BE(record + 8);
    if (encoded.length > capacity)
      throw new Error(`replacement font name is too long: ${value}`);
    const offset = strings + output.readUInt16BE(record + 10);
    output.fill(0, offset, offset + capacity);
    encoded.copy(output, offset);
    output.writeUInt16BE(encoded.length, record + 8);
  }

  // Keep the font internally consistent before handing it to HarfBuzz.
  output.writeUInt32BE(
    checksum(output, name.offset, name.length),
    name.directoryOffset + 4
  );
  output.writeUInt32BE(0, head.offset + 8);
  output.writeUInt32BE(
    checksum(output, head.offset, head.length),
    head.directoryOffset + 4
  );
  output.writeUInt32BE(
    uint32(0xb1b0afba - checksum(output, 0, output.length)),
    head.offset + 8
  );
  return output;
};

// ── The build ─────────────────────────────────────────────────────────────────────────────────────

const download = async (url: string): Promise<Buffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
};

const main = async (): Promise<void> => {
  console.log("Downloading the regional sources…");
  const sources = await fetchRegionalSources(fetch);
  // Grades only set Japan's tiers, which no font depends on.
  const groups = buildGroups({
    opencc: sources.opencc,
    lists: regionalLists(sources.unihan, sources.taiwan.tiers, new Map()),
    sans: sources.sans,
    serif: sources.serif
  });
  // A font draws exactly the code points its region's CMap maps: the same pinned glyph set.
  const { fonts, uncovered } = charsPerFont(groups, (font, char) =>
    sources.sans[font].has(char.codePointAt(0) ?? 0)
  );

  rmSync(FONT_DIR, { recursive: true, force: true });
  mkdirSync(FONT_DIR, { recursive: true });
  const faces: Array<{ family: string; file: string; chars: string[] }> = [];
  let bytes = 0;
  for (const [font, [directory, suffix]] of NOTO_SOURCES.entries()) {
    const family = REGIONAL_FONT_FAMILIES[font];
    const chars = fonts[font] ?? [];
    console.log(`${family}: ${chars.length} characters`);
    const source = renameSfnt(
      await download(
        `https://raw.githubusercontent.com/notofonts/noto-cjk/${NOTO_CJK_SHA}/Sans/OTF/${directory}/NotoSansCJK${suffix}-Regular.otf`
      ),
      {
        family,
        postscriptName: `${family.replaceAll(" ", "")}-Regular`
      }
    );
    for (let at = 0, part = 0; at < chars.length; at += CHUNK, part++) {
      const chunk = chars.slice(at, at + CHUNK);
      const file = `jisho-sans-${suffix}-${String(part).padStart(2, "0")}.woff2`;
      // A single character needs no layout closure, and dropping it halves the output (phase 0).
      const woff2 = await subsetFont(source, chunk.join(""), {
        targetFormat: "woff2",
        noLayoutClosure: true,
        preserveNameIds: KEPT_NAMES
      });
      writeFileSync(join(FONT_DIR, file), woff2);
      bytes += woff2.length;
      faces.push({ family, file, chars: chunk });
    }
  }
  writeFileSync(
    CSS_PATH,
    `/* Generated by scripts/build-regional-fonts.ts: do not edit. Noto Sans CJK ${NOTO_CJK_SHA.slice(0, 7)},\n   subset and renamed, under the SIL Open Font License 1.1 (see THIRD_PARTY_NOTICES.md). */\n\n${fontFaceCss(faces)}`
  );
  console.log(
    `Wrote ${readdirSync(FONT_DIR).length} files, ${(bytes / 1048576).toFixed(2)} MB, for ${groups.length} groups.`
  );
  // Not a failure: Source Han, and so Noto, has no glyph for these, and the webview falls back to
  // a system font.
  if (uncovered.length > 0)
    console.log(
      `  ${uncovered.length} forms no region font covers: ${uncovered.slice(0, 30).join("")}${uncovered.length > 30 ? "…" : ""}`
    );
};

// Only run when invoked directly: the helpers are imported by tests.
if (process.argv[1]?.endsWith("build-regional-fonts.ts")) {
  await main();
}
