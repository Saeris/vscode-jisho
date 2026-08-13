import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { transform } from "../build-strokes";
import type { AcjkPart } from "../acjk";

// A real AnimCJK source SVG (近, U+8FD1), trimmed to what the transform reads: the embedded <style>,
// the filled glyph paths, the clip-path defs, and the animated medians with their --d delays.
const SOURCE = `<svg id="z36817" class="acjk" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<style>
<![CDATA[
@keyframes zk { to { stroke-dashoffset:0; } }
svg.acjk path[clip-path] {
	--t:0.8s;
	animation:zk var(--t) linear forwards var(--d);
	stroke-dasharray:3337;
	stroke-dashoffset:3339;
	stroke:#000;
}
svg.acjk path[id] {fill:#ccc;}
]]>
</style>
<path id="z36817d1" d="M548 253C610 234 706 185 764 172Z"/>
<path id="z36817d2" d="M538 393C543 343 541 280 548 253Z"/>
<defs>
	<clipPath id="z36817c1"><use href="#z36817d1"/></clipPath>
	<clipPath id="z36817c2"><use href="#z36817d2"/></clipPath>
</defs>
<path style="--d:1s;" pathLength="3333" clip-path="url(#z36817c1)" d="M677 114L731 160L541 243"/>
<path style="--d:2s;" pathLength="3333" clip-path="url(#z36817c2)" d="M462 218L511 253L501 476L445 613L360 692"/>
</svg>`;

const out = (): string => transform(SOURCE, "近");

/**
 * A kana source (あ, U+3042), trimmed the same way — and carrying the quirk kanji never have: its
 * third stroke crosses itself, so upstream draws it as two clipped FRAGMENTS on a shared stroke
 * number (`c3a` + `c3b`) rather than one path. Coordinates are the real ones, including the
 * trailing fragment's off-canvas start (x = -170).
 */
const KANA_SOURCE = `<svg id="z12354" class="acjk" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<style><![CDATA[ @keyframes zk { to { stroke-dashoffset:0; } } ]]></style>
<path id="z12354d1" d="M660 211C637 211 616 221 597 232Z"/>
<path id="z12354d2" d="M334 128C328 130 318 134 320 143Z"/>
<path id="z12354d3a" d="M559 431C556 431 552 435 555 438Z"/>
<path id="z12354d3b" d="M602 484C565 485 528 489 492 494Z"/>
<defs>
	<clipPath id="z12354c1"><use href="#z12354d1"/></clipPath>
	<clipPath id="z12354c2"><use href="#z12354d2"/></clipPath>
	<clipPath id="z12354c3a"><use href="#z12354d3a"/></clipPath>
	<clipPath id="z12354c3b"><use href="#z12354d3b"/></clipPath>
</defs>
<path style="--d:1s;" pathLength="3333" clip-path="url(#z12354c1)" d="M 174,258 251,308 440,306 697,241"/>
<path style="--d:2s;" pathLength="3333" clip-path="url(#z12354c2)" d="M 331,137 420,185 373,388 367,632"/>
<path style="--d:3s;" pathLength="3333" clip-path="url(#z12354c3a)" d="M 570,440 610,484 460,727 200,836"/>
<path style="--d:4s;" pathLength="3333" clip-path="url(#z12354c3b)" d="M -170,442 -210,484 -60,727 200,836"/>
</svg>`;

const groupOf = (svg: string, cls: string): string =>
  new RegExp(`<g class="${cls}">([\\s\\S]*?)</g>`).exec(svg)?.[1] ?? "";

describe("stroke SVG transform", () => {
  it("removes the embedded stylesheet entirely", () => {
    // WHY: this is the whole reason the transform exists. The source's <style> starts the animation
    // the moment the markup is in the DOM — it autoplays, and nothing outside the SVG can stop it.
    // The app can only own playback if these rules are gone.
    expect(out()).not.toContain("<style");
    expect(out()).not.toContain("@keyframes");
  });

  it("drops the hardcoded per-stroke delay", () => {
    // WHY: --d:1s/2s/3s bakes a fixed 1s-per-stroke timeline into the DATA. Timing is a UI decision
    // (speed control, seeking, reduced-motion), so it belongs in CSS, not in the asset.
    expect(out()).not.toContain("--d:");
  });

  it("puts the animated strokes alone in their own group", () => {
    // WHY: g.strokes is the selector the whole draw-on effect hangs off, so it must contain the
    // medians and NOTHING else — in the source they are siblings of <style>, <defs> and the filled
    // paths. (The stroke NUMBER now comes from a stamped --stroke rather than sibling-index(),
    // because a kana's split stroke is two paths sharing one number.)
    const strokes = groupOf(out(), "strokes");
    expect([...strokes.matchAll(/<path/g)]).toHaveLength(2);
    expect(strokes).not.toContain("<style");
    expect(strokes).not.toContain("<clipPath");
    // Every child is an animated median (identified by its clip-path), not a filled shape.
    expect([...strokes.matchAll(/clip-path=/g)]).toHaveLength(2);
  });

  it("keeps pathLength so stroke length needs no measuring", () => {
    // WHY: pathLength normalises every median to 3333 units, which is what lets stroke-dasharray be
    // a constant in CSS. Without it we'd have to measure each path in JS (what dmak does) — the
    // thing this design exists to avoid.
    expect([...out().matchAll(/pathLength="3333"/g)]).toHaveLength(2);
  });

  it("reproduces the reference guide geometry exactly", () => {
    // WHY: the offset algorithm is a hand-tuned port (heading classification + offset table). Its
    // output was validated across thousands of characters, so drift here is a regression even when
    // it "looks fine" — this pins stroke 1 of 近 to the known-good curve from the original script:
    //   M581,114 Q608,137 596.125,142.1875 Q524.875,173.3125 513,178.5
    // (we round to 2dp, hence 596.13 / 524.88 — a deliberate file-size trade, not a geometry change)
    const guides = groupOf(out(), "guides");
    const offset = /<path class="g1 offset"[^>]* d="([^"]*)"/.exec(guides)?.[1];
    expect(offset).toBe(
      "M581,114 Q608,137 596.13,142.19 Q524.88,173.31 513,178.5"
    );
  });

  it("emits both guide variants so the offset is a runtime dial", () => {
    // WHY: the offset guide can spill outside the character's bounding box; the median-aligned one
    // never does but overlaps the stroke. Shipping both lets @property interpolate between them
    // instead of baking the trade-off into the asset. The aligned variant must trace the median.
    const guides = groupOf(out(), "guides");
    const aligned = /<path class="g1 aligned"[^>]* d="([^"]*)"/.exec(
      guides
    )?.[1];
    // Starts exactly on the median's first point (677,114), unlike the offset variant (581,114).
    expect(aligned?.startsWith("M677,114")).toBe(true);
    expect([...guides.matchAll(/class="g\d+ aligned"/g)]).toHaveLength(2);
    expect([...guides.matchAll(/class="g\d+ offset"/g)]).toHaveLength(2);
  });

  it("tags every guide element with its stroke number", () => {
    // WHY: --gs is how CSS knows which stroke a guide belongs to, so it can show only the NEXT one.
    // Deriving it from sibling-index() instead would break on dot-only strokes (1 element, not 3).
    const guides = groupOf(out(), "guides");
    expect([...guides.matchAll(/--gs:1/g)].length).toBeGreaterThanOrEqual(3);
    expect([...guides.matchAll(/--gs:2/g)].length).toBeGreaterThanOrEqual(3);
  });

  it("numbers each stroke's start marker", () => {
    // WHY: the marker doubles as the stroke's ordinal, so the reader can see the order without a
    // separate legend. ①=U+2460; verified in the webview that these render through ㉙ (max is 29).
    const guides = groupOf(out(), "guides");
    expect(guides).toContain(">①</text>");
    expect(guides).toContain(">②</text>");
  });

  it("stamps each stroke and glyph fill with its part ordinal", () => {
    // WHY: highlighting a part must work at ANY playhead. Drawn strokes highlight via g.strokes,
    // undrawn ones via the glyph underlay — so BOTH copies of each stroke carry --part, and CSS
    // compares it to --hl-part with the same abs() equality the chart uses.
    const parts: AcjkPart[] = [
      { literal: "斤", radical: false, ranges: [{ start: 1, end: 1 }] },
      { literal: "⻌", radical: true, ranges: [{ start: 2, end: 2 }] }
    ];
    const svg = transform(SOURCE, "近", parts);
    for (const cls of ["strokes", "glyph"]) {
      const g = groupOf(svg, cls);
      // Matched within the style attribute rather than as the whole of it: medians also carry the
      // stamped --stroke ordinal, so the two declarations share one `style`.
      expect(g).toMatch(/style="[^"]*--part:1/);
      expect(g).toMatch(/style="[^"]*--part:2/);
    }
  });

  it("stamps every median with its stroke ordinal", () => {
    // WHY: the CSS derives the draw-on timeline from --stroke, having previously used
    // sibling-index(). That index was the stroke number only while paths and strokes were 1:1 — the
    // kana set breaks it. For a kanji, where nothing is split, the stamped value must equal the
    // sibling position it replaced, or all 3,821 characters animate in the wrong order.
    const strokes = groupOf(out(), "strokes");
    expect([...strokes.matchAll(/--stroke:(\d+)/g)].map((m) => m[1])).toEqual([
      "1",
      "2"
    ]);
  });

  it("emits per-part hit rects, largest first, with the radical marked", () => {
    // WHY: the hit target is the part's bounding BOX (bigger than the strokes, per the KL&L-style
    // click-a-region design) while hover styling goes on the strokes. Largest-first emission makes
    // an enclosing part (kamae 囗) paint under its contents, so the inner part wins hit-testing.
    const parts: AcjkPart[] = [
      { literal: "斤", radical: false, ranges: [{ start: 1, end: 1 }] },
      { literal: "⻌", radical: true, ranges: [{ start: 2, end: 2 }] }
    ];
    const rects = groupOf(transform(SOURCE, "近", parts), "parts");
    expect([...rects.matchAll(/<rect/g)]).toHaveLength(2);
    // Stroke 2's median spans a larger box than stroke 1's, so part 2 must come first.
    expect(rects.startsWith(`<rect data-part="2"`)).toBe(true);
    expect(rects).toContain(`data-literal="⻌" data-radical="true"`);
    // Focusable and named — the rects are the feature's keyboard surface.
    expect(rects).toContain(`aria-label="Part ⻌ (radical)"`);
    expect([...rects.matchAll(/tabindex="0"/g)]).toHaveLength(2);
  });

  it("omits parts entirely when the decomposition disagrees with the stroke count", () => {
    // WHY: acjk and the SVG come from the same upstream but are separate files; if they ever
    // disagree, stamping would highlight the WRONG strokes — silently absent beats silently wrong.
    const parts: AcjkPart[] = [
      { literal: "斤", radical: false, ranges: [{ start: 1, end: 2 }] },
      { literal: "⻌", radical: true, ranges: [{ start: 3, end: 3 }] }
    ];
    const svg = transform(SOURCE, "近", parts);
    expect(svg).not.toContain(`class="parts"`);
    expect(svg).not.toContain("--part:");
  });

  it("separates the static glyph shapes from the animated strokes", () => {
    // WHY: AnimCJK ships the character twice — filled shapes plus medians clipped to them. The fills
    // are static, so at full opacity they show the whole character no matter where playback is (the
    // bug that made the player look complete at stroke 0). The app needs to address them as a group
    // to dim them, which means they need their own <g>.
    const glyph = groupOf(out(), "glyph");
    expect([...glyph.matchAll(/<path/g)]).toHaveLength(2);
    expect(glyph).not.toContain("clip-path");
  });
});

describe("kana stroke SVGs", () => {
  it("renders both fragments of a split stroke, numbered as one stroke", () => {
    // WHY (#55): a self-crossing stroke is drawn as two CLIPPED PIECES sharing a number (あ's third
    // is c3a + c3b) — measured, both carry the same --d:3s and their medians are identical from the
    // crossing on, differing only in a lead-in displaced ~740 units in x. It is one stroke painted
    // in two halves, so dropping either leaves it visibly unfinished (which shipped once), while
    // counting them separately animates あ as four strokes.
    const svg = transform(KANA_SOURCE, "あ", null, "kana");
    const strokes = groupOf(svg, "strokes");
    // Both paths present…
    expect([...strokes.matchAll(/clip-path=/g)]).toHaveLength(4);
    expect(strokes).toContain("c3a");
    expect(strokes).toContain("c3b");
    // …but they claim the SAME stroke ordinal, and the character is 3 strokes.
    expect([...strokes.matchAll(/--stroke:3/g)]).toHaveLength(2);
    expect([...strokes.matchAll(/--stroke:4/g)]).toHaveLength(0);
    // The guides follow the stroke count, so a miscount shows up as a phantom fourth marker.
    expect([...groupOf(svg, "guides").matchAll(/<text/g)]).toHaveLength(3);
  });

  it("guides a split stroke from the fragment that starts where the pen lands", () => {
    // WHY: the start marker and direction arrow come from the median's START, and the trailing
    // fragment's lead-in sits at x = -170 — outside the viewBox. Guiding from it would put the ③
    // off-canvas. The first fragment is the representative for everything except rendering.
    const svg = transform(KANA_SOURCE, "あ", null, "kana");
    expect(groupOf(svg, "guides")).toContain(`x="570" y="440"`);
    expect(groupOf(svg, "guides")).not.toContain("-170");
  });

  it("reads decimal ordinates as whole points", () => {
    // WHY: kana medians carry decimals (お's first stroke is `M 111.6,323.2 174,363.7 …`); kanji
    // medians are always integers. An integer-only pattern does not skip a decimal point, it
    // matches ACROSS it — `111.6,323.2` parses as `6,323`, and the leftover `.2` pairs with the
    // next number. That produced a guide doubling back on itself at x≈2, rendered as a vertical
    // bar over the canvas edge, so this pins the START of the guide to the median's real origin.
    const decimal = `<svg id="z12362" class="acjk" viewBox="0 0 1024 1024">
<path id="z12362d1" d="M111 323C174 363 327 362 535 309Z"/>
<defs><clipPath id="z12362c1"><use href="#z12362d1"/></clipPath></defs>
<path style="--d:1s;" pathLength="3333" clip-path="url(#z12362c1)" d="M 111.6,323.2 174,363.7 327,362.1 535.2,309.4"/>
</svg>`;
    const guides = groupOf(transform(decimal, "お", null, "kana"), "guides");
    expect(guides).toContain(`x="111.6" y="323.2"`);
    // The aligned guide traces the median, so it must start there too — not at a spliced x≈6.
    const aligned = /<path class="g1 aligned"[^>]* d="([^"]*)"/.exec(
      guides
    )?.[1];
    expect(aligned?.startsWith("M111.6,323.2")).toBe(true);
  });

  it("emits direction guides for a kana, not just the numeral", () => {
    // WHY: the two upstream sets write the same polyline differently — kanji put an explicit L
    // before every vertex, kana use one M then implicit lineto pairs. A parser keyed on the command
    // letter found ONE point in a kana median, and one point has no direction, so every kana
    // shipped with a start numeral and no arrows at all. Both arrow variants must be present.
    const guides = groupOf(
      transform(KANA_SOURCE, "あ", null, "kana"),
      "guides"
    );
    expect([...guides.matchAll(/class="g\d+ aligned"/g)]).toHaveLength(3);
    expect([...guides.matchAll(/class="g\d+ offset"/g)]).toHaveLength(3);
  });

  it("states the LGPL rather than the kanji set's Arphic licence", () => {
    // WHY: AnimCJK splits its own terms — kana are LGPL, kanji are Arphic PL — and these files ship
    // to users. A file that misreports its own licence is worse than one carrying no notice, so the
    // header follows the SET the drawing came from, not the transform's default.
    const kana = transform(KANA_SOURCE, "あ", null, "kana");
    expect(kana).toContain("Lesser General Public License");
    expect(kana).not.toContain("Arphic");
    // …and the kanji default is untouched by the parameter existing.
    expect(out()).toContain("Arphic Public License");
    expect(out()).not.toContain("Lesser General Public License");
  });
});

describe("shipped stroke SVG filenames", () => {
  const dirs = ["kanji-svgs", "kana-svgs"].map((d) =>
    join(process.cwd(), "assets", d)
  );

  it("names every drawing by its codepoint, so no filename is non-ASCII", () => {
    // WHY: the filename used to BE the character, which is far easier to read while developing and
    // broke in two environments that neither Windows nor Linux can reproduce.
    //
    //  - macOS reported all 146 kana drawings as modified after a fresh clone: HFS+/APFS normalize
    //    to a decomposed form that git does not.
    //  - The Marketplace rejected the 0.1.0 upload outright — "Item has already been added. Key in
    //    dictionary: 'extension/assets/kana-svgs/….svg'" — a case-insensitive .NET dictionary
    //    folding two distinct kana onto one key.
    //
    // Digits cannot collide under any normalization, case fold or filesystem encoding, which is why
    // this asserts the SHAPE of every name rather than hunting for the specific pairs that folded.
    for (const dir of dirs) {
      const names = readdirSync(dir).filter((f) => f.endsWith(".svg"));
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((n) => !/^[0-9]+\.svg$/u.test(n))).toEqual([]);
    }
  });

  it("resolves a compatibility codepoint to the unified drawing", () => {
    // WHY: dropping the compat files must not strand the 37 compat literals Kanjidic carries — the
    // host normalizes so they land on the unified drawing. Codepoints are built by escape, never
    // pasted: the two glyphs are identical on sight, so an editor that normalizes would gut this.
    const compat = String.fromCodePoint(0xfa47); // CJK COMPATIBILITY IDEOGRAPH-FA47
    const unified = String.fromCodePoint(0x6f22); // 漢
    expect(compat.normalize("NFC")).toBe(unified);
    // The unified drawing ships under ITS codepoint; the compat one has no file of its own, and the
    // host folds onto the unified name before it reads. Both are plain numbers now, so this is a
    // straight existence check rather than the readdir dance the literal names needed.
    expect(existsSync(join(dirs[0], `28450.svg`))).toBe(true);
    expect(existsSync(join(dirs[0], `64071.svg`))).toBe(false);
  });
});
