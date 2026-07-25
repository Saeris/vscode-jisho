/**
 * Typed Japanese deinflection: expand a conjugated query (はなします, 食べた, たかくない) into candidate
 * dictionary forms (はなす, 食べる, たかい), each TAGGED with the grammatical conditions it must satisfy
 * — so the caller can reject a candidate whose dictionary entry has an incompatible part of speech.
 *
 * The design follows Yomitan's transform model (studied, not copied): a rule rewrites a suffix and
 * carries `conditionsIn` (what the CURRENT form must already be) and `conditionsOut` (what the REWRITTEN
 * form now is). Intermediate conditions (`-ます`, `-て`, `-た`, `-ない`, `-ば`) let a multi-step chain
 * hold together (食べました → 食べます via -ます → 食べる via v1). The search starts from the surface
 * (no condition) and applies rules whose `conditionsIn` are met, chaining until it produces a form
 * whose conditions include a DICTIONARY-FORM condition (a real lookupable POS class).
 *
 * The old rule table over-generated with no POS constraint: して → [する, しる] and search then ranked
 * the noun 汁 / verb 知る above 為る. Tagging each candidate with its verb class (and validating that
 * against the entry's `senses.pos_json` in the caller) removes that noise. Genuine ambiguity — きます
 * legitimately comes from 来る (vk), 切る (v5r) AND 着る (v1), all real verbs — is preserved and left to
 * frequency; that word is ambiguous out of context.
 */

/**
 * Grammatical conditions a form can satisfy. Verb classes and adj-i are DICTIONARY-FORM (a lookupable
 * entry); the `-x` conditions are intermediate states in a deinflection chain. A form carries a SET of
 * conditions (れば could be v1/v5/vk/vs/vz), and a rule fires when the form's set overlaps `conditionsIn`.
 */
export type Condition =
  | "v1" // ichidan
  | "v5" // godan
  | "vk" // 来る
  | "vs" // する
  | "vz" // ずる
  | "adj-i" // い-adjective
  // Intermediate (not dictionary forms) — partially-deinflected states.
  | "-ます"
  | "-て"
  | "-た"
  | "-ない"
  | "-ば";

/** The dictionary-form conditions — reaching one of these means we have a real lookup candidate. */
const DICTIONARY_FORMS: ReadonlySet<Condition> = new Set([
  "v1",
  "v5",
  "vk",
  "vs",
  "vz",
  "adj-i"
]);

/** Every verb class — a form that could be any of these. */
const ANY_VERB: readonly Condition[] = ["v1", "v5", "vk", "vs", "vz"];

/**
 * One suffix-rewrite rule. `from`/`to` are the suffixes; a form ending in `from` and satisfying any of
 * `conditionsIn` (empty = "matches the initial surface", i.e. can start a chain) rewrites to `…to`,
 * and the result satisfies `conditionsOut`. `conditionsOut` MUST be non-empty (it names what the
 * rewritten form is).
 */
interface Rule {
  from: string;
  to: string;
  conditionsIn: readonly Condition[];
  conditionsOut: readonly Condition[];
}

const r = (
  from: string,
  to: string,
  conditionsIn: readonly Condition[],
  conditionsOut: readonly Condition[]
): Rule => ({ from, to, conditionsIn, conditionsOut });

// Rules ordered roughly outer-inflection-first. `conditionsIn: []` starts a chain from the raw surface;
// intermediate `conditionsOut` (`-ます` etc.) feed rules whose `conditionsIn` name that intermediate.
const RULES: readonly Rule[] = [
  // ── Polite: -ます and friends → the -ます intermediate, then -ます → the verb stem's dictionary form.
  r("ませんでした", "ます", [], ["-ます"]),
  r("ましょう", "ます", [], ["-ます"]),
  r("ました", "ます", [], ["-ます"]),
  r("ません", "ます", [], ["-ます"]),
  r("まして", "ます", [], ["-ます"]),
  // The polite stem → dictionary form, in ONE step from the -ます intermediate: 話し+ます (-ます) maps
  // the ren'yōkei ending directly to the verb (話し → 話す). Doing it in one rule (not stem→""→verb)
  // keeps a non-empty stem, so bare polite forms like します/きます still resolve (their stem after
  // stripping the ren'yōkei kana is empty otherwise).
  r("います", "う", [], ["v5"]),
  r("きます", "く", [], ["v5"]),
  r("きます", "くる", [], ["vk"]),
  r("ぎます", "ぐ", [], ["v5"]),
  r("します", "す", [], ["v5"]),
  r("します", "する", [], ["vs"]),
  r("ちます", "つ", [], ["v5"]),
  r("にます", "ぬ", [], ["v5"]),
  r("びます", "ぶ", [], ["v5"]),
  r("みます", "む", [], ["v5"]),
  r("ります", "る", [], ["v5"]),
  r("ます", "る", [], ["v1"]), // ichidan: 食べ+ます → 食べる (stem is non-empty here)
  // And the same from the -ます intermediate for the compound polite forms (ました → ます → verb).
  r("います", "う", ["-ます"], ["v5"]),
  r("きます", "く", ["-ます"], ["v5"]),
  r("きます", "くる", ["-ます"], ["vk"]),
  r("ぎます", "ぐ", ["-ます"], ["v5"]),
  r("します", "す", ["-ます"], ["v5"]),
  r("します", "する", ["-ます"], ["vs"]),
  r("ちます", "つ", ["-ます"], ["v5"]),
  r("にます", "ぬ", ["-ます"], ["v5"]),
  r("びます", "ぶ", ["-ます"], ["v5"]),
  r("みます", "む", ["-ます"], ["v5"]),
  r("ります", "る", ["-ます"], ["v5"]),
  r("ます", "る", ["-ます"], ["v1"]),

  // ── Progressive: 〜ている/〜てる → the -て intermediate.
  r("ています", "て", [], ["-て"]),
  r("でいます", "で", [], ["-て"]),
  r("ている", "て", [], ["-て"]),
  r("でいる", "で", [], ["-て"]),
  r("てる", "て", [], ["-て"]),
  r("でる", "で", [], ["-て"]),

  // ── Te-form → dictionary form. Both bare (surface) and via the -て intermediate.
  r("って", "う", [], ["v5"]),
  r("って", "つ", [], ["v5"]),
  r("って", "る", [], ["v5"]),
  r("いて", "く", [], ["v5"]),
  r("いで", "ぐ", [], ["v5"]),
  r("して", "す", [], ["v5"]),
  r("して", "する", [], ["vs"]),
  r("んで", "ぬ", [], ["v5"]),
  r("んで", "ぶ", [], ["v5"]),
  r("んで", "む", [], ["v5"]),
  r("きて", "くる", [], ["vk"]),
  r("て", "る", ["-て"], ["v1"]),
  r("で", "る", ["-て"], ["v1"]),
  r("て", "る", [], ["v1"]),

  // ── Plain past → dictionary form (mirrors te-form).
  r("った", "う", [], ["v5"]),
  r("った", "つ", [], ["v5"]),
  r("った", "る", [], ["v5"]),
  r("いた", "く", [], ["v5"]),
  r("いだ", "ぐ", [], ["v5"]),
  r("した", "す", [], ["v5"]),
  r("した", "する", [], ["vs"]),
  r("んだ", "ぬ", [], ["v5"]),
  r("んだ", "ぶ", [], ["v5"]),
  r("んだ", "む", [], ["v5"]),
  r("きた", "くる", [], ["vk"]),
  r("た", "る", [], ["v1"]),
  r("だ", "る", [], ["v1"]),

  // ── Negative → the -ない intermediate, then the godan a-row / ichidan drop.
  r("なかった", "ない", [], ["-ない"]),
  r("なくて", "ない", [], ["-ない"]),
  r("わない", "う", [], ["v5"]),
  r("かない", "く", [], ["v5"]),
  r("がない", "ぐ", [], ["v5"]),
  r("さない", "す", [], ["v5"]),
  r("たない", "つ", [], ["v5"]),
  r("なない", "ぬ", [], ["v5"]),
  r("ばない", "ぶ", [], ["v5"]),
  r("まない", "む", [], ["v5"]),
  r("らない", "る", [], ["v5"]),
  r("こない", "くる", [], ["vk"]),
  r("しない", "する", [], ["vs"]),
  r("ない", "る", ["-ない"], ["v1"]),
  r("ない", "る", [], ["v1"]),
  // adj-i negative: 〜くない → い.
  r("くない", "い", [], ["adj-i"]),
  r("くなかった", "い", [], ["adj-i"]),

  // ── Desiderative 〜たい (conjugates like an い-adjective, so its ending is the verb stem).
  r("いたい", "う", [], ["v5"]),
  r("きたい", "く", [], ["v5"]),
  r("ぎたい", "ぐ", [], ["v5"]),
  r("したい", "す", [], ["v5"]),
  r("したい", "する", [], ["vs"]),
  r("ちたい", "つ", [], ["v5"]),
  r("にたい", "ぬ", [], ["v5"]),
  r("びたい", "ぶ", [], ["v5"]),
  r("みたい", "む", [], ["v5"]),
  r("りたい", "る", [], ["v5"]),
  r("たい", "る", [], ["v1"]),

  // ── Passive / potential 〜れる/〜られる.
  r("られる", "る", [], ["v1"]),
  r("われる", "う", [], ["v5"]),
  r("かれる", "く", [], ["v5"]),
  r("がれる", "ぐ", [], ["v5"]),
  r("される", "す", [], ["v5"]),
  r("される", "する", [], ["vs"]),
  r("たれる", "つ", [], ["v5"]),
  r("なれる", "ぬ", [], ["v5"]),
  r("ばれる", "ぶ", [], ["v5"]),
  r("まれる", "む", [], ["v5"]),
  // godan potential 〜ける/〜げる/…
  r("ける", "く", [], ["v5"]),
  r("げる", "ぐ", [], ["v5"]),
  r("せる", "す", [], ["v5"]),
  r("ねる", "ぬ", [], ["v5"]),
  r("べる", "ぶ", [], ["v5"]),
  r("める", "む", [], ["v5"]),
  r("れる", "る", [], ["v5"]),

  // ── Causative 〜せる/〜させる. させる is ambiguous: ichidan (見させる→見る), suru (させる→する), AND
  // godan さ-row (話させる→話す, from 話さ + せる). All three are valid; POS/class validation filters.
  r("させる", "る", [], ["v1"]),
  r("させる", "する", [], ["vs"]),
  r("させる", "す", [], ["v5"]),
  r("わせる", "う", [], ["v5"]),
  r("かせる", "く", [], ["v5"]),
  r("がせる", "ぐ", [], ["v5"]),
  r("たせる", "つ", [], ["v5"]),
  r("なせる", "ぬ", [], ["v5"]),
  r("ばせる", "ぶ", [], ["v5"]),
  r("ませる", "む", [], ["v5"]),
  r("らせる", "る", [], ["v5"]),

  // ── Volitional 〜おう/〜よう.
  r("おう", "う", [], ["v5"]),
  r("こう", "く", [], ["v5"]),
  r("ごう", "ぐ", [], ["v5"]),
  r("そう", "す", [], ["v5"]),
  r("とう", "つ", [], ["v5"]),
  r("のう", "ぬ", [], ["v5"]),
  r("ぼう", "ぶ", [], ["v5"]),
  r("もう", "む", [], ["v5"]),
  r("ろう", "る", [], ["v5"]),
  r("よう", "る", [], ["v1"]),
  r("しよう", "する", [], ["vs"]),
  r("こよう", "くる", [], ["vk"]),

  // ── Conditional 〜ば / 〜たら.
  r("えば", "う", [], ["v5"]),
  r("けば", "く", [], ["v5"]),
  r("げば", "ぐ", [], ["v5"]),
  r("せば", "す", [], ["v5"]),
  r("てば", "つ", [], ["v5"]),
  r("ねば", "ぬ", [], ["v5"]),
  r("べば", "ぶ", [], ["v5"]),
  r("めば", "む", [], ["v5"]),
  r("れば", "る", [], ANY_VERB),
  r("すれば", "する", [], ["vs"]),
  r("くれば", "くる", [], ["vk"]),
  r("ければ", "い", [], ["adj-i"]),
  r("たら", "た", [], ["-た"]),
  r("だら", "だ", [], ["-た"]),

  // ── い-adjective forms.
  r("かった", "い", [], ["adj-i"]),
  r("くて", "い", [], ["adj-i"]),
  r("く", "い", [], ["adj-i"])
];

/**
 * Whole-word rewrites for the irregular verbs する/くる, whose conjugations replace the ENTIRE word so
 * a suffix rule (which needs a non-empty stem) can't express them: bare して/きた/こない become their
 * dictionary form directly. `conditions` tag the result as vs/vk so POS validation applies.
 */
const suru = (term: string): [string, Candidate] => [
  term,
  { term: "する", conditions: ["vs"] }
];
const kuruKana = (term: string): [string, Candidate] => [
  term,
  { term: "くる", conditions: ["vk"] }
];
// 来る written with its kanji conjugates the same but keeps 来: 来た/来て/来ます → 来る (a vk entry).
const kuruKanji = (term: string): [string, Candidate] => [
  term,
  { term: "来る", conditions: ["vk"] }
];
const WHOLE_WORD: ReadonlyMap<string, Candidate> = new Map([
  suru("します"),
  suru("した"),
  suru("して"),
  suru("しない"),
  suru("しよう"),
  suru("すれば"),
  suru("される"),
  suru("させる"),
  kuruKana("きます"),
  kuruKana("きた"),
  kuruKana("きて"),
  kuruKana("こない"),
  kuruKana("こよう"),
  kuruKana("くれば"),
  // 来る in kanji — the reading is on 来 (き/こ), so the conjugation kana still varies.
  kuruKanji("来ます"),
  kuruKanji("来た"),
  kuruKanji("来て"),
  kuruKanji("来ない"),
  kuruKanji("来よう"),
  kuruKanji("来れば")
]);

/** A deinflection candidate: a dictionary-form string plus the POS conditions it must satisfy. */
export interface Candidate {
  term: string;
  conditions: readonly Condition[];
}

const MAX_DEPTH = 4;
const MAX_CANDIDATES = 40;

/** One node in the chain search: a form plus the conditions it currently satisfies (empty = surface). */
interface Node {
  form: string;
  conditions: readonly Condition[];
}

/** Whether a rule can fire on a node: `conditionsIn` empty (starts a chain) or overlaps the node's set. */
const canApply = (rule: Rule, node: Node): boolean =>
  rule.conditionsIn.length === 0 ||
  rule.conditionsIn.some((c) => node.conditions.includes(c));

/**
 * Candidate dictionary forms for a (possibly conjugated) query, each tagged with the POS conditions the
 * deinflection implies. Excludes the query itself. Only DICTIONARY-FORM results are returned (a chain
 * that stalls at an intermediate state produces nothing). `deinflectTerms` gives the bare strings for
 * callers that don't validate POS.
 */
export const deinflectCandidates = (query: string): Candidate[] => {
  const out: Candidate[] = [];
  // Dedup on (form + condition) so the same string reached as different POS classes is kept distinct,
  // but the exact same tagged candidate isn't emitted twice.
  const seen = new Set<string>();

  // Emit a candidate (deduped, capped). Returns false once the cap is hit so the caller can stop.
  const emit = (term: string, conditions: readonly Condition[]): boolean => {
    const key = `${term}\t${conditions.join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ term, conditions });
    }
    // A サ変 verb's JMdict dictionary form is the STEM NOUN (勉強), not 勉強する — the entry is 勉強
    // with a `vs` sense. So for a vs candidate ending in する, also offer the base noun.
    if (conditions.includes("vs") && term.endsWith("する") && term.length > 2) {
      const base = term.slice(0, -2);
      const baseKey = `${base}\t${conditions.join(",")}`;
      if (!seen.has(baseKey)) {
        seen.add(baseKey);
        out.push({ term: base, conditions });
      }
    }
    return out.length < MAX_CANDIDATES;
  };

  let frontier: Node[] = [{ form: query, conditions: [] }];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      // Whole-word irregulars first (bare して/きた/… whose stem would be empty for a suffix rule).
      const whole = WHOLE_WORD.get(node.form);
      if (whole && whole.term !== query) {
        if (!emit(whole.term, whole.conditions)) return out;
      }
      for (const rule of RULES) {
        if (!canApply(rule, node)) continue;
        if (!node.form.endsWith(rule.from)) continue;
        // Require a non-empty stem so we never deinflect the whole word away.
        const stem = node.form.slice(0, node.form.length - rule.from.length);
        if (stem === "") continue;
        const form = stem + rule.to;
        if (form === query) continue;
        next.push({ form, conditions: rule.conditionsOut });
        // Emit as a candidate only when it reached a real dictionary form.
        const dictConds = rule.conditionsOut.filter((c) =>
          DICTIONARY_FORMS.has(c)
        );
        if (dictConds.length > 0 && !emit(form, dictConds)) return out;
      }
    }
    frontier = next;
  }
  return out;
};

/** Bare candidate strings (dedup), for callers that don't need the POS conditions. */
export const deinflect = (query: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { term } of deinflectCandidates(query)) {
    if (!seen.has(term)) {
      seen.add(term);
      out.push(term);
    }
  }
  return out;
};

/**
 * Whether a JMdict POS code matches a specific deinflection condition's VERB CLASS (not just "a verb").
 * This is the core of typed deinflection: して deinflected as a v1 (ichidan) te-form must NOT match
 * 知る (a v5r godan verb) — 知る's te-form is しって, not して. Coarse "is it a verb" would wrongly
 * accept it; the class check rejects it, so して resolves to する (vs) alone.
 */
const codeMatchesCondition = (cond: Condition, code: string): boolean => {
  switch (cond) {
    case "v1":
      return code === "v1" || code.startsWith("v1-");
    case "v5":
      return code.startsWith("v5");
    case "vk":
      return code === "vk";
    case "vs":
      return code.startsWith("vs"); // vs, vs-i, vs-c, vs-s
    case "vz":
      return code === "vz";
    case "adj-i":
      return code === "adj-i" || code === "adj-ix";
    case "-ます":
    case "-て":
    case "-た":
    case "-ない":
    case "-ば":
      return false; // intermediate conditions never validate against an entry
  }
};

/**
 * Whether a deinflection candidate is grammatically valid for an entry with the given JMdict POS codes:
 * at least one of the candidate's conditions must match the entry's actual verb class / adjective type.
 * Rejects して → 汁 (a noun) AND して → 知る (a v5 godan verb, when the candidate was v1) while keeping
 * して → する (vs).
 */
export const candidateMatchesPos = (
  candidate: Candidate,
  codes: readonly string[]
): boolean =>
  candidate.conditions.some((cond) =>
    codes.some((code) => codeMatchesCondition(cond, code))
  );
