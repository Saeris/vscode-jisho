import { describe, expect, it } from "vitest";
import { transform } from "../build-strokes";

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
    // WHY: sibling-index() is what lets CSS know which stroke it's styling — with no JS and no
    // hardcoded nth-child rules. In the source the medians are siblings of <style>, <defs> and the
    // filled paths, so stroke 1 reports index 11. Only children of their own <g> makes the index the
    // stroke number, so g.strokes must contain the medians and NOTHING else.
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
    const offset = /<path class="g1 offset" d="([^"]*)"/.exec(guides)?.[1];
    expect(offset).toBe(
      "M581,114 Q608,137 596.13,142.19 Q524.88,173.31 513,178.5"
    );
  });

  it("emits both guide variants so the offset is a runtime dial", () => {
    // WHY: the offset guide can spill outside the character's bounding box; the median-aligned one
    // never does but overlaps the stroke. Shipping both lets @property interpolate between them
    // instead of baking the trade-off into the asset. The aligned variant must trace the median.
    const guides = groupOf(out(), "guides");
    const aligned = /<path class="g1 aligned" d="([^"]*)"/.exec(guides)?.[1];
    // Starts exactly on the median's first point (677,114), unlike the offset variant (581,114).
    expect(aligned?.startsWith("M677,114")).toBe(true);
    expect([...guides.matchAll(/class="g\d+ aligned"/g)]).toHaveLength(2);
    expect([...guides.matchAll(/class="g\d+ offset"/g)]).toHaveLength(2);
  });

  it("numbers each stroke's start marker", () => {
    // WHY: the marker doubles as the stroke's ordinal, so the reader can see the order without a
    // separate legend. ①=U+2460; verified in the webview that these render through ㉙ (max is 29).
    const guides = groupOf(out(), "guides");
    expect(guides).toContain(">①</text>");
    expect(guides).toContain(">②</text>");
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
