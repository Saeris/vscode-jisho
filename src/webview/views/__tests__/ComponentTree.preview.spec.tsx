import { describe, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NavigationProvider } from "../../navigation";
import { ComponentTree } from "../ComponentTree";
import type { ComponentTreeDto } from "../../../shared/messages";

// 願's tree, shaped as the host returns it — a visual bench for the recursive layout without a live DB.
const tree: ComponentTreeDto = {
  literal: "願",
  meaningPreview: "petition, request, vow",
  readingPreview: "ガン、ねが.う",
  children: [
    {
      literal: "原",
      meaningPreview: "meadow, original, primitive",
      readingPreview: "ゲン、はら",
      children: [
        {
          literal: "厂",
          meaningPreview: "cliff",
          readingPreview: "カン",
          children: []
        },
        {
          literal: "白",
          meaningPreview: "white",
          readingPreview: "ハク、しろ",
          children: [
            {
              literal: "日",
              meaningPreview: "day, sun",
              readingPreview: "ニチ、ひ",
              children: []
            }
          ]
        },
        {
          literal: "小",
          meaningPreview: "little, small",
          readingPreview: "ショウ、ちい",
          children: []
        }
      ]
    },
    {
      literal: "頁",
      meaningPreview: "page, leaf",
      readingPreview: "ケツ、ページ",
      children: [
        {
          literal: "貝",
          meaningPreview: "shellfish",
          readingPreview: "バイ、かい",
          children: [
            {
              literal: "目",
              meaningPreview: "eye, class",
              readingPreview: "モク、め",
              children: []
            },
            {
              literal: "八",
              meaningPreview: "eight",
              readingPreview: "ハチ、や",
              children: []
            }
          ]
        }
      ]
    }
  ]
};

describe("component tree preview", () => {
  it("renders the recursive breakdown for visual review", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    client.setQueryData(["componentTree", "願"], tree);
    render(
      <div
        style={{
          background: "#1f1f1f",
          color: "#ccc",
          width: "340px",
          font: "13px system-ui",
          ["--jisho-fg" as string]: "#ccc",
          ["--jisho-muted" as string]: "#888",
          ["--jisho-border" as string]: "#3c3c3c",
          ["--jisho-radius" as string]: "3px",
          ["--jisho-hover-bg" as string]: "#2a2d2e",
          ["--jisho-gap" as string]: "12px"
        }}
      >
        <QueryClientProvider client={client}>
          {/* Navigation comes from context now; the preview only needs it to exist. */}
          <NavigationProvider send={() => {}} canGoHome={false}>
            <ComponentTree literal="願" onOpenKanji={() => {}} />
          </NavigationProvider>
        </QueryClientProvider>
      </div>
    );
    await page.screenshot({ path: "component-tree-preview.png" });
  });
});
