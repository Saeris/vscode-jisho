/**
 * Pure logic for the editor hover provider: find the Japanese text run under the cursor, then
 * pick which tokenized word within it the cursor is on. Kept free of vscode/tokenizer imports so
 * it unit-tests as plain string math.
 */
import { AUX_GLOSS } from "../shared/grammar";

/** Kana, CJK ideographs (+ compat), the prolonged-sound mark and iteration marks. */
const JA_CHAR = /[぀-ゟ゠-ヿ㐀-鿿豈-﫿々〆ヶ]/;
/** Same class, as whole runs (fresh regex per call — a shared /g regex carries lastIndex state). */
const JA_RUNS = (): RegExp => /[぀-ゟ゠-ヿ㐀-鿿豈-﫿々〆ヶ]+/g;

export interface JaRun {
  text: string;
  /** Offset of the run's first character within the line. */
  start: number;
}

/**
 * The contiguous Japanese run containing `character` in `line`, or null. A cursor sitting just
 * past the last character of a run (hover at word end) still counts.
 */
export const japaneseRunAt = (
  line: string,
  character: number
): JaRun | null => {
  const at = (i: number): boolean =>
    i >= 0 && i < line.length && JA_CHAR.test(line[i]);
  let anchor = character;
  if (!at(anchor)) {
    if (!at(anchor - 1)) return null;
    anchor -= 1;
  }
  let start = anchor;
  while (at(start - 1)) start--;
  let end = anchor + 1;
  while (at(end)) end++;
  return { text: line.slice(start, end), start };
};

/** Every Japanese run in a line, in order — the semantic-highlighting walk. */
export const japaneseRuns = (line: string): JaRun[] =>
  [...line.matchAll(JA_RUNS())].map((m) => ({ text: m[0], start: m.index }));

/**
 * A line with mirrordown ruby markup ({食|た}べます) stripped to its base text, plus per-character
 * maps back to the original line. Hover logic runs on `text`; `starts`/`ends` give each stripped
 * character's original span — widened at group edges so a highlight covering a ruby group covers
 * the whole `{…|…}` construct, and so a cursor on the reading or braces maps into the base.
 */
export interface RubyStripped {
  text: string;
  /** starts[i]: original index where stripped char i's unit begins. */
  starts: number[];
  /** ends[i]: original index just past stripped char i's unit. */
  ends: number[];
}

const RUBY = /\{([^|{}\n]+)\|([^{}\n]*)\}/g;

export const stripRuby = (line: string): RubyStripped => {
  const starts: number[] = [];
  const ends: number[] = [];
  let text = "";
  let cursor = 0;
  for (const match of line.matchAll(RUBY)) {
    for (let i = cursor; i < match.index; i++) {
      text += line[i];
      starts.push(i);
      ends.push(i + 1);
    }
    const base = match[1];
    const baseStart = match.index + 1; // past "{"
    const groupEnd = match.index + match[0].length;
    for (let k = 0; k < base.length; k++) {
      text += base[k];
      starts.push(k === 0 ? match.index : baseStart + k);
      ends.push(k === base.length - 1 ? groupEnd : baseStart + k + 1);
    }
    cursor = groupEnd;
  }
  for (let i = cursor; i < line.length; i++) {
    text += line[i];
    starts.push(i);
    ends.push(i + 1);
  }
  return { text, starts, ends };
};

/** The stripped index whose original span contains `origChar` (clamped to the nearest unit). */
export const toStrippedIndex = (
  stripped: RubyStripped,
  origChar: number
): number => {
  for (let i = 0; i < stripped.text.length; i++) {
    if (origChar < stripped.ends[i]) return i;
  }
  return stripped.text.length;
};

export interface RunSegment {
  surface: string;
  lemma: string;
}

/** A morpheme as the grouping logic sees it: optional reading, so plain fixtures stay simple. */
export interface Morpheme extends RunSegment {
  pos: string;
  reading?: string;
}

export interface PosSegment extends RunSegment {
  pos: string;
  reading?: string;
  /** Raw morphemes already folded into this segment (the tokenizer merges verb+auxiliaries). */
  parts?: Morpheme[];
}

const partsOf = (s: PosSegment): Morpheme[] =>
  s.parts ?? [
    { surface: s.surface, lemma: s.lemma, pos: s.pos, reading: s.reading }
  ];

/**
 * Merge each auxiliary (and a verb's て/で) onto the group before it, so a conjugated form is one
 * unit: 食べ|たく|なかっ|た → 食べたくなかった with head lemma 食べる. Hovering any part of the
 * conjugation then describes the word, not the fragment — the "suffixes detached from verbs"
 * problem. Particles otherwise stay their own group (を belongs to no word).
 */
export interface SegmentGroup {
  surface: string;
  lemma: string;
  /** The head morpheme plus every auxiliary attached to it, in order. */
  parts: Morpheme[];
}

export const groupSegments = (segments: PosSegment[]): SegmentGroup[] => {
  const groups: Array<SegmentGroup & { headPos: string }> = [];
  for (const s of segments) {
    const last = groups.at(-1);
    const attaches =
      last !== undefined &&
      (s.pos === "auxiliary" ||
        (s.pos === "particle" &&
          (s.surface === "て" || s.surface === "で") &&
          last.headPos === "verb"));
    if (attaches) {
      last.surface += s.surface;
      last.parts.push(...partsOf(s));
    } else {
      groups.push({
        surface: s.surface,
        lemma: s.lemma,
        headPos: s.pos,
        parts: [...partsOf(s)]
      });
    }
  }
  return groups.map(({ surface, lemma, parts }) => ({
    surface,
    lemma,
    parts
  }));
};

/**
 * A compact reading of a conjugated group's structure, e.g.
 * `食べたくなかった = 食べる + 〜たい (want to) + 〜ない (negation) + 〜た (past)`.
 * Null when the group is a bare word — nothing to explain.
 */
export const describeGroup = (group: SegmentGroup): string | null => {
  if (group.parts.length < 2) return null;
  const chain = group.parts
    .slice(1)
    .map((part) => {
      const gloss = AUX_GLOSS[part.lemma];
      return gloss === undefined
        ? `〜${part.lemma}`
        : `〜${part.lemma} (${gloss})`;
    })
    .join(" + ");
  return `${group.surface} = ${group.parts[0].lemma || group.parts[0].surface} + ${chain}`;
};

/** A word resolved at a cursor: what was written, what to look up, and where it sits. */
export interface ResolvedWord {
  /** The conjugated form as written — what to highlight, and what to speak. */
  surface: string;
  /** The dictionary form to search (the lemma when known, else the surface). */
  lookup: string;
  /** Stripped-space index where the word starts, for mapping back to the original line. */
  start: number;
  /** The matched group, when tokenization produced one (carries the conjugation chain). */
  group?: SegmentGroup;
}

/**
 * The segment covering `offset` within the run the segments tile, plus the offset where it starts
 * — the hover's lookup candidate and highlight range. Null when offset falls past the segments
 * (defensive; segments should tile the run exactly).
 */
export const wordAt = <S extends RunSegment>(
  segments: S[],
  offset: number
): { segment: S; start: number } | null => {
  let start = 0;
  for (const segment of segments) {
    const end = start + segment.surface.length;
    if (offset < end) return { segment, start };
    start = end;
  }
  return null;
};

/**
 * Resolve the word at a cursor inside a Japanese run, given that run's grouped segmentation.
 *
 * Pure, so the hover and the editor commands share ONE definition of "the word under the cursor" —
 * two implementations would eventually disagree about which word a click means. Callers do the
 * async part (tokenizing the run) and hand the groups in. With no groups (a kana-only run nobody
 * tokenized), the whole run is the word.
 */
export const resolveWord = (
  run: JaRun,
  groups: SegmentGroup[],
  cursor: number
): ResolvedWord => {
  const hit = wordAt(groups, cursor - run.start);
  if (hit === null) {
    return { surface: run.text, lookup: run.text, start: run.start };
  }
  return {
    surface: hit.segment.surface,
    lookup: hit.segment.lemma === "" ? hit.segment.surface : hit.segment.lemma,
    start: run.start + hit.start,
    group: hit.segment
  };
};

/**
 * The lemma of the auxiliary morpheme under the cursor, or null.
 *
 * A conjugated group is one hover target (食べたくなかった all describes 食べる), but the cursor is
 * still sitting on ONE of its pieces — and which piece it is, is the difference between explaining
 * 〜たい and explaining 〜た. Walks the group's morphemes by surface length to find the one spanning
 * the cursor, which is the same offset arithmetic `wordAt` does one level up.
 *
 * Returns null for the head word (the content morpheme is explained by its dictionary entry, not by
 * a grammar note) and for any morpheme that is not an auxiliary.
 */
export const auxiliaryAt = (
  group: SegmentGroup,
  groupStart: number,
  cursor: number
): string | null => {
  let offset = groupStart;
  for (const [index, part] of group.parts.entries()) {
    const end = offset + part.surface.length;
    if (cursor >= offset && cursor < end) {
      // Index 0 is the content word the group is built around; its meaning is the dictionary entry.
      if (index === 0 || part.pos !== "auxiliary") return null;
      return part.lemma === "" ? part.surface : part.lemma;
    }
    offset = end;
  }
  return null;
};
