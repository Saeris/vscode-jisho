import { describe, it } from "vitest";
import { page } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithNavigation } from "../../__tests__/navigationHarness";
import { WordDetail } from "../WordDetail";
import type { WordDetailDto } from "../../../shared/messages";

// 食べる as the host returns it — enough senses/sentences to exercise the example preview cap and
// the conjugation section together.
const word: WordDetailDto = {
  id: "1",
  common: true,
  jlpt: 5,
  // Above MIN_POOL_TO_OFFER, so the preview keeps rendering the "more examples" link.
  poolExamples: 20,
  kanji: [
    { text: "食べる", common: true, tags: [] },
    { text: "喰べる", common: false, tags: ["sK"] }
  ],
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
        { jaFurigana: "パンを{食|た}べます。", en: "I eat bread." },
        {
          jaFurigana: "{朝|あさ}ご{飯|はん}を{食|た}べましたか。",
          en: "Did you eat breakfast?"
        },
        {
          jaFurigana: "{何|なに}か{食|た}べたい。",
          en: "I want to eat something."
        }
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
    client.setQueryData(["kanji", "食"], {
      literal: "食",
      meanings: ["eat", "food"],
      on: ["ショク", "ジキ"],
      kun: ["く.う", "た.べる"]
    });
    client.setQueryData(["kanji", "喰"], null);
    renderWithNavigation(
      <QueryClientProvider client={client}>
        <div style={{ display: "flex", gap: "16px", alignItems: "start" }}>
          {[300, 430].map((width) => (
            <div
              key={width}
              style={{ ...vars, width: `${width}px`, flexShrink: 0 }}
            >
              <WordDetail id="1" />
            </div>
          ))}
        </div>
      </QueryClientProvider>
    );
    await page.screenshot({ path: "word-detail-preview.png" });
  });
});
