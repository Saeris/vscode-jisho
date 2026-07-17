/**
 * Rule-based Japanese deinflection: expand a conjugated query (はなします, 食べた, たかくない)
 * into candidate dictionary forms (はなす, 食べる, たかい) so searches match JMdict's
 * dictionary-form entries.
 *
 * Deliberately over-generates: a rule may fire on a word it doesn't grammatically apply to
 * (e.g. く→い on a non-adjective), producing a candidate that is not a real word. That's fine —
 * candidates are only used for *exact* headword lookups, so the dictionary itself filters the
 * noise. What matters is that every real conjugation a learner types produces its true base form
 * among the candidates. Ruleset informed by Yomitan/10ten's tables, trimmed to the common forms.
 *
 * A proper morphological analyzer (M5, @saeris/kuromoji) will eventually supersede this.
 */

/** Suffix rewrite rules: if the query ends with `from`, `to` variants are candidates. */
const RULES: ReadonlyArray<readonly [from: string, to: readonly string[]]> = [
  // ── Polite forms: normalize to ます first, then ます resolves to plain forms ──
  ["ませんでした", ["ます"]],
  ["ましょう", ["ます"]],
  ["ました", ["ます"]],
  ["ません", ["ます"]],
  ["まして", ["ます"]],
  ["います", ["う", "いる"]],
  ["きます", ["く", "くる", "きる"]],
  ["ぎます", ["ぐ", "ぎる"]],
  ["します", ["す", "する"]],
  ["ちます", ["つ"]],
  ["にます", ["ぬ", "にる"]],
  ["びます", ["ぶ", "びる"]],
  ["みます", ["む", "みる"]],
  ["ります", ["る", "りる"]],
  ["ます", ["る"]],
  // ── Progressive: strip to the te-form, which then resolves onward ──
  ["ています", ["て"]],
  ["でいます", ["で"]],
  ["ている", ["て"]],
  ["でいる", ["で"]],
  ["てる", ["て"]],
  // ── Te-form ──
  ["って", ["う", "つ", "る"]],
  ["いて", ["く"]],
  ["いで", ["ぐ"]],
  ["して", ["す", "する"]],
  ["んで", ["ぬ", "ぶ", "む"]],
  ["きて", ["くる"]],
  ["て", ["る"]],
  // ── Plain past ──
  ["った", ["う", "つ", "る"]],
  ["いた", ["く"]],
  ["いだ", ["ぐ"]],
  ["した", ["す", "する"]],
  ["んだ", ["ぬ", "ぶ", "む"]],
  ["きた", ["くる"]],
  ["た", ["る"]],
  // ── Negative: normalize to ない, then ない resolves to plain forms ──
  ["なかった", ["ない"]],
  ["なくて", ["ない"]],
  ["わない", ["う"]],
  ["かない", ["く"]],
  ["がない", ["ぐ"]],
  ["さない", ["す"]],
  ["たない", ["つ"]],
  ["なない", ["ぬ"]],
  ["ばない", ["ぶ"]],
  ["まない", ["む"]],
  ["らない", ["る"]],
  ["こない", ["くる"]],
  ["しない", ["する"]],
  ["ない", ["る", "い"]],
  // ── Desiderative (〜たい) ──
  ["いたい", ["う"]],
  ["きたい", ["く"]],
  ["ぎたい", ["ぐ"]],
  ["したい", ["す", "する"]],
  ["ちたい", ["つ"]],
  ["にたい", ["ぬ"]],
  ["びたい", ["ぶ"]],
  ["みたい", ["む"]],
  ["りたい", ["る"]],
  ["たい", ["る"]],
  // ── Passive / potential ──
  ["られる", ["る"]],
  ["われる", ["う"]],
  ["かれる", ["く"]],
  ["がれる", ["ぐ"]],
  ["される", ["す", "する"]],
  ["たれる", ["つ"]],
  ["なれる", ["ぬ"]],
  ["ばれる", ["ぶ"]],
  ["まれる", ["む"]],
  ["ける", ["く"]],
  ["げる", ["ぐ"]],
  ["せる", ["す"]],
  ["てる", ["つ"]],
  ["ねる", ["ぬ"]],
  ["べる", ["ぶ"]],
  ["める", ["む"]],
  ["れる", ["る"]],
  // ── Causative ──
  ["させる", ["る", "する", "す"]],
  ["わせる", ["う"]],
  ["かせる", ["く"]],
  ["がせる", ["ぐ"]],
  ["たせる", ["つ"]],
  ["なせる", ["ぬ"]],
  ["ばせる", ["ぶ"]],
  ["ませる", ["む"]],
  ["らせる", ["る"]],
  // ── Volitional ──
  ["おう", ["う"]],
  ["こう", ["く"]],
  ["ごう", ["ぐ"]],
  ["そう", ["す"]],
  ["とう", ["つ"]],
  ["のう", ["ぬ"]],
  ["ぼう", ["ぶ"]],
  ["もう", ["む"]],
  ["よう", ["る"]],
  ["ろう", ["る"]],
  // ── Conditional ──
  ["えば", ["う"]],
  ["けば", ["く"]],
  ["げば", ["ぐ"]],
  ["せば", ["す"]],
  ["てば", ["つ"]],
  ["ねば", ["ぬ"]],
  ["べば", ["ぶ"]],
  ["めば", ["む"]],
  ["れば", ["る"]],
  ["たら", ["た"]],
  ["だら", ["だ"]],
  // ── い-adjectives ──
  ["くなかった", ["い"]],
  ["くない", ["い"]],
  ["かった", ["い"]],
  ["くて", ["い"]],
  ["ければ", ["い"]],
  ["く", ["い"]]
];

/**
 * Whole-word rewrites for the irregular verbs する/くる, whose conjugations replace the entire
 * word. These can't be suffix rules: the empty-stem guard (correctly) blocks a rule whose `from`
 * consumes the whole form, so bare します/きた/こない are handled here instead.
 */
const IRREGULAR: Readonly<Record<string, readonly string[]>> = {
  します: ["する"],
  した: ["する"],
  して: ["する"],
  しない: ["する"],
  しよう: ["する"],
  すれば: ["する"],
  きます: ["くる"],
  きた: ["くる"],
  きて: ["くる"],
  こない: ["くる"],
  こよう: ["くる"],
  くれば: ["くる"]
};

const MAX_DEPTH = 4;
const MAX_CANDIDATES = 24;

/**
 * Candidate dictionary forms for a (possibly conjugated) query, best-first-ish (shallower
 * derivations first). Excludes the query itself. Empty for queries no rule applies to.
 */
export const deinflect = (query: string): string[] => {
  const seen = new Set<string>([query]);
  const out: string[] = [];
  let frontier = [query];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const form of frontier) {
      for (const candidate of IRREGULAR[form] ?? []) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          out.push(candidate);
          next.push(candidate);
          if (out.length >= MAX_CANDIDATES) return out;
        }
      }
      for (const [from, tos] of RULES) {
        // Require a non-empty stem so we never "deinflect" the entire word away.
        if (form.length > from.length && form.endsWith(from)) {
          const stem = form.slice(0, -from.length);
          for (const to of tos) {
            const candidate = stem + to;
            if (!seen.has(candidate)) {
              seen.add(candidate);
              out.push(candidate);
              next.push(candidate);
              if (out.length >= MAX_CANDIDATES) return out;
            }
          }
        }
      }
    }
    frontier = next;
  }
  return out;
};
