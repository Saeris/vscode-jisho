import { describe, expect, it } from "vitest";
import {
  exampleText,
  linkToken,
  parseExampleMarkup,
  posToken
} from "../exampleLinks";

describe("example link markup", () => {
  it("builds a link token with the pos code and entry id", () => {
    // WHY: the build emits exactly this shape; the format is the contract between build and webview.
    expect(linkToken("{飲|の}みませんか", "verb", "1168720")).toBe(
      "[{飲|の}みませんか](v:1168720)"
    );
  });

  it("builds a typed-but-unlinked token with an empty id", () => {
    // WHY (#38): colouring and linking are different questions. A particle has a part of speech
    // worth showing but no entry worth opening, so it needs a token that carries the one without
    // implying the other.
    expect(posToken("を", "particle")).toBe("[を](p:)");
  });

  it("parses a sentence into ordered link, span and text parts", () => {
    // WHY: the webview renders these in order — a link is tappable (open by id), a span is coloured
    // but inert, a text run is neither. Boundaries, order and KIND must all be exact, since kind is
    // what decides whether the reader gets a tap target.
    const parts = parseExampleMarkup(
      "お[{茶|ちゃ}](n:1000710)[を](p:)[{飲|の}みませんか](v:1168720)。"
    );
    expect(parts).toEqual([
      { kind: "text", markup: "お" },
      { kind: "link", markup: "{茶|ちゃ}", pos: "noun", id: "1000710" },
      { kind: "span", markup: "を", pos: "particle" },
      { kind: "link", markup: "{飲|の}みませんか", pos: "verb", id: "1168720" },
      { kind: "text", markup: "。" }
    ]);
  });

  it("strips both token forms to plain text in one pass", () => {
    // WHY: `exampleText` feeds the editor hover, whose markdown VS Code sanitizes to a fixed subset
    // — it must emit NO markup at all. Adding a second token form is exactly when a stripper starts
    // half-working, which is how `[もっと](adv:1012620)` once reached the word page. One regex
    // covers both forms precisely so this cannot drift.
    expect(
      exampleText(
        "お[{茶|ちゃ}](n:1000710)[を](p:)[{飲|の}みませんか](v:1168720)"
      )
    ).toBe("お茶を飲みませんか");
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
