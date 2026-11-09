/**
 * Request handlers: the seam between the webview's message protocol and the query layer.
 *
 * Almost none of it needs the extension host — the dictionaries, and the names state it reports, are
 * passed in. Only `openSettings` and `copyText` touch the vscode API, and they live here because they
 * answer requests like the rest.
 *
 * Every handler has the type `Handlers` gives it (shared/messages.ts), so each answers only its own
 * request: an answer in another request's shape does not compile, and `answer` labels it with the
 * request's own `type` and `requestId`. The webview host assembles the full table.
 */
import * as vscode from "vscode";
import type { Dictionary } from "./db";
import { hasKanji } from "../shared/japanese";
import { CLASSIFIER_BY_ID, isKanjiListId } from "../shared/classifiers";
import { timed } from "./log";
import type { NamesDictionary } from "./names";
import type { Remote } from "./remote";
import { contentSegmentCount, segment } from "./tokenizer";
import type {
  Answer,
  Handlers,
  Request,
  RequestOf,
  RequestType,
  Response,
  ResponseOf,
  SegmentDto
} from "../shared/messages";

interface QueryAnalysis {
  /** Breakdown chips — only when a Japanese query has >1 content word. */
  segments: SegmentDto[];
  /** Content-word dictionary forms, fed to search as deinflection candidates. */
  lemmas: string[];
}

/**
 * Tokenize a Japanese query once, deriving both the breakdown segments and the content lemmas.
 * Only mixed-script (kanji-bearing) input tokenizes reliably — English/romaji and pure-kana
 * queries never load the tokenizer's dictionary and rely on rule-based deinflection instead. A
 * single conjugated word (食べました) yields one lemma (食べる) for the search merge but no breakdown.
 */
const analyzeQuery = async (query: string): Promise<QueryAnalysis> => {
  const trimmed = query.trim();
  if (trimmed.length < 2 || !hasKanji(trimmed)) {
    return { segments: [], lemmas: [] };
  }
  // The tokenizer's first call pays a WASM + IPADIC init (~200ms locally, but it is a 12MB
  // dictionary and cold disk can be far worse) — and `search` awaits it BEFORE querying, so any
  // stall here delays word results while the names query, which skips tokenizing, answers first.
  const all = await timed("tokenize query", async () => segment(trimmed));
  const lemmas = all
    .filter((s) => s.pos !== "particle" && s.pos !== "auxiliary")
    .map((s) => s.lemma)
    .filter((l) => l !== "" && l !== trimmed);
  const segments = contentSegmentCount(all) > 1 ? all : [];
  return { segments, lemmas };
};

/**
 * Answer a request with its handler, labelled with the request's own `type` and `requestId`.
 *
 * The label comes from the request, never from the handler: the webview matches an answer to its
 * request by both, and an answer that dropped or mislabelled either never settled its caller — the
 * panel just spun. A handler supplies only the fields, which `Handlers` checks against the protocol.
 */
export const answer = async (
  handlers: Handlers,
  request: Request
): Promise<Response> =>
  // The one assertion the table needs. `answerOne` is exact for each request type, but called with
  // the whole union TypeScript cannot carry the pairing of `type` and fields back out of it — the
  // same limit as the bridge's `request()`. The pairing holds because `answerOne` builds it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  (await answerOne(handlers, request)) as Response;

const answerOne = async <T extends RequestType>(
  handlers: Handlers,
  request: RequestOf<T>
): Promise<ResponseOf<T>> => {
  // Only a host older than its webview gets here: in development, after `vp build` without
  // `vp pack`. Say that, rather than "handler is not a function".
  if (!Object.hasOwn(handlers, request.type)) {
    throw new Error(
      `This build of the extension host cannot answer "${request.type}". Rebuild it with \`vp pack\`.`
    );
  }
  const handler: Handlers[T] = handlers[request.type];
  const fields = await handler(request);
  return { ...fields, type: request.type, requestId: request.requestId };
};

/** The sidebar's gear: open VS Code's Settings UI filtered to this extension's section. */
export const openSettings = async (): Promise<Answer<"openSettings">> => {
  await vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "@ext:saeris.vscode-jisho"
  );
  return {};
};

/** Copy-as: the host owns the clipboard, since the webview's needs user activation. */
export const copyText = async ({
  text
}: RequestOf<"copyText">): Promise<Answer<"copyText">> => {
  await vscode.env.clipboard.writeText(text);
  return {};
};

/** What the word handlers need from the host. Functions, so each request reads the current state. */
export interface WordSources {
  /** The word dictionary, through its lifecycle. */
  dict: () => Promise<Remote<Dictionary>>;
  /**
   * Whether the names dictionary is installed, and whether to offer it — see `browseCounts`.
   *
   * Passed in rather than checked here: this module has no extension context by design, and the
   * check must not provision — see `namesDatabaseExists`.
   */
  names: () => Promise<{ available: boolean; offered: boolean }>;
  /** `Classifier.id` → count, for the name types the word dictionary cannot count. */
  nameCounts: () => Promise<Record<string, number>>;
}

/** The requests the word/kanji dictionary answers. */
export type WordRequestType =
  | "search"
  | "getWord"
  | "getMoreExamples"
  | "kanjiList"
  | "browse"
  | "browseCounts"
  | "getKanji"
  | "getComponentTree"
  | "lookupRadicals"
  | "getKanjiPreviews"
  | "getAbout";

/** Handlers for every request the word/kanji dictionary answers. */
export const wordHandlers = (
  sources: WordSources
): Pick<Handlers, WordRequestType> => ({
  search: async ({ query }) => {
    const dict = await sources.dict();
    // Tokenize once (Japanese only): segments feed the breakdown bar, lemmas feed search's
    // deinflection merge — the tokenizer is more accurate than the rule-based fallback.
    const analysis = await analyzeQuery(query);
    const [results, kanji] = await Promise.all([
      dict.search(query, 50, analysis.lemmas),
      dict.searchKanji(query)
    ]);
    return { results, kanji, segments: analysis.segments };
  },
  getWord: async ({ id }) => ({
    word: await (await sources.dict()).getWord(id)
  }),
  getMoreExamples: async ({ id }) => ({
    examples: await (await sources.dict()).getMoreExamples(id)
  }),
  kanjiList: async ({ id }) => {
    const dict = await sources.dict();
    // Same contract as `browse` below: an unknown id answers empty rather than throwing across the
    // bridge. `KANJI_LIST_FILTERS` is the allowlist, so only ids defined there reach SQL.
    return { kanji: isKanjiListId(id) ? await dict.browseKanjiList(id) : [] };
  },
  browse: async ({ id, order }) => {
    const dict = await sources.dict();
    // An unknown id is a bad request, not a missing category — but it must not throw across the
    // bridge, so it answers with the same empty shape a genuinely empty category gives.
    const classifier = CLASSIFIER_BY_ID.get(id);
    if (classifier === undefined) {
      return { results: [], kanji: [], names: [], total: 0 };
    }
    return {
      results: await dict.browse(classifier, order),
      // Only `#kanji` fills this; every other classifier returns an empty array, so the view can
      // branch on which one is populated rather than on the classifier's kind.
      kanji: await dict.browseKanji(classifier),
      // Name types are answered by the names dictionary in webviewHost, so they never reach here.
      names: [],
      total: await dict.browseCount(classifier)
    };
  },
  browseCounts: async (request) => {
    const dict = await sources.dict();
    // ONE pass for every category rather than a round trip each: the tree shows ~90 counts at
    // once, and the tag autocomplete needs all of them to hide the combinations that would narrow
    // to zero. `applied` makes them REFINING counts — how many would remain.
    const applied = (request.applied ?? []).flatMap((id) => {
      const c = CLASSIFIER_BY_ID.get(id);
      return c === undefined ? [] : [c];
    });
    const counts = await dict.refineCounts(applied);
    // Name types are counted by the NAMES dictionary, which this one is not — `refineCounts`
    // reports 0 for them, and the autocomplete hides anything that would narrow to zero, so leaving
    // it would hide two tags that work. Absent (names not installed) the zeros stand and the tags
    // stay hidden, which is the right answer then.
    for (const [id, n] of Object.entries(await sources.nameCounts())) {
      // Still zero when a word filter is applied: a name is not a word, so the combination is as
      // dead as `#kanji #verb-godan`.
      if (counts[id] === 0 && applied.length === 0) counts[id] = n;
    }
    // Checked per request rather than cached: the names DB can arrive mid-session (when the user
    // installs it), and a cached `false` would keep the `#name`/`#place` tags hidden until reload.
    const names = await sources.names();
    return {
      counts,
      namesAvailable: names.available,
      namesOffered: names.offered
    };
  },
  getKanji: async ({ literal }) => ({
    kanji: await (await sources.dict()).getKanji(literal)
  }),
  getComponentTree: async ({ literal }) => ({
    tree: await (await sources.dict()).getComponentTree(literal)
  }),
  lookupRadicals: async ({ selected }) => ({
    result: await (await sources.dict()).lookupRadicals(selected)
  }),
  getKanjiPreviews: async ({ literals }) => ({
    results: await (await sources.dict()).getKanjiPreviews(literals)
  }),
  getAbout: async () => ({ meta: await (await sources.dict()).getMeta() })
});

/**
 * Handlers for the names dictionary's two requests.
 *
 * `installed` never downloads: names are opt-in, and a search that reaches here before they are
 * installed answers as if nothing matched.
 */
export const namesHandlers = (
  installed: () => Promise<Remote<NamesDictionary> | undefined>
): Pick<Handlers, "searchNames" | "getName"> => ({
  searchNames: async ({ query }) => {
    const names = await installed();
    return { names: names ? await names.searchNames(query) : [] };
  },
  getName: async ({ id }) => {
    const names = await installed();
    return { name: names ? await names.getName(id) : null };
  }
});
