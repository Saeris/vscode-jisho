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
export type Classifier =
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
export const matchClassifiers = (query: string, limit = 20): Classifier[] => {
  const needle = query.replace(/^#/u, "").toLowerCase();
  if (needle === "") return [...CLASSIFIER_BY_ID.values()].slice(0, limit);
  const out: Classifier[] = [];
  for (const c of CLASSIFIER_BY_ID.values()) {
    if (c.id.includes(needle) || c.label.toLowerCase().includes(needle)) {
      out.push(c);
      if (out.length === limit) break;
    }
  }
  return out;
};
