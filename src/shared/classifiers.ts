/**
 * The browsable classifier taxonomy — the single vocabulary behind BOTH ways into a word list.
 *
 * Browsing a category tree (#54) and typing `#jlpt-n5` (#27) are the same data reached two ways, so
 * the tag ids, their labels, and the query each maps to live here rather than in either surface.
 * The host resolves an id to rows; the webview renders the tree and the token autocomplete from the
 * same table. A category that exists in one and not the other is then impossible by construction.
 *
 * WHAT IS AND ISN'T DERIVABLE (measured against the shipped dictionary, 2026-08-02). Every category
 * below maps onto data we already store — no additional source is needed:
 *
 *   pos      52 codes   22,624 words   `sense_tags.kind='pos'`
 *   misc     31 codes    3,235 words   `sense_tags.kind='misc'`
 *   field    81 codes    1,984 words   `sense_tags.kind='field'`
 *   dialect   9 codes       39 words   `sense_tags.kind='dialect'`   ← see the caveat below
 *   jlpt      5 levels   7,208 words   `words.jlpt`
 *   freq      bands     15,147 words   `words.freq_rank`
 *
 * DIALECT COUNTS ARE MISLEADING IN A `common` BUILD. The dev database is built `variant: common`,
 * and dialect words are mostly NOT common — Kansai-ben shows 26 words locally against the hundreds
 * a full build holds. The tags are present and correct; the entries carrying them are filtered out
 * upstream. Size that vertical against a `--full` build, never against the dev DB.
 */

/** Fields every classifier carries, whatever it filters on. */
interface ClassifierBase {
  /**
   * The stable id, and the `#tag` a user can type. Kebab-case, no `#` — the prefix is syntax, not
   * part of the name, so `#jlpt-n5` and a browse tap resolve to the identical id.
   */
  id: string;
  /** What the browse tree and the token chip show. */
  label: string;
}

/**
 * One browsable/searchable category.
 *
 * A DISCRIMINATED UNION rather than one interface with optional fields: each kind needs entirely
 * different query parameters, and optional fields would let `{ kind: "jlpt" }` with no `level`
 * type-check — the query would then silently bind `undefined` and match nothing. Narrowing on
 * `kind` makes the parameters non-optional exactly where they are used.
 */
/**
 * Which KIND of result a classifier selects.
 *
 * Distinct from the filters below, which all narrow a set of words. A learner may be looking for a
 * kanji with a given meaning rather than a word containing it, and until now the only way to
 * express that was to read past the word results. `#kanji`, `#name` and `#place` say "I want this
 * type of thing" — so they compose with word filters only where the combination is meaningful, and
 * the refine counts make the dead ones disappear on their own.
 */
export type ResultKind = "word" | "kanji" | "name" | "place";

export type Classifier =
  /** Selects a result TYPE rather than narrowing words — see `ResultKind`. */
  | (ClassifierBase & { kind: "result"; result: ResultKind })
  /** A `sense_tags` row: pos / misc / field / dialect all share one shape. */
  | (ClassifierBase & {
      kind: "tag";
      /** `sense_tags.kind` — the column is indexed as `(code, kind)`. */
      tagKind: "pos" | "misc" | "field" | "dialect";
      code: string;
      /**
       * Match `code` as a PREFIX rather than exactly — for the regular verb families, which JMdict
       * stores one code per ending (`v5r`, `v5k`, `v5s`… 13 of them) with no umbrella code. A bare
       * `v5` matches zero rows, so "Godan verbs" would silently render an empty list without this.
       * Still index-friendly: a prefix is a range scan over `idx_sense_tags_code`.
       */
      prefix: boolean;
    })
  /** `words.jlpt`, an integer level. */
  | (ClassifierBase & { kind: "jlpt"; level: number })
  /** A `words.freq_rank` band, e.g. the 2,000 most frequent. Bounds are inclusive. */
  | (ClassifierBase & { kind: "freq"; from: number; to: number });

/** Which axis a classifier filters on. */
export type ClassifierKind = Classifier["kind"];

/**
 * The top-level groups, in the order the browse tree shows them.
 *
 * Ordered by what a learner reaches for most: JLPT and frequency are the two lists people actually
 * study from, so they lead. Grammar is the deepest tree but is reference material rather than a
 * study list. Dialect is last because it is the smallest and the most specialised.
 */
export const CLASSIFIER_GROUPS = [
  { id: "type", label: "Result type" },
  { id: "jlpt", label: "JLPT level" },
  { id: "frequency", label: "Common words" },
  { id: "grammar", label: "Language parts" },
  { id: "usage", label: "Usage" },
  { id: "field", label: "Subject" },
  { id: "dialect", label: "Slang and dialect" }
] as const;

export type ClassifierGroupId = (typeof CLASSIFIER_GROUPS)[number]["id"];

/**
 * JLPT levels, hardest-first — the order every JLPT resource uses, and the order a learner thinks
 * in (you sit N5 first, but you read the list as a ladder).
 *
 * The data is an unofficial community estimate (Waller/tanos, via stephenmk/yomitan-jlpt-vocab);
 * official vocabulary lists have not been published since 2010, which is why the UI says so.
 */
/**
 * Result-type filters.
 *
 * `#name` and `#place` read the NAMES dictionary, a separate ~400MB opt-in download. They are
 * hidden entirely when it is not provisioned — see `namesAvailable` in the browse-counts response —
 * because a suggestion that cannot return anything is worse than one that is absent.
 */
const RESULT_TYPES: Classifier[] = [
  { id: "kanji", label: "Kanji", kind: "result", result: "kanji" },
  { id: "word", label: "Words", kind: "result", result: "word" },
  { id: "name", label: "Names", kind: "result", result: "name" },
  { id: "place", label: "Places", kind: "result", result: "place" }
];

const JLPT: Classifier[] = [5, 4, 3, 2, 1].map((level) => ({
  id: `jlpt-n${String(level)}`,
  label: `N${String(level)}`,
  kind: "jlpt" as const,
  level
}));

/**
 * Frequency bands of 2,000, over JMdict's own nfXX ranking.
 *
 * Bands rather than one 15,000-row list because "the 2,000 most common words" is a goal someone can
 * actually finish, and an undifferentiated ranked list is not.
 */
const FREQUENCY: Classifier[] = Array.from({ length: 8 }, (_, i) => {
  const from = i * 2000 + 1;
  const to = (i + 1) * 2000;
  return {
    id: `freq-${String(from)}-${String(to)}`,
    label: `${from.toLocaleString()} – ${to.toLocaleString()}`,
    kind: "freq" as const,
    from,
    to
  };
});

/** A `sense_tags`-backed classifier. */
const tag = (
  id: string,
  label: string,
  tagKind: "pos" | "misc" | "field" | "dialect",
  code: string,
  prefix = false
): Classifier => ({ id, label, kind: "tag", tagKind, code, prefix });

/**
 * Grammar categories, grouped the way a grammar reference is: the class first, its subclasses under
 * it. Only the codes worth BROWSING are listed — JMdict has 52 POS codes, but a list of every
 * `v2g-s` classical nidan variant is reference trivia, not a study list. The full set stays
 * reachable through `#`-search, which accepts any code.
 */
const GRAMMAR: Classifier[] = [
  // The three regular families match by PREFIX — JMdict has no umbrella code for them, only one
  // code per ending (v5r, v5k, v5s…). Verified against the shipped data: v5* covers 13 codes.
  tag("verb-godan", "Godan verbs", "pos", "v5", true),
  tag("verb-ichidan", "Ichidan verbs", "pos", "v1", true),
  tag("verb-suru", "Suru verbs", "pos", "vs", true),
  tag("verb-kuru", "Kuru verbs", "pos", "vk"),
  tag("verb-transitive", "Transitive verbs", "pos", "vt"),
  tag("verb-intransitive", "Intransitive verbs", "pos", "vi"),
  tag("adj-i", "い adjectives", "pos", "adj-i"),
  tag("adj-na", "な adjectives", "pos", "adj-na"),
  tag("adj-no", "の adjectives", "pos", "adj-no"),
  tag("adj-pn", "Pre-noun adjectivals", "pos", "adj-pn"),
  tag("noun", "Nouns", "pos", "n"),
  tag("pronoun", "Pronouns", "pos", "pn"),
  tag("adverb", "Adverbs", "pos", "adv"),
  tag("particle", "Particles", "pos", "prt"),
  tag("conjunction", "Conjunctions", "pos", "conj"),
  tag("interjection", "Interjections", "pos", "int"),
  tag("counter", "Counters", "pos", "ctr"),
  tag("prefix", "Prefixes", "pos", "pref"),
  tag("suffix", "Suffixes", "pos", "suf"),
  tag("expression", "Expressions", "pos", "exp")
];

/** Usage and register — how a word is used rather than what it is. */
const USAGE: Classifier[] = [
  tag("kana", "Usually kana", "misc", "uk"),
  tag("abbreviation", "Abbreviations", "misc", "abbr"),
  tag("colloquial", "Colloquialisms", "misc", "col"),
  tag("slang", "Slang", "misc", "sl"),
  tag("honorific", "Honorific (sonkeigo)", "misc", "hon"),
  tag("humble", "Humble (kenjougo)", "misc", "hum"),
  tag("polite", "Polite (teineigo)", "misc", "pol"),
  tag("children", "Children's language", "misc", "chn"),
  tag("familiar", "Familiar language", "misc", "fam"),
  tag("male", "Male term or language", "misc", "male"),
  tag("female", "Female term or language", "misc", "fem"),
  tag("onomatopoeia", "Onomatopoeic or mimetic", "misc", "on-mim"),
  tag("yojijukugo", "Yojijukugo (four-character)", "misc", "yoji"),
  tag("proverb", "Proverbs", "misc", "proverb"),
  tag("idiom", "Idiomatic expressions", "misc", "id"),
  tag("archaic", "Archaisms", "misc", "arch"),
  tag("obsolete", "Obsolete terms", "misc", "obs"),
  tag("dated", "Dated terms", "misc", "dated"),
  tag("vulgar", "Vulgar expressions", "misc", "vulg"),
  tag("derogatory", "Derogatory", "misc", "derog")
];

/**
 * Subject fields. JMdict ships 81 of these — more than a browse tree should show — so this is a
 * curated selection of the ones with enough entries to be worth opening. `#`-search still reaches
 * every code, which is the escape hatch that makes curating here safe.
 */
const FIELD: Classifier[] = [
  tag("computing", "Computing", "field", "comp"),
  tag("medicine", "Medicine", "field", "med"),
  tag("biology", "Biology", "field", "biol"),
  tag("botany", "Botany", "field", "bot"),
  tag("zoology", "Zoology", "field", "zool"),
  tag("chemistry", "Chemistry", "field", "chem"),
  tag("physics", "Physics", "field", "physics"),
  tag("mathematics", "Mathematics", "field", "math"),
  tag("astronomy", "Astronomy", "field", "astron"),
  tag("geology", "Geology", "field", "geol"),
  tag("anatomy", "Anatomy", "field", "anat"),
  tag("law", "Law", "field", "law"),
  tag("finance", "Finance", "field", "finc"),
  tag("business", "Business", "field", "bus"),
  tag("economics", "Economics", "field", "econ"),
  tag("military", "Military", "field", "mil"),
  tag("music", "Music", "field", "music"),
  tag("food", "Food and cooking", "field", "food"),
  tag("sports", "Sports", "field", "sports"),
  tag("baseball", "Baseball", "field", "baseb"),
  tag("sumo", "Sumo", "field", "sumo"),
  tag("martial-arts", "Martial arts", "field", "MA"),
  tag("mahjong", "Mahjong", "field", "mahj"),
  tag("shogi", "Shogi", "field", "shogi"),
  tag("buddhism", "Buddhism", "field", "Buddh"),
  tag("shinto", "Shinto", "field", "Shinto"),
  tag("linguistics", "Linguistics", "field", "ling"),
  tag("architecture", "Architecture", "field", "archit"),
  tag("engineering", "Engineering", "field", "engr")
];

/**
 * Regional dialects. Small in a `common` build (39 words across all nine codes) and much larger in
 * a full one — see the file header. Shown regardless: an empty list is a truthful answer about the
 * shipped data, and hiding the category would be a worse one.
 */
const DIALECT: Classifier[] = [
  tag("kansai", "Kansai-ben", "dialect", "ksb"),
  tag("kyoto", "Kyoto-ben", "dialect", "kyb"),
  tag("osaka", "Osaka-ben", "dialect", "osb"),
  tag("kantou", "Kantou-ben", "dialect", "ktb"),
  tag("touhoku", "Touhoku-ben", "dialect", "thb"),
  tag("kyuushuu", "Kyuushuu-ben", "dialect", "kyu"),
  tag("hokkaido", "Hokkaido-ben", "dialect", "hob"),
  tag("tsugaru", "Tsugaru-ben", "dialect", "tsug"),
  tag("ryuukyuu", "Ryuukyuu-ben", "dialect", "rkb"),
  tag("brazilian", "Brazilian", "dialect", "bra")
];

/** Every classifier, by group, in browse order. */
export const CLASSIFIERS: Record<ClassifierGroupId, Classifier[]> = {
  type: RESULT_TYPES,
  jlpt: JLPT,
  frequency: FREQUENCY,
  grammar: GRAMMAR,
  usage: USAGE,
  field: FIELD,
  dialect: DIALECT
};

/** Flat lookup by id — how a `#tag` query and a browse tap both resolve to a filter. */
export const CLASSIFIER_BY_ID = new Map<string, Classifier>(
  Object.values(CLASSIFIERS).flatMap((list) =>
    list.map((c) => [c.id, c] as const)
  )
);

/**
 * The classifier that browses a given JMdict tag, if one exists.
 *
 * Lets the grammar pills on a word page link into a filtered search — tapping "godan verb" on 食べる
 * asks "what else is a godan verb?", which is the question a reader has at that moment.
 *
 * Returns `undefined` for the many codes the browse tree deliberately does not surface: JMdict has
 * 52 POS codes and 81 field codes, and a list of every classical `v2g-s` variant is reference
 * trivia rather than a study list. Those pills stay unlinked rather than opening something the
 * tree itself would not offer.
 *
 * Prefix families are matched by prefix, so `v5r` finds "Godan verbs" — the same asymmetry the
 * query layer handles, since JMdict has no umbrella code for them.
 */
export const classifierForTag = (
  tagKind: "pos" | "misc" | "field" | "dialect",
  code: string
): Classifier | undefined => {
  for (const c of CLASSIFIER_BY_ID.values()) {
    if (c.kind !== "tag" || c.tagKind !== tagKind) continue;
    if (c.prefix ? code.startsWith(c.code) : c.code === code) return c;
  }
  return undefined;
};

/**
 * Resolve a user-typed tag to a classifier. Accepts a leading `#` and any case, since a token
 * arriving from the autocomplete and one typed by hand must mean the same thing.
 */
export const findClassifier = (raw: string): Classifier | undefined =>
  CLASSIFIER_BY_ID.get(raw.replace(/^#/u, "").toLowerCase());

/**
 * Classifiers whose label or id matches a typed prefix, for the token autocomplete.
 *
 * Matches on BOTH so `#n5` finds "N5" by label and `#jlpt` finds it by id — a learner reaching for
 * a JLPT level does not know which of the two we chose as canonical.
 */
export const matchClassifiers = (
  query: string,
  limit = 20,
  /** Ids already applied — never suggest a filter that is already in the box. */
  exclude: ReadonlySet<string> = new Set()
): Classifier[] => {
  const needle = query.replace(/^#/u, "").toLowerCase();
  const out: Classifier[] = [];
  for (const c of CLASSIFIER_BY_ID.values()) {
    if (exclude.has(c.id)) continue;
    if (
      needle === "" ||
      c.id.includes(needle) ||
      c.label.toLowerCase().includes(needle)
    ) {
      out.push(c);
      if (out.length === limit) break;
    }
  }
  return out;
};

// ── Kanji browse lists (#55) ───────────────────────────────────────────────────
//
// Kept beside the word classifiers for the same reason those are shared: the host resolves an id to
// rows and the webview renders the tree from it, so a list that exists in one and not the other is
// impossible by construction. They are a SEPARATE taxonomy rather than more `Classifier`s because
// they filter `kanji_characters` rather than words — feeding them to `#tag` search would offer the
// user a filter that can never match a word.

/** A kanji browse list's stable id. */
export type KanjiListId =
  | "kanji-jlpt-n5"
  | "kanji-jlpt-n4"
  | "kanji-jlpt-n3"
  | "kanji-jlpt-n2"
  | "kanji-jlpt-n1"
  | "kanji-grade-1"
  | "kanji-grade-2"
  | "kanji-grade-3"
  | "kanji-grade-4"
  | "kanji-grade-5"
  | "kanji-grade-6"
  | "kanji-joyo-secondary"
  | "kanji-jinmeiyo"
  | "kanji-frequent";

export interface KanjiList {
  id: KanjiListId;
  label: string;
}

export interface KanjiListGroup {
  id: "jlpt" | "grade" | "frequency";
  label: string;
  lists: readonly KanjiList[];
  /** Shown under the group's heading — the caveats a learner needs to read the counts correctly. */
  note?: string;
}

export const KANJI_LIST_GROUPS: readonly KanjiListGroup[] = [
  {
    id: "jlpt",
    label: "JLPT level",
    // Two things a user comparing us against another resource will otherwise read as our error.
    note: "Counts are per level, not cumulative — other sites often quote a running total. 172 jōyō kanji (分, 的, and most prefecture names) carry no level at all.",
    lists: [
      { id: "kanji-jlpt-n5", label: "N5" },
      { id: "kanji-jlpt-n4", label: "N4" },
      { id: "kanji-jlpt-n3", label: "N3" },
      { id: "kanji-jlpt-n2", label: "N2" },
      { id: "kanji-jlpt-n1", label: "N1" }
    ]
  },
  {
    id: "grade",
    label: "School grade",
    lists: [
      { id: "kanji-grade-1", label: "Grade 1" },
      { id: "kanji-grade-2", label: "Grade 2" },
      { id: "kanji-grade-3", label: "Grade 3" },
      { id: "kanji-grade-4", label: "Grade 4" },
      { id: "kanji-grade-5", label: "Grade 5" },
      { id: "kanji-grade-6", label: "Grade 6" },
      // Grade 8 is Kanjidic's code for "jōyō, taught in secondary school" — there is no grade 7.
      { id: "kanji-joyo-secondary", label: "Secondary (jōyō)" },
      // Grades 9 and 10 are the jinmeiyō set: legal for names, outside the jōyō list.
      { id: "kanji-jinmeiyo", label: "Jinmeiyō (names)" }
    ]
  },
  {
    id: "frequency",
    label: "Frequency",
    lists: [{ id: "kanji-frequent", label: "Most frequent" }]
  }
];

export const KANJI_LIST_BY_ID: ReadonlyMap<KanjiListId, KanjiList> = new Map(
  KANJI_LIST_GROUPS.flatMap((g) => g.lists).map((l) => [l.id, l])
);

/**
 * Each list's WHERE clause, as SQL plus its parameters.
 *
 * A fixed table rather than a caller-built predicate: the id arrives from the webview, and this way
 * it can only ever select a clause that was written here — an unknown id yields no query at all
 * rather than a fragment reaching the database.
 */
export const KANJI_LIST_FILTERS: Readonly<
  Record<KanjiListId, { sql: string; params: Array<string | number> }>
> = {
  "kanji-jlpt-n5": { sql: "jlpt_n = ?", params: [5] },
  "kanji-jlpt-n4": { sql: "jlpt_n = ?", params: [4] },
  "kanji-jlpt-n3": { sql: "jlpt_n = ?", params: [3] },
  "kanji-jlpt-n2": { sql: "jlpt_n = ?", params: [2] },
  "kanji-jlpt-n1": { sql: "jlpt_n = ?", params: [1] },
  "kanji-grade-1": { sql: "grade = ?", params: [1] },
  "kanji-grade-2": { sql: "grade = ?", params: [2] },
  "kanji-grade-3": { sql: "grade = ?", params: [3] },
  "kanji-grade-4": { sql: "grade = ?", params: [4] },
  "kanji-grade-5": { sql: "grade = ?", params: [5] },
  "kanji-grade-6": { sql: "grade = ?", params: [6] },
  "kanji-joyo-secondary": { sql: "grade = ?", params: [8] },
  "kanji-jinmeiyo": { sql: "grade IN (9, 10)", params: [] },
  "kanji-frequent": { sql: "frequency IS NOT NULL", params: [] }
};

/**
 * Narrow an arbitrary id to a `KanjiListId`.
 *
 * The id crosses the webview bridge as a plain string, so the host checks it against the filter
 * table rather than asserting — an unknown id then answers with an empty list instead of reaching
 * SQL or throwing across the bridge.
 */
export const isKanjiListId = (value: string): value is KanjiListId =>
  Object.hasOwn(KANJI_LIST_FILTERS, value);
