/**
 * Forward conjugation: dictionary form + JMdict POS code → the standard form table shown on the
 * word page (the inverse of host/deinflect.ts, but class-driven — the POS tag names the verb class,
 * so nothing is guessed). Works on the written surface: suffixes replace the trailing KANA of the
 * dictionary form, so kanji headwords conjugate correctly (来る → 来ない; the reading change is
 * invisible in writing). Returns null for non-conjugable POS or a surface that doesn't match its
 * class's ending — silently absent beats silently wrong.
 */

export interface ConjugationRow {
  form: string;
  affirmative: string;
  /** Empty when the form has no standard negative (e.g. volitional). */
  negative: string;
  /** Colloquial variant of the affirmative (the ら抜き potential), when one exists. */
  colloquial?: string;
}

/** The five bases + te/ta endings for each godan class, keyed by the POS code's consonant letter.
    `| undefined` keeps the lookup honest for codes outside the table (the guard is load-bearing). */
const GODAN: Record<
  string,
  | { a: string; i: string; e: string; o: string; te: string; ta: string }
  | undefined
> = {
  u: { a: "わ", i: "い", e: "え", o: "お", te: "って", ta: "った" },
  k: { a: "か", i: "き", e: "け", o: "こ", te: "いて", ta: "いた" },
  g: { a: "が", i: "ぎ", e: "げ", o: "ご", te: "いで", ta: "いだ" },
  s: { a: "さ", i: "し", e: "せ", o: "そ", te: "して", ta: "した" },
  t: { a: "た", i: "ち", e: "て", o: "と", te: "って", ta: "った" },
  n: { a: "な", i: "に", e: "ね", o: "の", te: "んで", ta: "んだ" },
  b: { a: "ば", i: "び", e: "べ", o: "ぼ", te: "んで", ta: "んだ" },
  m: { a: "ま", i: "み", e: "め", o: "も", te: "んで", ta: "んだ" },
  r: { a: "ら", i: "り", e: "れ", o: "ろ", te: "って", ta: "った" }
};

/** What each godan POS code's dictionary form must end with, for the guard. */
const GODAN_ENDS: Record<string, string | undefined> = {
  u: "う",
  k: "く",
  g: "ぐ",
  s: "す",
  t: "つ",
  n: "ぬ",
  b: "ぶ",
  m: "む",
  r: "る"
};

/** Everything needed to build the verb table, whatever the verb class. */
interface VerbBases {
  dict: string;
  /** Negative base — ない/なかった/なくて/なければ attach here. */
  nai: string;
  /** Polite base — ます/ません/たい attach here. */
  masu: string;
  te: string;
  ta: string;
  ba: string;
  imperative: string;
  volitional: string;
  potential: string;
  /** ら抜き colloquial potential (食べれる), shown in parens when present. */
  potentialColloquial?: string;
  passive: string;
  causative: string;
}

const ichidanBases = (dict: string): VerbBases | null => {
  if (!dict.endsWith("る")) return null;
  const stem = dict.slice(0, -1);
  return {
    dict,
    nai: stem,
    masu: stem,
    te: `${stem}て`,
    ta: `${stem}た`,
    ba: `${stem}れば`,
    imperative: `${stem}ろ`,
    volitional: `${stem}よう`,
    potential: `${stem}られる`,
    potentialColloquial: `${stem}れる`,
    passive: `${stem}られる`,
    causative: `${stem}させる`
  };
};

const godanBases = (dict: string, pos: string): VerbBases | null => {
  // v5k-s (行く), v5r-i (ある), v5u-s (問う), v5aru (下さる) share their base class's rows and
  // differ in one or two forms, patched below. v5aru is an r-row verb despite its code.
  const consonant = pos === "v5aru" ? "r" : pos[2];
  const row = GODAN[consonant];
  const end = GODAN_ENDS[consonant];
  if (row === undefined || end === undefined || !dict.endsWith(end)) {
    return null;
  }
  const stem = dict.slice(0, -1);
  const bases: VerbBases = {
    dict,
    nai: stem + row.a,
    masu: stem + row.i,
    te: stem + row.te,
    ta: stem + row.ta,
    ba: `${stem}${row.e}ば`,
    imperative: stem + row.e,
    volitional: `${stem}${row.o}う`,
    potential: `${stem}${row.e}る`,
    passive: `${stem}${row.a}れる`,
    causative: `${stem}${row.a}せる`
  };
  if (pos === "v5k-s") {
    // 行く geminates like a う/つ/る verb: 行って, 行った.
    bases.te = `${stem}って`;
    bases.ta = `${stem}った`;
  } else if (pos === "v5u-s") {
    // 問う/請う keep the う: 問うて, 問うた.
    bases.te = `${stem}うて`;
    bases.ta = `${stem}うた`;
  } else if (pos === "v5r-i") {
    // ある's negative is the standalone ない, not あらない.
    bases.nai = "";
  } else if (pos === "v5aru") {
    // 下さる/いらっしゃる: polite base and imperative are the い-irregular 下さい.
    bases.masu = `${stem}い`;
    bases.imperative = `${stem}い`;
  }
  return bases;
};

const suruBases = (dict: string): VerbBases | null => {
  if (!dict.endsWith("する")) return null;
  const stem = dict.slice(0, -2);
  return {
    dict,
    nai: `${stem}し`,
    masu: `${stem}し`,
    te: `${stem}して`,
    ta: `${stem}した`,
    ba: `${stem}すれば`,
    imperative: `${stem}しろ`,
    volitional: `${stem}しよう`,
    potential: `${stem}できる`,
    passive: `${stem}される`,
    causative: `${stem}させる`
  };
};

const kuruBases = (dict: string): VerbBases | null => {
  // Written with 来, every form keeps the kanji (来ない・来ます — the こ/き reading change is
  // invisible). Written in kana, the stem vowel is spelled out, so the two need separate bases.
  const kanji = dict.endsWith("来る");
  if (!kanji && !dict.endsWith("くる")) return null;
  const prefix = dict.slice(0, -2);
  const [ko, ki, ku] = kanji
    ? [`${prefix}来`, `${prefix}来`, `${prefix}来`]
    : [`${prefix}こ`, `${prefix}き`, `${prefix}く`];
  return {
    dict,
    nai: ko,
    masu: ki,
    te: `${ki}て`,
    ta: `${ki}た`,
    ba: `${ku}れば`,
    imperative: `${ko}い`,
    volitional: `${ko}よう`,
    potential: `${ko}られる`,
    potentialColloquial: `${ko}れる`,
    passive: `${ko}られる`,
    causative: `${ko}させる`
  };
};

/** Negative of an ichidan-shaped derived form (potential/passive/causative all end in る). */
const derivedNegative = (form: string): string => `${form.slice(0, -1)}ない`;

const verbRows = (b: VerbBases): ConjugationRow[] => [
  { form: "Non-past", affirmative: b.dict, negative: `${b.nai}ない` },
  {
    form: "Non-past (polite)",
    affirmative: `${b.masu}ます`,
    negative: `${b.masu}ません`
  },
  { form: "Past", affirmative: b.ta, negative: `${b.nai}なかった` },
  {
    form: "Past (polite)",
    affirmative: `${b.masu}ました`,
    negative: `${b.masu}ませんでした`
  },
  { form: "Te-form", affirmative: b.te, negative: `${b.nai}なくて` },
  {
    form: "Potential",
    affirmative: b.potential,
    negative: derivedNegative(b.potential),
    ...(b.potentialColloquial === undefined
      ? {}
      : { colloquial: b.potentialColloquial })
  },
  {
    form: "Passive",
    affirmative: b.passive,
    negative: derivedNegative(b.passive)
  },
  {
    form: "Causative",
    affirmative: b.causative,
    negative: derivedNegative(b.causative)
  },
  { form: "Imperative", affirmative: b.imperative, negative: `${b.dict}な` },
  { form: "Volitional", affirmative: b.volitional, negative: "" },
  {
    form: "Conditional (〜ば)",
    affirmative: b.ba,
    negative: `${b.nai}なければ`
  },
  {
    form: "Conditional (〜たら)",
    affirmative: `${b.ta}ら`,
    negative: `${b.nai}なかったら`
  },
  {
    form: "Desire (〜たい)",
    affirmative: `${b.masu}たい`,
    negative: `${b.masu}たくない`
  }
];

const iAdjectiveRows = (dict: string, pos: string): ConjugationRow[] | null => {
  if (!dict.endsWith("い")) return null;
  // adj-ix (いい and compounds like かっこいい) conjugates on the よい stem; written 良い already
  // ends in the regular stem, so only a literal trailing いい needs the swap.
  const stem =
    pos === "adj-ix" && dict.endsWith("いい")
      ? `${dict.slice(0, -2)}よ`
      : dict.slice(0, -1);
  return [
    { form: "Non-past", affirmative: dict, negative: `${stem}くない` },
    {
      form: "Non-past (polite)",
      affirmative: `${dict}です`,
      negative: `${stem}くないです`
    },
    {
      form: "Past",
      affirmative: `${stem}かった`,
      negative: `${stem}くなかった`
    },
    {
      form: "Past (polite)",
      affirmative: `${stem}かったです`,
      negative: `${stem}くなかったです`
    },
    {
      form: "Te-form",
      affirmative: `${stem}くて`,
      negative: `${stem}くなくて`
    },
    { form: "Adverbial", affirmative: `${stem}く`, negative: "" },
    {
      form: "Conditional (〜ば)",
      affirmative: `${stem}ければ`,
      negative: `${stem}くなければ`
    },
    {
      form: "Conditional (〜たら)",
      affirmative: `${stem}かったら`,
      negative: `${stem}くなかったら`
    }
  ];
};

const naAdjectiveRows = (dict: string): ConjugationRow[] => [
  { form: "Non-past", affirmative: `${dict}だ`, negative: `${dict}じゃない` },
  {
    form: "Non-past (polite)",
    affirmative: `${dict}です`,
    negative: `${dict}じゃありません`
  },
  {
    form: "Past",
    affirmative: `${dict}だった`,
    negative: `${dict}じゃなかった`
  },
  {
    form: "Past (polite)",
    affirmative: `${dict}でした`,
    negative: `${dict}じゃありませんでした`
  },
  { form: "Te-form", affirmative: `${dict}で`, negative: `${dict}じゃなくて` },
  {
    form: "Conditional",
    affirmative: `${dict}なら`,
    negative: `${dict}じゃなければ`
  }
];

const forPos = (surface: string, pos: string): ConjugationRow[] | null => {
  if (pos === "v1" || pos === "v1-s") {
    const bases = ichidanBases(surface);
    return bases === null ? null : verbRows(bases);
  }
  if (/^v5(?:[ukgstnbmr]|k-s|r-i|u-s|aru)$/.test(pos)) {
    const bases = godanBases(surface, pos);
    return bases === null ? null : verbRows(bases);
  }
  if (pos === "vs-i" || pos === "vs-s") {
    const bases = suruBases(surface);
    return bases === null ? null : verbRows(bases);
  }
  if (pos === "vs") {
    // A suru-noun (勉強): the table conjugates the derived verb 勉強する.
    const bases = suruBases(`${surface}する`);
    return bases === null ? null : verbRows(bases);
  }
  if (pos === "vk") {
    const bases = kuruBases(surface);
    return bases === null ? null : verbRows(bases);
  }
  if (pos === "adj-i" || pos === "adj-ix") return iAdjectiveRows(surface, pos);
  if (pos === "adj-na") return naAdjectiveRows(surface);
  return null;
};

/**
 * The conjugation table for a dictionary form, using the first POS code that yields one. Null when
 * no code is conjugable (nouns, particles…) — the word page then shows no conjugation section.
 */
export const conjugate = (
  surface: string,
  posCodes: string[]
): ConjugationRow[] | null => {
  for (const pos of posCodes) {
    const rows = forPos(surface, pos);
    if (rows !== null) return rows;
  }
  return null;
};
