import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import subsetFont from "subset-font";
import { describe, expect, it } from "vite-plus/test";
import {
  charsPerFont,
  readSfntNames,
  renameSfnt,
  unicodeRange
} from "../build-regional-fonts";

/** A minimal SFNT with a `head` table and a Windows `name` table holding the given records. */
const sfnt = (names: Record<number, string>): Buffer => {
  const ids = Object.keys(names).map(Number);
  const strings = ids.map((id) =>
    Buffer.from(names[id] ?? "", "utf16le").swap16()
  );
  const name = Buffer.alloc(
    6 + ids.length * 12 + strings.reduce((n, s) => n + s.length, 0)
  );
  name.writeUInt16BE(0, 0);
  name.writeUInt16BE(ids.length, 2);
  name.writeUInt16BE(6 + ids.length * 12, 4);
  let offset = 0;
  for (const [index, id] of ids.entries()) {
    const record = 6 + index * 12;
    const value = strings[index] ?? Buffer.alloc(0);
    name.writeUInt16BE(3, record); // Windows
    name.writeUInt16BE(1, record + 2); // Unicode BMP
    name.writeUInt16BE(0x409, record + 4); // English (US)
    name.writeUInt16BE(id, record + 6);
    name.writeUInt16BE(value.length, record + 8);
    name.writeUInt16BE(offset, record + 10);
    value.copy(name, 6 + ids.length * 12 + offset);
    offset += value.length;
  }
  const head = Buffer.alloc(56);
  const pad = (b: Buffer): Buffer =>
    Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const tables: [string, Buffer][] = [
    ["head", head],
    ["name", name]
  ];
  const directory = Buffer.alloc(12 + tables.length * 16);
  directory.writeUInt32BE(0x4f54544f, 0); // 'OTTO'
  directory.writeUInt16BE(tables.length, 4);
  let at = directory.length;
  for (const [index, [tag, table]] of tables.entries()) {
    const record = 12 + index * 16;
    directory.write(tag, record, "ascii");
    directory.writeUInt32BE(at, record + 8);
    directory.writeUInt32BE(table.length, record + 12);
    at += pad(table).length;
  }
  return Buffer.concat([directory, ...tables.map(([, table]) => pad(table))]);
};

describe("renaming a font", () => {
  it("replaces the family names and leaves the copyright and licence alone", () => {
    // WHY: a modified subset should not present itself as Noto, but the OFL needs its copyright and
    // licence records to travel with the font.
    const renamed = readSfntNames(
      renameSfnt(
        sfnt({
          0: "© 2014-2021 Adobe",
          1: "Noto Sans CJK JP",
          6: "NotoSansCJKjp-Regular",
          13: "SIL Open Font License 1.1"
        }),
        { family: "Jisho Sans JP", postscriptName: "JishoSansJP-Regular" }
      )
    );
    expect(renamed.get(1)).toBe("Jisho Sans JP");
    expect(renamed.get(6)).toBe("JishoSansJP-Regular");
    expect(renamed.get(0)).toBe("© 2014-2021 Adobe");
    expect(renamed.get(13)).toBe("SIL Open Font License 1.1");
  });

  it("refuses a name longer than the one it replaces", () => {
    // WHY: names are rewritten in place; a longer one would overwrite the next record's string.
    expect(() =>
      renameSfnt(sfnt({ 1: "Noto JP" }), {
        family: "Jisho Regional Sans JP",
        postscriptName: "X"
      })
    ).toThrow(/too long/u);
  });
});

describe("choosing each font's characters", () => {
  it("puts a form shared by several regions in one font only", () => {
    // WHY: the sharing is what keeps the fonts near 5 MB; without it every font carries 有.
    const { fonts } = charsPerFont(
      [{ chars: ["有", "有", "有", "有"], glyphSig: "0010", cpSig: "0000" }],
      () => true
    );
    expect(fonts).toEqual([["有"], [], ["有"], []]);
  });

  it("reports a form its font cannot draw instead of subsetting it", () => {
    // WHY: a subset asked for a missing character holds an empty glyph that would hide the system
    // font's fallback, so the reader would see nothing at all.
    const { fonts, uncovered } = charsPerFont(
      [{ chars: ["𬤇", "諲", "諲", "諲"], glyphSig: "0111", cpSig: "0111" }],
      (_, char) => char !== "𬤇"
    );
    expect(fonts[0]).toEqual([]);
    expect(uncovered).toEqual(["𬤇"]);
  });

  it("gives a chunk the span from its first code point to its last, in any order", () => {
    // WHY: the browser fetches a chunk only for the characters in its range. A span that stopped
    // short of a character would send it to a system font instead.
    expect(unicodeRange(["丈", "一", "丂", "丁"])).toBe("U+4E00-4E08");
    expect(unicodeRange(["一"])).toBe("U+4E00");
  });
});

// The committed output of `vp run build:regional-fonts`.
const FONT_DIR = join(process.cwd(), "src", "webview", "fonts", "regional");
const describeIfFonts = existsSync(FONT_DIR) ? describe : describe.skip;

describeIfFonts("the shipped fonts", () => {
  test("are named Jisho, carry their licence, and drop Noto's trademark line", async () => {
    // WHY: the OFL lets us modify Noto, but the result may not pass itself off as Noto. Asking the
    // subsetter to keep IDs 7, 13 and 14 shows what the shipped file holds: it cannot add a record.
    const file = readdirSync(FONT_DIR).find((name) => name.includes("-jp-"));
    expect(file).toBeDefined();
    const font = await subsetFont(
      readFileSync(join(FONT_DIR, file ?? "")),
      "日",
      {
        targetFormat: "sfnt",
        preserveNameIds: [7, 13, 14]
      }
    );
    const names = readSfntNames(font);
    expect(names.get(1)).toBe("Jisho Sans JP");
    expect(names.get(13)).toMatch(/Open Font License/u);
    expect(names.has(7)).toBe(false);
    expect([...names.values()].join(" ")).not.toMatch(/Noto/u);
  });
});
