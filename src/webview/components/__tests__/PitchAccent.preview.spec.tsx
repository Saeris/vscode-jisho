import { describe, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/react";
import { PitchAccent } from "../PitchAccent";

/**
 * Not an assertion suite — a visual bench. Renders every accent pattern at once and screenshots it,
 * so the contour can be judged by eye without launching the whole extension. This is the fast inner
 * loop for the component's appearance; correctness is asserted in PitchAccent.browser.spec.tsx.
 *
 * Shot lands in __screenshots__/ (gitignored). Run: vp test --project browser
 */
describe("pitch accent preview", () => {
  it("renders every accent pattern for visual review", async () => {
    render(
      <div
        style={{
          // Approximate the webview's theme so the contrast is representative.
          background: "#1f1f1f",
          color: "#ccc",
          padding: "24px",
          font: "16px system-ui",
          display: "grid",
          gap: "14px",
          width: "440px"
        }}
      >
        {(
          [
            ["heiban (0) みず — rises, never falls", "みず", 0],
            ["atamadaka (1) いち — starts high, drops at once", "いち", 1],
            ["nakadaka (2) たべる — drop mid-word", "たべる", 2],
            ["odaka (3) おとこ — drop on the particle", "おとこ", 3],
            ["yōon とうきょう [0] — きょ is one mora", "とうきょう", 0],
            ["long コーヒー [3] — ー carries its own mora", "コーヒー", 3]
          ] as [string, string, number][]
        ).map(([label, reading, accent]) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", gap: "12px" }}
          >
            <span style={{ fontSize: "12px", opacity: 0.65, width: "230px" }}>
              {label}
            </span>
            <PitchAccent reading={reading} accents={[accent]} />
          </div>
        ))}
      </div>
    );
    await page.screenshot({ path: "pitch-preview.png" });
  });
});
