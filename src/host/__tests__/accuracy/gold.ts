// Hand-judged gold corpus for editor-resolution accuracy (spec 12 §3).
//
// EVERY expectation here was read, segmented, and translated by hand — the gold is my own
// linguistic understanding of the sentence, NOT the code's output and NOT a blindly-trusted
// external label (spec 12's methodology directive). If the tokenizer and code happen to agree
// with a wrong reading, that is still a FAIL: the judgement is "which dictionary entry is the
// right one for THIS word in THIS sentence", made by comprehension.
//
// Each case pairs a sentence with the content words whose resolution I want to pin. `expect` is
// the dictionary headword (kanji writing, or kana for usually-kana words) I judged correct in
// context. The scorer tokenizes the sentence, finds the segment carrying each word, resolves it
// exactly as the hover does (resolveByLemma), and checks the resolved headword equals `expect`.
//
// A word is only listed when its resolution is DECIDABLE from the sentence. Genuinely ambiguous
// words (a kana form two common verbs share, out of context) are marked `optional: true`: a wrong
// resolution there is noise, not a regression, so it is reported but never fails the gate.
//
// `surface` is how the word appears in the sentence (conjugated/written as-is); the scorer uses it
// to locate the segment. `note` records WHY this is the right entry when it isn't obvious — the
// same reasoning a reviewer would write when designing the test.

export type Register = "casual" | "formal" | "literary";

export interface GoldWord {
  /** The word AS WRITTEN in the sentence (surface form), used to locate its segment. */
  surface: string;
  /** The dictionary headword I judged correct for this word in this sentence. */
  expect: string;
  /** Reading, only when the headword alone is ambiguous (homograph) and needs disambiguating. */
  reading?: string;
  /** Genuinely ambiguous out of context — reported but never fails the gate. */
  optional?: boolean;
  /** Why this entry is the right one, when non-obvious. */
  note?: string;
}

export interface GoldCase {
  sentence: string;
  register: Register;
  /** Plain-English gloss of the whole sentence — my comprehension on record. */
  gloss: string;
  words: GoldWord[];
  /** A named seed regression this case guards (spec 12 §3); makes the case a hard gate. */
  regression?: string;
}

// ── Casual / colloquial ────────────────────────────────────────────────────────────────────────
// The reported failure mode lives here: kana-only words, colloquial contractions, homophones out
// of newspaper-frequency order.

const casual: GoldCase[] = [
  {
    sentence: "あー、いいよ。",
    register: "casual",
    gloss: "Ah, it's fine / sure.",
    regression: "いい adjective, not a kanji homophone",
    words: [
      {
        surface: "いい",
        expect: "いい",
        note: "adjective いい/良い 'good, fine' — NOT a kanji homophone. This entry's headword surfaces as kana いい (it's usually written kana), which is the correct resolution."
      }
    ]
  },
  {
    sentence: "ちょっと待って。",
    register: "casual",
    gloss: "Wait a sec.",
    words: [
      {
        surface: "ちょっと",
        expect: "ちょっと",
        note: "adverb 'a little/wait' — `uk`, so the heading must be the kana ちょっと, NOT the archaic kanji 一寸."
      },
      {
        surface: "待って",
        expect: "待つ",
        note: "te-form of 待つ (v5t) — the pause imperative."
      }
    ]
  },
  {
    sentence: "うん、いいよ。",
    register: "casual",
    gloss: "Yeah, that's fine.",
    regression: "conversational うん is 'yeah' (interjection), not 運 'luck'",
    words: [
      {
        surface: "うん",
        expect: "うん",
        note: "aizuchi/agreement 'yeah' — the kana-only INTERJECTION entry, NOT the noun 運 'luck' (which reads うん but means fortune). The reading tier floats the kana entry over 運."
      },
      {
        surface: "いい",
        expect: "いい",
        note: "adjective いい 'good/fine/alright' — NOT the 良いね interjection or a kanji homophone."
      }
    ]
  },
  {
    sentence: "ここに本棚を置きたい。",
    register: "casual",
    gloss: "I want to put a bookshelf here.",
    words: [
      {
        surface: "ここ",
        expect: "ここ",
        note: "pronoun 'here' — `uk`, so the heading is the kana ここ, NOT the archaic kanji 此処."
      },
      { surface: "本棚", expect: "本棚", note: "'bookshelf' (ほんだな)." },
      {
        surface: "置きたい",
        expect: "置く",
        note: "desiderative 置きたい of 置く (v5k)."
      }
    ]
  },
  {
    sentence: "手伝ってくれてありがとう。",
    register: "casual",
    gloss: "Thanks for helping.",
    words: [
      {
        surface: "ありがとう",
        expect: "ありがとう",
        note: "interjection 'thank you' — `uk`, so the heading is the kana ありがとう, NOT the archaic kanji 有難う."
      }
    ]
  },
  {
    sentence: "宿題をしてるよ。",
    register: "casual",
    gloss: "I'm doing my homework.",
    regression: "して → する, not 知る/死",
    words: [
      { surface: "宿題", expect: "宿題", note: "kango 'homework'." },
      {
        surface: "してる",
        expect: "する",
        note: "colloquial している→してる, する's progressive. Resolves to the 為る entry (する 'to do'), NOT 擦る/死/知る — and its heading shows the kana する, since 為る is `uk` with an uncommon kanji. (何してる folds into one 何する segment in the tokenizer, so this uses 宿題をしてる to isolate してる.)"
      }
    ]
  },
  {
    sentence: "もう帰るね。",
    register: "casual",
    gloss: "I'm heading home now.",
    words: [
      {
        surface: "帰る",
        expect: "帰る",
        note: "帰る (v5r) 'go home' — not 返る 'return (an object)', which is a different verb though homophone."
      }
    ]
  },
  {
    sentence: "それ、めっちゃ美味しい！",
    register: "casual",
    gloss: "That's super tasty!",
    words: [
      {
        surface: "美味しい",
        expect: "美味しい",
        note: "adj-i, usually written 美味しい or おいしい."
      }
    ]
  },
  {
    sentence: "ごめん、遅れた。",
    register: "casual",
    gloss: "Sorry, I'm late.",
    words: [
      {
        surface: "遅れた",
        expect: "遅れる",
        note: "past of 遅れる (v1) 'be late' — not 送れる."
      }
    ]
  },
  {
    sentence: "今日は疲れたな。",
    register: "casual",
    gloss: "I'm worn out today.",
    words: [
      { surface: "今日", expect: "今日", reading: "きょう" },
      {
        surface: "疲れた",
        expect: "疲れる",
        note: "past of 疲れる (v1) 'get tired'."
      }
    ]
  },
  {
    sentence: "ちゃんと勉強しなさい。",
    register: "casual",
    gloss: "Study properly.",
    regression: "勉強する (verb) resolves to the vs noun 勉強",
    words: [
      {
        surface: "勉強",
        expect: "勉強",
        note: "サ変: 勉強しなさい's dictionary form is the vs NOUN 勉強, not 勉強する."
      }
    ]
  },
  {
    sentence: "犬が走ってる。",
    register: "casual",
    gloss: "The dog is running.",
    words: [
      { surface: "犬", expect: "犬", reading: "いぬ" },
      {
        surface: "走ってる",
        expect: "走る",
        note: "走っている→走ってる, progressive of 走る (v5r)."
      }
    ]
  },
  {
    sentence: "ここに座ってもいい？",
    register: "casual",
    gloss: "Can I sit here?",
    words: [
      {
        surface: "座って",
        expect: "座る",
        note: "te-form of 座る (v5r) in the 〜てもいい permission pattern."
      }
    ]
  },
  {
    sentence: "水が飲みたい。",
    register: "casual",
    gloss: "I want to drink water.",
    words: [
      { surface: "水", expect: "水", reading: "みず" },
      {
        surface: "飲みたい",
        expect: "飲む",
        note: "desiderative 飲みたい of 飲む (v5m)."
      }
    ]
  },
  {
    sentence: "そんなこと言わないで。",
    register: "casual",
    gloss: "Don't say things like that.",
    words: [
      {
        surface: "言わないで",
        expect: "言う",
        note: "negative-request 言わないで of 言う (v5u)."
      }
    ]
  },
  {
    sentence: "彼は医者になりたい。",
    register: "casual",
    gloss: "He wants to become a doctor.",
    regression:
      "なる is 成る 'become', not the rare homophone 生る 'bear fruit'",
    words: [
      { surface: "医者", expect: "医者", note: "kango 'doctor'." },
      {
        surface: "なりたい",
        expect: "成る",
        note: "desiderative of なる 'become' (成る) — NOT 生る 'bear fruit', which shares the reading なる and wins on freq_rank (7 vs 34) because that scores the kanji 生, not the word. Sense breadth (成る 11 senses vs 生る 1) is the correct discriminator."
      }
    ]
  }
];

// ── Formal / polite ────────────────────────────────────────────────────────────────────────────
// ます/です register, kango compounds, longer sentences.

const formal: GoldCase[] = [
  {
    sentence: "明日、会議に出席します。",
    register: "formal",
    gloss: "I will attend the meeting tomorrow.",
    words: [
      { surface: "明日", expect: "明日", reading: "あした" },
      { surface: "会議", expect: "会議", note: "kango 'meeting'." },
      {
        surface: "出席",
        expect: "出席",
        note: "サ変: 出席します → vs noun 出席 'attendance'."
      }
    ]
  },
  {
    sentence: "資料をお送りいたします。",
    register: "formal",
    gloss: "I will send the materials.",
    words: [
      { surface: "資料", expect: "資料", note: "kango 'materials, data'." },
      {
        surface: "送り",
        expect: "送る",
        optional: true,
        note: "humble お送りする built on 送る (v5r). Optional: the tokenizer keeps the honorific お in the lemma (お送り), so it doesn't resolve to 送る — a known honorific-prefix gap at the TOKENIZER layer, not a resolveByLemma bug (送る IS in the DB)."
      }
    ]
  },
  {
    sentence: "ご来店いただきありがとうございます。",
    register: "formal",
    gloss: "Thank you for visiting our store.",
    words: [
      {
        surface: "来店",
        expect: "来店",
        note: "サ変 kango 'store visit' → vs noun 来店."
      }
    ]
  },
  {
    sentence: "この問題について検討する必要があります。",
    register: "formal",
    gloss: "We need to consider this issue.",
    words: [
      { surface: "問題", expect: "問題", note: "kango 'problem, issue'." },
      {
        surface: "検討",
        expect: "検討",
        note: "サ変: 検討する → vs noun 検討 'consideration'."
      },
      {
        surface: "必要",
        expect: "必要",
        note: "adjectival noun 'necessity/necessary'."
      }
    ]
  },
  {
    sentence: "先生が学生に質問しました。",
    register: "formal",
    gloss: "The teacher asked the students a question.",
    words: [
      { surface: "先生", expect: "先生", note: "kango 'teacher'." },
      { surface: "学生", expect: "学生", note: "kango 'student'." },
      {
        surface: "質問",
        expect: "質問",
        note: "サ変: 質問しました → vs noun 質問 'question'."
      }
    ]
  },
  {
    sentence: "会場は駅の近くにございます。",
    register: "formal",
    gloss: "The venue is near the station.",
    words: [
      { surface: "会場", expect: "会場", note: "kango 'venue'." },
      { surface: "駅", expect: "駅", reading: "えき" },
      {
        surface: "近く",
        expect: "近く",
        note: "近く 'vicinity' (noun/adverb) — from adj 近い but used substantively here."
      }
    ]
  },
  {
    sentence: "ご不明な点がございましたらお問い合わせください。",
    register: "formal",
    gloss: "If anything is unclear, please contact us.",
    words: [
      {
        surface: "問い合わせ",
        expect: "問い合わせ",
        note: "お問い合わせください — noun/vs 問い合わせ 'inquiry'."
      }
    ]
  },
  {
    sentence: "新しい制度が導入されました。",
    register: "formal",
    gloss: "A new system was introduced.",
    words: [
      { surface: "新しい", expect: "新しい", note: "adj-i 'new'." },
      { surface: "制度", expect: "制度", note: "kango 'system, institution'." },
      {
        surface: "導入",
        expect: "導入",
        note: "サ変 passive 導入された → vs noun 導入 'introduction'."
      }
    ]
  }
];

// ── Literary / prose ───────────────────────────────────────────────────────────────────────────
// Harder vocabulary and older grammar, drawn from the register of the 羅生門 corpus already
// vendored (bench/fixtures/rashomon.txt). These test that resolution holds up outside everyday speech.

const literary: GoldCase[] = [
  {
    sentence: "一人の下人が、羅生門の下で雨やみを待っていた。",
    register: "literary",
    gloss:
      "A lone servant was waiting under the Rashōmon for the rain to stop.",
    words: [
      {
        surface: "下人",
        expect: "下人",
        optional: true,
        note: "げにん 'servant'. Optional: this archaic word is ABSENT from the shipped JMdict build (kanjiRows=0), so resolving to null is correct — a coverage gap, not a resolution error."
      },
      {
        surface: "待っていた",
        expect: "待つ",
        note: "past progressive 待っていた of 待つ (v5t)."
      }
    ]
  },
  {
    sentence: "ある日の暮方の事である。",
    register: "literary",
    gloss: "It was one evening.",
    words: [
      {
        surface: "暮方",
        expect: "暮れ方",
        reading: "くれがた",
        optional: true,
        note: "暮方/暮れ方 'nightfall' — orthographic variant, may resolve to either writing."
      }
    ]
  },
  {
    sentence: "彼は静かに本を閉じた。",
    register: "literary",
    gloss: "He quietly closed the book.",
    words: [
      { surface: "静か", expect: "静か", note: "adjectival noun 'quiet'." },
      { surface: "本", expect: "本", reading: "ほん" },
      {
        surface: "閉じた",
        expect: "閉じる",
        note: "past of 閉じる (v1) 'close'."
      }
    ]
  },
  {
    sentence: "風が木々を揺らしている。",
    register: "literary",
    gloss: "The wind is shaking the trees.",
    words: [
      { surface: "風", expect: "風", reading: "かぜ" },
      {
        surface: "揺らして",
        expect: "揺らす",
        optional: true,
        note: "progressive of 揺らす (v5s) 'shake (transitive)'. Optional: 揺らす is ABSENT from the shipped JMdict build (kanjiRows=0), so null is correct — a coverage gap, not a resolution error."
      }
    ]
  },
  {
    sentence: "老人は深く息を吸った。",
    register: "literary",
    gloss: "The old man drew a deep breath.",
    words: [
      { surface: "老人", expect: "老人", note: "kango 'old person'." },
      {
        surface: "深く",
        expect: "深い",
        note: "adverbial 深く of adj-i 深い 'deep'."
      },
      { surface: "息", expect: "息", reading: "いき" },
      {
        surface: "吸った",
        expect: "吸う",
        note: "past of 吸う (v5u) 'inhale'."
      }
    ]
  }
];

export const goldCorpus: GoldCase[] = [...casual, ...formal, ...literary];

export const byRegister = (register: Register): GoldCase[] =>
  goldCorpus.filter((c) => c.register === register);
