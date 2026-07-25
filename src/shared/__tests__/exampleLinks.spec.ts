import { describe, expect, it } from "vitest";
import { linkToken, parseExampleMarkup } from "../exampleLinks";

describe("example link markup", () => {
  it("builds a link token with the pos code and entry id", () => {
    // WHY: the build emits exactly this shape; the format is the contract between build and webview.
    expect(linkToken("{飲|の}みませんか", "verb", "1168720")).toBe(
      "[{飲|の}みませんか](v:1168720)"
    );
  });

  it("parses a sentence into ordered link and text parts", () => {
    // WHY: the webview renders these parts in order — a link becomes a tappable span (open by id),
    // a text run renders (with any ruby). Boundaries and order must be exact.
    const parts = parseExampleMarkup(
      "お[{茶|ちゃ}](n:1000710)を[{飲|の}みませんか](v:1168720)"
    );
    expect(parts).toEqual([
      { kind: "text", markup: "お" },
      { kind: "link", markup: "{茶|ちゃ}", pos: "noun", id: "1000710" },
      { kind: "text", markup: "を" },
      { kind: "link", markup: "{飲|の}みませんか", pos: "verb", id: "1168720" }
    ]);
  });

  it("round-trips a built token back through the parser", () => {
    // WHY: build → store → parse must recover the same word, id, and pos — the whole point.
    const markup = linkToken("{食|た}べる", "verb", "1358280");
    const [part] = parseExampleMarkup(markup);
    expect(part).toEqual({
      kind: "link",
      markup: "{食|た}べる",
      pos: "verb",
      id: "1358280"
    });
  });

  it("treats a plain sentence with no links as a single text part", () => {
    // WHY: a sentence where nothing resolved (or all-kana) is still valid markup — one text run.
    expect(parseExampleMarkup("そうですか。")).toEqual([
      { kind: "text", markup: "そうですか。" }
    ]);
  });
});
