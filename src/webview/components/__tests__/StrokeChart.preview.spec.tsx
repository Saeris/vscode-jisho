import { describe, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/react";
// ?raw, not readFileSync: this runs in a real Chromium, so the SVG has to come through the bundler.
import svg from "../../../../assets/kanji-svgs/近.svg?raw";
import { StrokeChart } from "../StrokeChart";
import { StrokePlayer } from "../StrokePlayer";

/**
 * Visual bench for the stroke surfaces — renders the player and the chart against a real AnimCJK SVG
 * so the seek trick (negative animation-delay scrubbing the timeline) can be judged by eye. Not an
 * assertion suite; see the sibling .browser.spec.tsx.
 */

describe("stroke surfaces preview", () => {
  it("renders the player and chart for visual review", async () => {
    render(
      <div
        style={{
          // Approximate the webview's theme and the sidebar's narrow width.
          background: "#1f1f1f",
          color: "#ccc",
          padding: "16px",
          font: "13px system-ui",
          width: "300px",
          // The theme vars the components reference.
          ["--jisho-fg" as string]: "#ccc",
          ["--jisho-muted" as string]: "#888",
          ["--jisho-border" as string]: "#3c3c3c",
          ["--jisho-radius" as string]: "3px",
          ["--jisho-accent" as string]: "#0078d4",
          ["--vscode-charts-red" as string]: "#e51400"
        }}
      >
        <StrokePlayer svg={svg} strokeCount={7} />
        <div style={{ marginTop: "20px" }}>
          <StrokeChart svg={svg} strokeCount={7} literal="近" />
        </div>
      </div>
    );
    await page.screenshot({ path: "stroke-preview.png" });
  });
});
