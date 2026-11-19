import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { RegionalGroupDto } from "../../../shared/messages";
import { renderWithNavigation } from "../../__tests__/navigationHarness";
import type { NavEvent } from "../../machines/navigation";
import { RegionalForms } from "../RegionalForms";

// As the built database returns them (db.spec.ts checks 学 against the real data).
const GROUPS: Record<string, RegionalGroupDto[]> = {
  学: [
    {
      key: "學",
      chars: ["学", "學", "學", "学"],
      old: "學",
      glyphSig: "01101",
      cpSig: "0110",
      strokes: [8, 16, 16, 8, 16],
      tiers: [1, 1, 1, 2],
      readings: ["xué", "hok6", "xué", "ガク、まな.ぶ"],
      ranks: [66, 84, 93, 5],
      notes: [
        {
          char: "學",
          section: "Chinese",
          blocks: [
            {
              kind: "paragraph",
              text: "Possibly a phono-semantic compound:",
              indent: false
            },
            {
              kind: "list",
              ordered: false,
              items: [
                { text: "phonetic 爻", items: [] },
                {
                  text: "phonetic 六",
                  items: [{ text: "corrupted to 冖", items: [] }]
                }
              ]
            },
            {
              kind: "paragraph",
              text: "Endopassive derivation of 覺 (OC *kruːɡ, “to become aware”).",
              indent: false
            }
          ]
        },
        {
          char: "学",
          section: "Translingual",
          blocks: [
            {
              kind: "paragraph",
              text: "Simplified from 學 (𦥯 → 𰃮) in simplified Chinese and Japanese shinjitai.",
              indent: false
            }
          ]
        },
        {
          char: "学",
          section: "Japanese",
          blocks: [
            { kind: "label", text: "がく" },
            {
              kind: "paragraph",
              text: "From Middle Chinese 學 (MC haewk, “learning”).",
              indent: false
            }
          ]
        }
      ],
      meanings: [
        {
          char: "學",
          senses: [
            { gloss: "to learn; to study", labels: [] },
            { gloss: "school", labels: [] }
          ]
        }
      ],
      japaneseMeanings: ["study", "learning", "science"],
      // As the host finds them: the characters the notes name that have a kanji page.
      kanjiLinks: ["學", "六", "覺"]
    }
  ],
  国: [
    {
      key: "國",
      chars: ["国", "國", "國", "国"],
      old: "國",
      glyphSig: "01101",
      cpSig: "0110",
      strokes: [8, 11, 11, 8, 11],
      tiers: [1, 1, 1, 2],
      readings: [null, null, null, null],
      ranks: [null, null, null, null],
      notes: [
        {
          char: "國",
          section: "Chinese",
          blocks: [
            {
              kind: "paragraph",
              text: "Phono-semantic compound: semantic 囗 (“closure”) + phonetic 或.",
              indent: false
            }
          ]
        },
        {
          char: "国",
          section: "Japanese",
          blocks: [
            { kind: "label", text: "くに" },
            { kind: "paragraph", text: "From Old Japanese.", indent: false }
          ]
        },
        {
          char: "国",
          section: "Chinese",
          blocks: [
            {
              kind: "paragraph",
              text: "Simplified from 國 (或 → 玉).",
              indent: false
            }
          ]
        }
      ],
      meanings: [],
      japaneseMeanings: [],
      kanjiLinks: []
    }
  ],
  湯: [
    {
      key: "湯",
      chars: ["汤", "湯", "湯", "湯"],
      glyphSig: "0111",
      cpSig: "0111",
      strokes: [6, 12, 12, 12],
      tiers: [1, 1, 1, 2],
      readings: [null, null, null, null],
      ranks: [null, null, null, null],
      notes: [],
      meanings: [
        {
          char: "湯",
          senses: [
            {
              gloss: "hot or boiling water",
              labels: ["literary", "regional"]
            },
            { gloss: "broth; stock", labels: [] }
          ]
        }
      ],
      japaneseMeanings: ["hot water", "bath", "hot spring"],
      kanjiLinks: []
    }
  ],
  園: [
    {
      key: "園",
      chars: ["园", "園", "園", "園"],
      glyphSig: "0112",
      cpSig: "0111",
      strokes: [7, 13, 13, 13],
      tiers: [1, 1, 1, 2],
      readings: [null, null, null, null],
      ranks: [null, null, null, null],
      notes: [],
      meanings: [],
      japaneseMeanings: [],
      kanjiLinks: []
    }
  ],
  返: [
    {
      key: "返",
      chars: ["返", "返", "返", "返"],
      glyphSig: "0123",
      cpSig: "0000",
      strokes: [7, 7, 8, 7],
      tiers: [1, 1, 1, 2],
      readings: [null, null, null, null],
      ranks: [null, null, null, null],
      notes: [],
      meanings: [],
      japaneseMeanings: [],
      kanjiLinks: []
    }
  ]
};

// The clipboard write goes through the host; the test is about WHAT the chart hands it.
const copied: string[] = [];
vi.mock("../../bridge", () => ({
  copyText: async (text: string) => {
    copied.push(text);
  }
}));

vi.mock("../../queries", () => ({
  regionalFormsQuery: (literal: string) => ({
    queryKey: ["regionalForms", literal],
    queryFn: () => GROUPS[literal] ?? []
  })
}));

/** Render the view, and return the navigation events it sends. */
const renderView = (literal: string): NavEvent[] => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrap = (ui: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  return renderWithNavigation(wrap(<RegionalForms literal={literal} />)).sent;
};

/** The section under Details that a language's heading opens. */
const languageSection = async (language: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole("heading", {
    name: language,
    level: 4
  });
  const section = heading.closest("section");
  if (section === null) throw new Error(`no section for ${language}`);
  return section;
};

/** The parts a language's entry has, by their headings. */
const partsOf = (section: HTMLElement): string[] =>
  within(section)
    .getAllByRole("heading", { level: 5 })
    .map((heading) => heading.textContent);

/** Stand in for the reader's motion preference. */
const prefersReducedMotion = (reduce: boolean): void => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes("reduce"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      }) as unknown as MediaQueryList
  );
};

describe("the Regional forms view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("describes the overprint in words: each form and who writes it", async () => {
    // WHY: the overprint tells forms apart by ink alone; a reader who cannot see the inks, or
    // cannot tell the hues apart, needs the same information as text.
    renderView("学");
    await expect(
      screen.findByRole("img", {
        name: "Overlaid: 学 (China and Japan), 學 (Hong Kong, Taiwan and Japan's old form)"
      })
    ).resolves.toBeVisible();
  });

  it("labels every form with its regions when set side by side", async () => {
    // WHY: Separate is how a reader checks which shape belongs to whom without relying on colour.
    prefersReducedMotion(false);
    renderView("学");
    await userEvent.click(
      await screen.findByRole("radio", { name: "Separate" })
    );
    const forms = await screen.findByRole("img", { name: /^Side by side/u });
    expect(forms.textContent).toContain(
      "學Hong Kong, Taiwan and Japan's old form"
    );
  });

  it("switches modes without animating when the reader asks for less motion", async () => {
    // WHY: the layers sliding into place is motion; with reduced motion the switch is a plain one.
    prefersReducedMotion(true);
    const transition = vi.spyOn(document, "startViewTransition");
    renderView("学");
    await userEvent.click(
      await screen.findByRole("radio", { name: "Separate" })
    );
    expect(transition).not.toHaveBeenCalled();
    await expect(
      screen.findByRole("img", { name: /^Side by side/u })
    ).resolves.toBeVisible();
  });

  it("says when every form is one code point drawn differently", async () => {
    // WHY: 返 is one code point in all four regions; without saying so, the chart's four identical
    // code points would tell the reader the regions write it alike. Once for the group, not per row.
    renderView("返");
    await expect(
      screen.findByText("4 forms of one code point, U+8FD4")
    ).resolves.toBeVisible();
    expect(
      screen.queryByText(
        "Same code point as another form here, drawn differently"
      )
    ).toBeNull();
    // Taiwan's official count, not Unihan's.
    expect(screen.getByText("U+8FD4 · 8 strokes")).toBeVisible();
  });

  it("marks only the forms that share a code point when the others differ", async () => {
    // WHY: Hong Kong, Taiwan and Japan all write U+5712, Japan drawing it its own way, while China
    // writes 园: the note must sit on the two rows it is true of, not on China's.
    renderView("園");
    await expect(
      screen.findAllByText(
        "Same code point as another form here, drawn differently"
      )
    ).resolves.toHaveLength(2);
    expect(screen.getByText("3 forms")).toBeVisible();
  });

  it("copies a form when it is clicked, as the kanji page copies its character", async () => {
    // WHY: a reader who finds Taiwan's form usually wants it in the document beside the sidebar.
    // The chart is where they see it, so it must hand over the character itself, not leave them
    // to retype it from the code point next to it.
    renderView("学");
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Copy 學 (Hong Kong, Taiwan and Japan's old form)"
      })
    );
    expect(copied).toEqual(["學"]);
    await expect(screen.findByText("Copied")).resolves.toBeVisible();
  });

  it("gives each region's reading and its rank in that region's corpus, under its language", async () => {
    // WHY: phase 5's point: Mandarin and Cantonese beside Japan's readings, and four ranks that
    // each name their corpus, since #66 in China and #5 in Japan count different texts. Japan's
    // line is the Japanese entry's; the three others are the Chinese entry's.
    renderView("学");
    const japanese = await languageSection("Japanese");
    const chinese = await languageSection("Chinese");
    expect(japanese.textContent).toContain(
      "ガク、まな.ぶ (Japanese)#5 on Japanese Wikipedia"
    );
    expect(chinese.textContent).toContain(
      "China 学xué (Mandarin)#66 in modern Chinese texts"
    );
    expect(chinese.textContent).toContain(
      "Hong Kong 學hok6 (Cantonese)#84 in Cantonese texts (words.hk)"
    );
    expect(chinese.textContent).toContain(
      "#93 in news and social media (2023)"
    );
    expect(japanese.textContent).not.toContain("Mandarin");
  });

  it("raises the Cantonese tone digit and says what it is", async () => {
    // WHY (reported): "hok6" reads as a word with a number in it to anyone who has not met Jyutping.
    // Raised, as Wiktionary sets it, and explained by the "Cantonese" label beside it.
    renderView("学");
    const tone = await screen.findByText("6", { selector: "sup" });
    expect(tone.parentElement).toHaveTextContent("hok6");
    // Tooltips open on KEYBOARD focus, and earlier tests' clicks left the modality on the pointer.
    // Not Shift: React Aria ignores modifier keys when it decides the modality.
    await userEvent.keyboard("{Escape}");
    screen.getByRole("button", { name: "Cantonese" }).focus();
    await expect(screen.findByRole("tooltip")).resolves.toMatchTextContent(
      /small number after each syllable is its tone/u
    );
  });

  it("quotes Wiktionary with a link to each page and the licence credit", async () => {
    // WHY: phase 6's point is that 学 says it was simplified from 學; and Wiktionary's licence
    // (CC BY-SA 4.0) lets the text be shown only with a credit and a link to where it came from.
    renderView("学");
    // 學 is a link inside the sentence, so the sentence is found by its start and read whole.
    const quote = (await screen.findByText(/^Simplified from/u)).closest(
      "blockquote"
    );
    expect(quote).toMatchTextContent(
      /^Simplified from 學 \(𦥯 → 𰃮\) in simplified Chinese and Japanese shinjitai\./u
    );
    expect(quote).toHaveAttribute(
      "cite",
      "https://en.wiktionary.org/wiki/%E5%AD%A6#Translingual"
    );
    expect(
      screen.getByRole("link", { name: "Translingual section on Wiktionary" })
    ).toHaveAttribute(
      "href",
      "https://en.wiktionary.org/wiki/%E5%AD%A6#Translingual"
    );
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/4.0/"
    );
  });

  it("gives Details by language: across languages, then Japanese, then Chinese, each in parts", async () => {
    // WHY (asked for): pronunciation, meaning and etymology together for each language the view
    // covers, Japanese first. By language, not region: Hong Kong and Taiwan both write 學, and its
    // etymology and meanings would otherwise appear twice.
    renderView("学");
    await screen.findByRole("heading", { name: "Details" });
    expect(
      screen
        .getAllByRole("heading", { level: 4 })
        .map((heading) => heading.textContent)
    ).toEqual(["Across languages", "Japanese", "Chinese"]);
    const japanese = await languageSection("Japanese");
    expect(partsOf(japanese)).toEqual([
      "Pronunciation and frequency",
      "Meaning",
      "Etymology"
    ]);
    // Japan's meaning is the dictionary's own, to set beside the Chinese one.
    expect(japanese).toMatchTextContent(/Meaningstudy, learning, science/u);
    const etymology = within(japanese).getByText(/^From Middle Chinese/u);
    expect(etymology.closest("blockquote")).toMatchTextContent(
      /^がくFrom Middle Chinese 學/u
    );
    expect(
      within(japanese).getByRole("link", {
        name: "Japanese section on Wiktionary"
      })
    ).toHaveAttribute(
      "href",
      "https://en.wiktionary.org/wiki/%E5%AD%A6#Japanese"
    );
  });

  it("puts every Chinese note under the one Chinese entry, and leaves out a part with nothing", async () => {
    // WHY: 国's Chinese section and 國's are both Chinese, so one etymology part holds both, Japan's
    // 国 first as in the chart; and Wiktionary gives 国's group no meanings here, so the entry has
    // no Meaning heading over nothing.
    renderView("国");
    const chinese = await languageSection("Chinese");
    expect(partsOf(chinese)).toEqual([
      "Pronunciation and frequency",
      "Etymology"
    ]);
    const notes = [...chinese.querySelectorAll("blockquote")];
    expect(notes.map((note) => note.textContent)).toEqual([
      expect.stringMatching(/^Simplified from 國/u),
      expect.stringMatching(/^Phono-semantic compound/u)
    ]);
  });

  it("sets out the page's lists as lists, and shows the whole note", async () => {
    // WHY (reported): the notes showed the page's wiki markup ("# Inverted triangle…", ";dynasty's
    // name") as text; and a fold showed one line and hid the rest, or hid a single line, so the
    // whole note shows.
    renderView("学");
    const parts = (await screen.findByText("phonetic 爻")).closest("ul");
    if (parts === null) throw new Error("the parts are not a list");
    // Each item's own text, without the list nested in it (六 is a link inside its item's text).
    const ownText = (item: HTMLElement): string =>
      [...item.childNodes]
        .filter((node) => node.nodeName !== "UL" && node.nodeName !== "OL")
        .map((node) => node.textContent)
        .join("");
    expect(within(parts).getAllByRole("listitem").map(ownText)).toEqual([
      "phonetic 爻",
      "phonetic 六",
      "corrupted to 冖"
    ]);
    expect(screen.getByText(/^Endopassive derivation of/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: /More from/u })).toBeNull();
  });

  it("links a quoted character to its kanji page, and only one that has a page", async () => {
    // WHY (asked for): 学's note names 學, and 學 is a page one tap away. The host sends the
    // characters the dictionary has; 𦥯 is not among them, so it stays text rather than a link
    // to nothing.
    const sent = renderView("学");
    const note = (await screen.findByText(/^Simplified from/u)).closest(
      "blockquote"
    );
    if (!(note instanceof HTMLElement)) throw new Error("no note");
    expect(
      within(note)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["學", "Translingual section on Wiktionary"]);
    await userEvent.click(within(note).getByRole("link", { name: "學" }));
    expect(sent).toContainEqual({ type: "openKanji", literal: "學" });
  });

  it("gives the character's meanings in Chinese, with their register, beside Japan's", async () => {
    // WHY: where a meaning drifts is a regional difference too: 湯 is "broth; soup" in Chinese,
    // and its literary sense, "hot or boiling water", is the one Japanese kept.
    renderView("湯");
    const chinese = await languageSection("Chinese");
    expect(
      [...chinese.querySelectorAll("ol li")].map((item) => item.textContent)
    ).toEqual(["hot or boiling water · literary, regional", "broth; stock"]);
    expect(
      within(chinese).getByRole("link", {
        name: "Chinese section on Wiktionary"
      })
    ).toHaveAttribute(
      "href",
      "https://en.wiktionary.org/wiki/%E6%B9%AF#Chinese"
    );
    await expect(languageSection("Japanese")).resolves.toMatchTextContent(
      /Meaninghot water, bath, hot spring/u
    );
    // Quoted from Wiktionary with no notes beside it: the credit still applies.
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toBeVisible();
  });

  it("leaves out what Wiktionary does not give, and its credit", async () => {
    // WHY: a heading with nothing under it says nothing, and a licence credit under no quoted text
    // credits nothing.
    renderView("返");
    await screen.findByText("4 forms of one code point, U+8FD4");
    expect(screen.queryByRole("heading", { name: "Etymology" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Meaning" })).toBeNull();
    expect(screen.queryByText("Across languages")).toBeNull();
    expect(screen.queryByRole("link", { name: "CC BY-SA 4.0" })).toBeNull();
  });

  it("pulls the layers apart while dragged, and lets them go on release", async () => {
    // WHY: dragging is how a reader separates the forms by hand; the layers must follow the
    // pointer, and come back into register, or the stack stays split and unreadable.
    renderView("学");
    const stack = (await screen.findByRole("img")).closest("figure");
    if (!stack) throw new Error("no overprint");
    fireEvent.pointerDown(stack, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(stack, { clientX: 112, pointerId: 1 });
    expect(stack.style.getPropertyValue("--overprint-pull")).toBe("12px");
    expect(stack).toHaveAttribute("data-dragging");
    fireEvent.pointerUp(stack, { pointerId: 1 });
    expect(stack.style.getPropertyValue("--overprint-pull")).toBe("0px");
    expect(stack).not.toHaveAttribute("data-dragging");
  });
});
