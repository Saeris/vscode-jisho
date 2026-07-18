import { describe, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WordDetailDto } from "../../../shared/messages";

// The bridge calls acquireVsCodeApi() at module load; stub it before importing anything that pulls
// the bridge in (WordDetail → queries → bridge). vi.hoisted runs before the imports below.
vi.hoisted(() => {
  (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
    postMessage: () => {}
  });
});
const { WordDetail } = await import("../WordDetail");

// 食べる as the host returns it — enough senses/sentences to exercise the example preview cap and
// the conjugation section together.
const word: WordDetailDto = {
  id: "1",
  common: true,
  jlpt: 5,
  kanji: [{ text: "食べる", common: true, tags: [] }],
  kana: [
    {
      text: "たべる",
      common: true,
      tags: [],
      appliesToKanji: ["*"],
      pitchAccents: []
    }
  ],
  senses: [
    {
      partOfSpeech: [{ code: "v1", description: "Ichidan verb" }],
      field: [],
      misc: [],
      info: [],
      dialect: [],
      glosses: ["to eat"],
      appliesToKanji: ["*"],
      appliesToKana: ["*"],
      related: [],
      antonym: [],
      sentences: [
        { ja: "パンを食べます。", en: "I eat bread." },
        { ja: "朝ご飯を食べましたか。", en: "Did you eat breakfast?" },
        { ja: "何か食べたい。", en: "I want to eat something." }
      ]
    }
  ]
};

const vars = {
  background: "#1f1f1f",
  color: "#ccc",
  font: "14px system-ui",
  ["--jisho-fg" as string]: "#ccc",
  ["--jisho-muted" as string]: "#8f8f8f",
  ["--jisho-border" as string]: "#3c3c3c",
  ["--jisho-radius" as string]: "3px",
  ["--jisho-link" as string]: "#4daafc",
  ["--jisho-hover-bg" as string]: "#2a2d2e",
  ["--jisho-badge-bg" as string]: "#4d4d4d",
  ["--jisho-badge-fg" as string]: "#fff",
  ["--jisho-inflection" as string]: "#e8a15c",
  ["--jisho-gap" as string]: "12px"
};

describe("word detail preview", () => {
  it("renders the conjugation section at narrow (stacked) and wide (3-col) widths", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    client.setQueryData(["word", "1"], word);
    render(
      <QueryClientProvider client={client}>
        <div style={{ display: "flex", gap: "16px", alignItems: "start" }}>
          {[300, 430].map((width) => (
            <div
              key={width}
              style={{ ...vars, width: `${width}px`, flexShrink: 0 }}
            >
              <WordDetail
                id="1"
                onBack={() => {}}
                onSearchTerm={() => {}}
                onOpenKanji={() => {}}
              />
            </div>
          ))}
        </div>
      </QueryClientProvider>
    );
    await page.screenshot({ path: "word-detail-preview.png" });
  });
});
