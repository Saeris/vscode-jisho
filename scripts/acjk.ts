/**
 * AnimCJK `dictionaryJa.txt` parsing, shared by the stroke-SVG transform and the data build.
 *
 * The `acjk` field encodes a kanji's component structure with per-component stroke counts, and marks
 * which component is the radical: `願⿰原10頁.9` means 原 = strokes 1–10, 頁 = strokes 11–19, and 頁
 * is the radical. Two features read it — stroke-order part highlighting (which needs the ranges) and
 * the radical picker's position categories (which needs the geometry) — so it lives here rather than
 * in either build script, and the pinned SHA lives with it: classifying against different data than
 * the stroke SVGs ship would be a silent inconsistency.
 *
 * Licensing: APL-derived factual data, like the stroke SVGs (ARPHICPL ships with them).
 */

// Pinned for reproducibility — an upstream change should be a deliberate, reviewable bump, not
// something that silently rewrites 3,821 assets the next time this runs.
export const ANIMCJK_SHA = "ec5e17cca76c87587790bcbce5ea0b4d4fb753d6";
export const SOURCE_BASE = `https://raw.githubusercontent.com/parsimonhi/animCJK/${ANIMCJK_SHA}/svgsJa`;
export const DICT_URL = `https://raw.githubusercontent.com/parsimonhi/animCJK/${ANIMCJK_SHA}/dictionaryJa.txt`;

/** One top-level component of a kanji, with its 1-based inclusive stroke ranges in drawing order. */
export interface AcjkPart {
  literal: string;
  radical: boolean;
  ranges: Array<{ start: number; end: number }>;
}

/** The seven positional categories the Kanji Look & Learn textbook teaches (BACKLOG #30, spec 04). */
export type Position =
  | "hen"
  | "tsukuri"
  | "kanmuri"
  | "ashi"
  | "kamae"
  | "tare"
  | "nyo";

/** Ideographic Description Characters — layout markers carrying no stroke data. */
const isIdc = (ch: string): boolean => {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x2ff0 && cp <= 0x2fff;
};

/**
 * Parse `acjk` (e.g. `願⿰原10頁.9`) into components with stroke ranges. `.` marks the radical, `:`
 * marks a split component (an enclosure drawn in two runs, like 国's 囗 — split segments of the same
 * character merge into one part with multiple ranges). IDC layout characters carry no stroke data
 * and are skipped. Returns null when the field describes fewer than two parts (nothing to tell
 * apart) or doesn't parse.
 */
export const parseAcjk = (
  character: string,
  acjk: string
): { parts: AcjkPart[]; strokeTotal: number } | null => {
  if (!acjk.startsWith(character)) return null;
  const rest = acjk.slice(character.length);
  // A leading '.' means the whole character is its own radical — no per-part radical to mark.
  let i = rest.startsWith(".") ? 1 : 0;
  const segments: Array<{
    literal: string;
    radical: boolean;
    split: boolean;
    count: number;
  }> = [];
  while (i < rest.length) {
    if (isIdc(rest[i])) {
      i++;
      continue;
    }
    const literal = rest[i++];
    let radical = false;
    let split = false;
    while (rest[i] === "." || rest[i] === ":") {
      if (rest[i] === ".") radical = true;
      else split = true;
      i++;
    }
    let digits = "";
    while (i < rest.length && rest[i] >= "0" && rest[i] <= "9") {
      digits += rest[i++];
    }
    if (digits === "") return null;
    segments.push({ literal, radical, split, count: Number(digits) });
  }

  const parts: AcjkPart[] = [];
  let cursor = 0;
  for (const s of segments) {
    const range = { start: cursor + 1, end: cursor + s.count };
    cursor = range.end;
    const merged = s.split
      ? parts.find((p) => p.literal === s.literal)
      : undefined;
    if (merged) {
      merged.ranges.push(range);
      merged.radical ||= s.radical;
    } else {
      parts.push({ literal: s.literal, radical: s.radical, ranges: [range] });
    }
  }
  return parts.length < 2 ? null : { parts, strokeTotal: cursor };
};

/** IDCs whose category is the same wherever the radical sits — the shape itself names the position. */
const POSITION_BY_IDC: Record<string, Position | undefined> = {
  "⿴": "kamae", // ⿴ surround
  "⿵": "kamae", // ⿵ surround from above
  "⿶": "kamae", // ⿶ surround from below
  "⿷": "kamae", // ⿷ surround from left
  "⿻": "kamae", // ⿻ overlaid
  "⿸": "tare", // ⿸ upper-left
  "⿹": "tare", // ⿹ upper-right
  "⿺": "nyo" // ⿺ lower-left
};
/** IDCs where the category depends on WHICH segment carries the radical marker. */
const POSITION_BY_SEGMENT: Record<
  string,
  { first: Position; later: Position } | undefined
> = {
  "⿰": { first: "hen", later: "tsukuri" }, // ⿰ left-right
  "⿱": { first: "kanmuri", later: "ashi" } // ⿱ top-bottom
};

/**
 * Which of the seven positions the radical occupies, or null when the entry cannot say.
 *
 * Derived from the FIRST IDC (the split geometry) plus which segment carries the `.` marker — the
 * mapping in BACKLOG #30, validated against 18/19 of the textbook's own examples and cross-checked
 * against KanjiVG's independent `kvg:position` data. ~6% return null, which is a real distinction
 * rather than a gap: `見.⿱目5儿2` marks 見 as its OWN radical (it is Kangxi radical #147), so there
 * is no sub-component to categorise. Unlisted IDCs (⿲ ⿳ triples) also return null — the validated
 * table does not cover them, and guessing would pollute a majority vote.
 */
export const radicalPosition = (
  character: string,
  acjk: string
): Position | null => {
  if (!acjk.startsWith(character)) return null;
  const rest = acjk.slice(character.length);
  if (rest.startsWith(".")) return null; // the character IS the radical

  let idc: string | null = null;
  let segmentIndex = -1;
  let radicalSegment = -1;
  let i = 0;
  while (i < rest.length) {
    if (isIdc(rest[i])) {
      idc ??= rest[i];
      i++;
      continue;
    }
    i++; // the component literal
    segmentIndex++;
    let radical = false;
    while (rest[i] === "." || rest[i] === ":") {
      if (rest[i] === ".") radical = true;
      i++;
    }
    let digits = "";
    while (i < rest.length && rest[i] >= "0" && rest[i] <= "9") {
      digits += rest[i++];
    }
    if (digits === "") return null;
    if (radical && radicalSegment === -1) radicalSegment = segmentIndex;
  }
  if (idc === null || radicalSegment === -1) return null;

  const fixed = POSITION_BY_IDC[idc];
  if (fixed !== undefined) return fixed;
  const bySegment = POSITION_BY_SEGMENT[idc];
  if (bySegment === undefined) return null;
  return radicalSegment === 0 ? bySegment.first : bySegment.later;
};

/**
 * Which position each Radkfile radical sits in, voted across every kanji that marks it.
 *
 * A radical's position is nearly always fixed (亻 is always hen), so a majority vote absorbs the odd
 * irregular entry rather than trusting any single character.
 *
 * The subtle part is the KEY. Radkfile files variant radicals under an EXEMPLAR KANJI rather than the
 * component glyph — 亻 is stored as 化, ⻌ as 込, 扌 as 扎, 氵 as 汁 — and those keys never match
 * AnimCJK's component literal, so a direct vote misses 69 of 253 radicals. Reading the exemplar's OWN
 * radical is the wrong bridge: AnimCJK marks 化's radical as 匕 (correct — 化 is Kangxi #21) and 九's
 * as 乙, neither being the component exemplified. The MEMBERS are the bridge instead: the kanji filed
 * under a radical all share that component, so the most common radical-literal across them is what
 * the key stands for. That took coverage from 184/253 to 251/253.
 *
 * Returns radical → position, omitting radicals no kanji votes for (~2: 鬯 and 鼎, which essentially
 * only ever ARE the whole character).
 */
export const voteRadicalPositions = (
  radicals: Record<string, { kanji: string[] }>,
  acjkMap: Map<string, string>
): Map<string, Position> => {
  // Votes keyed by AnimCJK's component literal.
  const votes = new Map<string, Map<Position, number>>();
  for (const [character, acjk] of acjkMap) {
    const position = radicalPosition(character, acjk);
    if (position === null) continue;
    const radicalPart = parseAcjk(character, acjk)?.parts.find(
      (p) => p.radical
    );
    if (radicalPart === undefined) continue;
    const forLiteral =
      votes.get(radicalPart.literal) ?? new Map<Position, number>();
    forLiteral.set(position, (forLiteral.get(position) ?? 0) + 1);
    votes.set(radicalPart.literal, forLiteral);
  }
  const plurality = <T>(counts: Map<T, number>): T | undefined =>
    counts.size === 0
      ? undefined
      : [...counts].reduce((best, v) => (v[1] > best[1] ? v : best))[0];

  /** The component an exemplar key stands for, from the components its members share. */
  const componentFor = (radical: string, members: string[]): string => {
    const seen = new Map<string, number>();
    for (const member of members) {
      const acjk = acjkMap.get(member);
      if (acjk === undefined) continue;
      const part = parseAcjk(member, acjk)?.parts.find((p) => p.radical);
      if (part === undefined) continue;
      seen.set(part.literal, (seen.get(part.literal) ?? 0) + 1);
    }
    return plurality(seen) ?? radical;
  };

  const positions = new Map<string, Position>();
  for (const [radical, info] of Object.entries(radicals)) {
    const direct = votes.get(radical);
    const position =
      (direct === undefined ? undefined : plurality(direct)) ??
      plurality(votes.get(componentFor(radical, info.kanji)) ?? new Map());
    if (position !== undefined) positions.set(radical, position);
  }
  return positions;
};

/** `character` → `acjk` for every entry in dictionaryJa.txt (one JSON object per line). */
export const fetchAcjkMap = async (): Promise<Map<string, string>> => {
  const res = await fetch(DICT_URL, {
    headers: { "User-Agent": "vscode-jisho-build" }
  });
  if (!res.ok) throw new Error(`dictionaryJa.txt fetch failed: ${res.status}`);
  const map = new Map<string, string>();
  for (const line of (await res.text()).split("\n")) {
    const t = line.trim().replace(/,$/, "");
    if (!t.startsWith("{")) continue;
    try {
      const row: unknown = JSON.parse(t);
      if (
        typeof row === "object" &&
        row !== null &&
        "character" in row &&
        typeof row.character === "string" &&
        "acjk" in row &&
        typeof row.acjk === "string"
      ) {
        map.set(row.character, row.acjk);
      }
    } catch {
      // Non-JSON lines (array brackets, comments) carry no data.
    }
  }
  return map;
};
