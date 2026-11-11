/**
 * Stroke order by region (spec 22, phase 4): regenerate `assets/hans-svgs/`, `assets/hant-svgs/` and
 * `assets/regional-strokes.json` from AnimCJK's Simplified and Traditional Chinese sets.
 *
 * Run occasionally, not per build:  vp run build:regional-strokes
 *
 * For each group whose Japanese form is a jōyō kanji (the scope chosen on 2026-11-11, to keep the
 * .vsix near 39 MB), China's and Taiwan's forms get a drawing of their own only where Japan's (or,
 * for Taiwan, China's) drawing does not already show them: a different glyph, or the same glyph in a
 * different stroke order. Where the glyph and the order match, the manifest records that the region
 * shares the other's drawing, so "same strokes" is a checked claim, not an assumption: China writes
 * 右, 北, 布 and 必 with Japan's glyph but in another order.
 *
 * The SVGs go through `transform` (build-strokes.ts), so the player renders them exactly as it does
 * Japan's. Licensing: AnimCJK, derived from the Arphic PL KaitiM fonts, under the Arphic Public
 * License; the licence files ship in each directory (docs/STROKE-ORDER.md).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegionalGroup } from "./regional.ts";
import { ANIMCJK_SHA } from "./acjk.ts";
import { transform } from "./build-strokes.ts";
import {
  buildGroups,
  fetchRegionalSources,
  regionalLists
} from "./regional.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const JA_DIR = join(root, "assets", "kanji-svgs");
const HANS_DIR = join(root, "assets", "hans-svgs");
const HANT_DIR = join(root, "assets", "hant-svgs");
const MANIFEST_PATH = join(root, "assets", "regional-strokes.json");
const BASE = `https://raw.githubusercontent.com/parsimonhi/animCJK/${ANIMCJK_SHA}`;
const CN = 0;
const TW = 2;
const JP = 3;

/** Which drawing set draws a form: Japan's (`assets/kanji-svgs`), Simplified or Traditional Chinese. */
export type DrawingSet = "ja" | "hans" | "hant";

/** For China's and Taiwan's forms, the set that draws each; a form not listed has no drawing. */
export interface StrokeManifest {
  cn: Partial<Record<string, DrawingSet>>;
  tw: Partial<Record<string, DrawingSet>>;
}

/** A stroke's median, start to end, in the 1024-unit drawing space. */
type Median = Array<[number, number]>;

/**
 * Two drawings take the same strokes in the same order: as many strokes, each starting and ending
 * within `tolerance` units of the other's. AnimCJK draws each language's set separately, so the
 * outlines never match exactly, but a stroke written in another place or order moves its ends by
 * far more than two drawings of the same stroke differ.
 */
export const sameOrder = (
  a: readonly Median[] | undefined,
  b: readonly Median[] | undefined,
  tolerance = 140
): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  const distance = (p?: [number, number], q?: [number, number]): number =>
    p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity;
  return a.every(
    (median, i) =>
      distance(median[0], b[i]?.[0]) < tolerance &&
      distance(median.at(-1), b[i]?.at(-1)) < tolerance
  );
};

/** Each set's medians by character. */
export interface Medians {
  ja: Map<string, Median[]>;
  hans: Map<string, Median[]>;
  hant: Map<string, Median[]>;
}

/**
 * Which set draws China's and Taiwan's form in each group. A region shares a drawing only with a
 * region that writes the same glyph at the same code point AND takes the same strokes in the same
 * order; anything else gets its own drawing, when the set has one.
 */
export const strokeManifest = (
  groups: readonly RegionalGroup[],
  medians: Medians,
  hasJapanese: (char: string) => boolean
): StrokeManifest => {
  const manifest: StrokeManifest = { cn: {}, tw: {} };
  const sameForm = (group: RegionalGroup, a: number, b: number): boolean =>
    group.glyphSig[a] === group.glyphSig[b] &&
    group.cpSig[a] === group.cpSig[b];
  for (const group of groups) {
    const [cn, , tw, jp] = group.chars;
    const japanese = hasJapanese(jp) ? medians.ja.get(jp) : undefined;
    const chinese = medians.hans.get(cn);
    if (chinese)
      manifest.cn[cn] =
        sameForm(group, CN, JP) && sameOrder(chinese, japanese) ? "ja" : "hans";
    const taiwanese = medians.hant.get(tw);
    if (!taiwanese) continue;
    const china = manifest.cn[cn];
    manifest.tw[tw] =
      china !== undefined &&
      sameForm(group, TW, CN) &&
      sameOrder(taiwanese, chinese)
        ? china
        : sameForm(group, TW, JP) && sameOrder(taiwanese, japanese)
          ? "ja"
          : "hant";
  }
  return manifest;
};

const graphics = async (set: string): Promise<Map<string, Median[]>> => {
  const url = `${BASE}/graphics${set}.txt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const out = new Map<string, Median[]>();
  for (const line of (await res.text()).split("\n")) {
    if (!line.trim()) continue;
    const entry: { character: string; medians: Median[] } = JSON.parse(line);
    out.set(entry.character, entry.medians);
  }
  return out;
};

const sorted = (
  record: Partial<Record<string, DrawingSet>>
): Partial<Record<string, DrawingSet>> =>
  Object.fromEntries(
    Object.entries(record).toSorted(
      ([a], [b]) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0)
    )
  );

const main = async (): Promise<void> => {
  console.log("Downloading the regional sources and AnimCJK's medians…");
  const [sources, ja, hans, hant] = await Promise.all([
    fetchRegionalSources(fetch),
    graphics("Ja"),
    graphics("ZhHans"),
    graphics("ZhHant")
  ]);
  // Grades only set Japan's tier between jōyō and kyōiku; either way the form is jōyō.
  const groups = buildGroups({
    opencc: sources.opencc,
    lists: regionalLists(sources.unihan, sources.taiwan.tiers, new Map()),
    sans: sources.sans,
    serif: sources.serif
  }).filter((group) => group.tiers[JP] > 0);
  const manifest = strokeManifest(groups, { ja, hans, hant }, (char) =>
    existsSync(join(JA_DIR, `${char}.svg`))
  );

  for (const [dir, set, region] of [
    [HANS_DIR, "ZhHans", "cn"],
    [HANT_DIR, "ZhHant", "tw"]
  ] as const) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // The licence travels with the drawings, as it does for Japan's.
    for (const file of ["ARPHICPL.TXT", "ANIMCJK-COPYING.txt"])
      copyFileSync(join(JA_DIR, file), join(dir, file));
    const own = Object.entries(manifest[region])
      .filter(([, drawing]) => drawing === (region === "cn" ? "hans" : "hant"))
      .map(([char]) => char);
    let written = 0;
    // In batches, gently enough for raw.githubusercontent.com (build-strokes.ts fetches 16 at once).
    for (let at = 0; at < own.length; at += 16)
      await Promise.all(
        own.slice(at, at + 16).map(async (char) => {
          const res = await fetch(
            `${BASE}/svgs${set}/${char.codePointAt(0)}.svg`
          );
          if (!res.ok)
            throw new Error(
              `AnimCJK lists ${char} in graphics${set}.txt but has no svgs${set} drawing (${res.status})`
            );
          writeFileSync(
            join(dir, `${char}.svg`),
            transform(await res.text(), char, null, "kanji"),
            "utf8"
          );
          written++;
        })
      );
    const shared = Object.keys(manifest[region]).length - own.length;
    console.log(
      `${region === "cn" ? "China" : "Taiwan"}: ${written} drawings of their own, ${shared} shared with another region's`
    );
  }
  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify({ cn: sorted(manifest.cn), tw: sorted(manifest.tw) }, null, 1)}\n`
  );
  console.log(`Wrote ${MANIFEST_PATH} for ${groups.length} jōyō groups.`);
};

// Only run when invoked directly: the helpers are imported by tests.
if (process.argv[1]?.endsWith("build-regional-strokes.ts")) {
  await main();
}
