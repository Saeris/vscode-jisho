/**
 * Curated grammar notes: particles, auxiliaries, and conjugation forms.
 *
 * Dictionary entries explain WORDS. A learner hovering は, を, or the pieces of 食べたくなかった needs
 * GRAMMAR — what a construct does and when you would actually reach for it. JMdict has entries for
 * particles, but they are lexicographer's glosses ("indicates the topic"), not explanations.
 *
 * ## Originality
 *
 * Every note here is written from scratch for this project. Tae Kim's Guide (CC BY-NC-SA) and
 * Tofugu's articles are the QUALITY BAR — models of what a good explanation covers: nuance,
 * register, and the situation you would use it in, rather than a grammatical label. They are
 * deliberately not sources, and no passage here paraphrases them.
 *
 * ## Voice
 *
 * Matches the conjugation hints in `Term.tsx` that this extends: plain terms, jargon always glossed,
 * usage before terminology ("The connector — chains actions"), and examples built from N5 vocabulary
 * so the dictionary can resolve every word if the reader taps through. No romaji.
 */

export interface GrammarNote {
  /** One line, ≤ ~80 chars — the hover/tooltip headline. */
  gist: string;
  /** 2–4 sentences: what it does, when it's used, register/nuance. Plain language. */
  detail: string;
  /**
   * One canonical example using N5-level vocabulary.
   *
   * `ja` is written in mirrordown ruby markup (`{本|ほん}を{読|よ}みます`) and spaced at word
   * boundaries. Both choices are for a reader who cannot yet decode the sentence unaided: the
   * readings render as real furigana in hovers (VS Code's MarkdownString accepts `<ruby>`, verified
   * against a live hover), and the spacing marks the boundaries Japanese does not write — the same
   * 分かち書き the extension offers as an editor command. Kanji is kept rather than flattened to
   * kana, since dropping it removes the boundary cues too and stops looking like real Japanese.
   */
  example: { ja: string; en: string };
  /**
   * A second example of the SAME situation phrased differently, for constructs where the point is
   * emphasis rather than meaning.
   *
   * Some Japanese distinctions have no English contrast to map onto: あげる/もらう/くれる all describe
   * one event and differ only in whose vantage point the sentence takes, and に/へ differ in whether
   * the destination or the direction is emphasised. A definition cannot convey that — the reader has
   * to see the same fact written two ways. Only present where it earns its space.
   */
  contrast?: { ja: string; en: string; note: string };
}

/**
 * Particles, keyed by surface. The ~15 N5 particles.
 *
 * は/が and に/で carry cross-references in their details: they are the two distinctions learners
 * ask about most, and an explanation of either alone tends to produce a confident wrong rule.
 */
export const PARTICLE_NOTES: Record<string, GrammarNote | undefined> = {
  は: {
    gist: "Topic — 'as for…'. Sets the context, and it stays set.",
    detail:
      "Establishes what the conversation is about. The part worth knowing is that the topic PERSISTS: once set, it carries across the sentences that follow until something changes it, which is why Japanese can simply drop it afterward where English keeps repeating 'I'. It marks the topic rather than the subject, so it can attach to almost any part of a sentence. Compare が, which answers an implied question rather than setting the frame. は also does contrast: coffee は fine, tea not so much.",
    example: {
      ja: "{私|わたし} は {学生|がくせい}です。",
      en: "I'm a student. (as for me)"
    }
  },
  が: {
    gist: "Identifier — singles out which one, as if answering an unasked question.",
    detail:
      "Points at the one that matters, as though replying to a question nobody voiced: not just that someone is the student, but that it is this person and not the others. That is the difference from は, which sets up a topic instead of picking a member out of a group. It also marks the thing you perceive, feel, want, or are able to do, where English would use an object instead.",
    example: { ja: "{猫|ねこ} が います。", en: "There's a cat." },
    contrast: {
      ja: "{私|わたし} が {学生|がくせい}です。",
      en: "I'm the student. (I'm the one)",
      note: "With は this would be 'as for me, I'm a student'; が answers 'which of you is?'."
    }
  },
  を: {
    gist: "Direct object — the thing the verb acts on.",
    detail:
      "Marks what receives the action: what you eat, read, or buy. It also marks the path or space a motion verb passes through (公園を歩く, walk through the park), which is worth knowing because it looks like an object but is not one. Written を but pronounced 'o'.",
    example: { ja: "{本|ほん} を {読|よ}みます。", en: "I read a book." }
  },
  に: {
    gist: "Target — the destination, time, or person an action lands on.",
    detail:
      "Marks the point something arrives at: a place you go to, a time something happens at, or the person on the receiving end. Two contrasts are worth holding onto. Against で: に is the destination you move toward, で is the place an activity occupies — 学校に行く is going to the school, 学校で勉強する is studying at it. Against へ: both point somewhere, but に emphasises the destination itself while へ emphasises the direction of travel.",
    example: {
      ja: "{七時|ななじ} に {起|お}きます。",
      en: "I get up at seven."
    }
  },
  で: {
    gist: "Where an action happens, or the means used to do it.",
    detail:
      "Marks the setting of an action, or the tool, method, or material used. The contrast with に is the useful one: に is the destination you move toward, で is the place the activity occupies. Also does 'by means of' — 電車で行く, go by train.",
    example: { ja: "{家|いえ} で {食|た}べます。", en: "I eat at home." }
  },
  へ: {
    gist: "Direction — which way you are headed, rather than where you end up.",
    detail:
      "Points along a heading. The contrast with に is what each one emphasises, not a difference in meaning you can ignore: 駅に行く puts the weight on the station as the destination you arrive at, 駅へ行く on setting off in the station's direction. Swapping them is usually grammatical, but it moves the emphasis — which is why signs and departure boards favour へ. Written へ but pronounced 'e'.",
    example: {
      ja: "{駅|えき} へ {行|い}きます。",
      en: "I'm heading for the station."
    },
    contrast: {
      ja: "{駅|えき} に {行|い}きます。",
      en: "I'm going to the station.",
      note: "に puts the weight on arriving at the station; へ on travelling that way."
    }
  },
  と: {
    gist: "And (complete list), or with — also quotes what was said or thought.",
    detail:
      "Joins nouns into an exhaustive list: 犬と猫 means dogs and cats and nothing else, unlike や which implies more. Also marks the person you do something together with. Its third job is quotation — marking off what someone said, thought, or is called, before 言う, 思う, or a name.",
    example: {
      ja: "{友達|ともだち} と {行|い}きます。",
      en: "I'll go with a friend."
    }
  },
  から: {
    gist: "From — a starting point in time or space. Also 'because'.",
    detail:
      "Marks where something starts: a place you set out from, a time something begins. After a full clause it means 'because', giving the reason for what follows — the speaker's own reasoning, which is why it can sound assertive when explaining yourself.",
    example: {
      ja: "{九時|きゅうじ} から {働|はたら}きます。",
      en: "I work from nine."
    }
  },
  まで: {
    gist: "Until / as far as — the endpoint. Pairs with から.",
    detail:
      "Marks the limit something continues to, in time or in space, and naturally pairs with から for a range. Note the difference from までに, which is a deadline: 五時まで待つ is waiting until five, 五時までに来る is arriving by five at the latest.",
    example: {
      ja: "{駅|えき} まで {歩|ある}きます。",
      en: "I'll walk as far as the station."
    }
  },
  も: {
    gist: "Too / also — and with a negative, 'not… either'.",
    detail:
      "Adds this item to something already mentioned, replacing は or が rather than stacking with them. In a negative sentence it becomes 'not either'. Repeated, it does 'both… and…' — 犬も猫も好きです, I like both dogs and cats.",
    example: { ja: "{私|わたし} も {行|い}きます。", en: "I'll go too." }
  },
  の: {
    gist: "Possession and connection — of, 's. Also turns a clause into a noun.",
    detail:
      "Links two nouns, with the first describing the second: 私の本 is my book, 日本の車 a Japanese car. It also nominalizes — turning a whole clause into something you can treat as a thing (食べるのが好き, I like eating). At the end of a sentence in casual speech it softens a question or explanation.",
    example: { ja: "{私|わたし} の {名前|なまえ}です。", en: "It's my name." }
  },
  や: {
    gist: "And — a partial list, implying there are others.",
    detail:
      "Joins nouns as examples rather than an exhaustive list: 本やノート means books and notebooks among other things. That implication is the whole difference from と, which closes the list. Often ends with など to make the 'and so on' explicit.",
    example: {
      ja: "{本|ほん} や ノート を {買|か}いました。",
      en: "I bought books, notebooks, and so on."
    }
  },
  か: {
    gist: "Question marker — turns a statement into a question.",
    detail:
      "Placed at the end, it makes the sentence a question, which is why written Japanese often needs no question mark. Between two nouns it means 'or'. In casual speech it is frequently dropped in favour of rising intonation, so hearing it tends to signal the polite register.",
    example: { ja: "{行|い}きます か。", en: "Are you going?" }
  },
  ね: {
    gist: "Seeking agreement — 'right?', 'isn't it?'.",
    detail:
      "Invites the listener to agree, assuming they already share the view. It softens a statement into something collaborative rather than a pronouncement, which is why it is so common in everyday conversation. Overusing it with someone you have just met can sound presumptuous.",
    example: {
      ja: "いい {天気|てんき}です ね。",
      en: "Nice weather, isn't it?"
    }
  },
  よ: {
    gist: "Asserting new information — 'I'm telling you'.",
    detail:
      "Marks what you are saying as news to the listener, or as your firm position. It is the mirror image of ね: ね assumes agreement, よ supplies something the other person did not have. Used carelessly it can sound pushy, since it implies the listener needed telling.",
    example: {
      ja: "{電車|でんしゃ} が {来|き}ます よ。",
      en: "The train's coming."
    }
  }
};

/**
 * Auxiliaries, keyed by LEMMA — every key in `AUX_GLOSS`, which is re-exported below so the compact
 * breakdown chain and these notes cannot drift apart.
 */
export const AUXILIARY_NOTES: Record<string, GrammarNote | undefined> = {
  た: {
    gist: "Past — completed action, plain style.",
    detail:
      "Marks something as completed. It is the plain past, used in casual speech and in most writing; the polite equivalent is 〜ました. Attached to a verb describing a state it can also describe a present condition resulting from a past event.",
    example: { ja: "{昨日|きのう} {食|た}べた。", en: "I ate yesterday." }
  },
  だ: {
    gist: "Plain copula — 'is'. The casual counterpart of です.",
    detail:
      "Asserts that something is the case, linking a noun or な-adjective to the subject. Plain style, so it belongs with friends, in writing, and in inner thought — with strangers or at work, use です. It is often dropped entirely in casual speech.",
    example: { ja: "{学生|がくせい}だ。", en: "(I'm) a student." }
  },
  です: {
    gist: "Polite copula — 'is'. The safe default.",
    detail:
      "The polite form of だ, and the register most learners want by default: appropriate with strangers, coworkers, and customers. It also attaches to い-adjectives purely for politeness, without changing their meaning (寒いです).",
    example: { ja: "{学生|がくせい}です。", en: "I'm a student." }
  },
  ます: {
    gist: "Polite verb ending — the 〜ます style.",
    detail:
      "Makes a verb polite without changing its meaning. This is the register to default to with anyone you are not close to. Its past is 〜ました and its negative 〜ません; the plain forms carry the same meaning at a lower politeness level.",
    example: { ja: "{毎日|まいにち} {読|よ}みます。", en: "I read every day." }
  },
  ない: {
    gist: "Negation — 'not', plain style.",
    detail:
      "Negates a verb or adjective in plain style. It conjugates like an い-adjective, which is why the past is なかった rather than a new ending. The polite equivalent is 〜ません.",
    example: { ja: "{肉|にく} を {食|た}べない。", en: "I don't eat meat." }
  },
  ん: {
    gist: "Contracted negation — casual 〜ない.",
    detail:
      "A spoken contraction of ない, common in casual speech and in some regional varieties. It carries the same meaning at a more relaxed register. Do not confuse it with the explanatory ん in 〜んです, which is a different construction entirely.",
    example: { ja: "{分|わ}からん。", en: "Dunno." }
  },
  ぬ: {
    gist: "Archaic negation — literary or fixed expressions.",
    detail:
      "An older negative that survives in writing, set phrases, and deliberately formal or dramatic language. Modern speech uses ない. Worth recognising rather than producing.",
    example: { ja: "{知|し}らぬ {人|ひと}。", en: "A person one doesn't know." }
  },
  たい: {
    gist: "Want to — the speaker's own desire.",
    detail:
      "Attaches to a verb stem to say you want to do something, and the result conjugates like an い-adjective (食べたくない). It describes the speaker's desire, so stating someone else's wants this way sounds presumptuous — Japanese uses 〜たがる or a hedge for that.",
    example: {
      ja: "{水|みず} を {飲|の}みたい。",
      en: "I want to drink water."
    }
  },
  て: {
    gist: "Connective — chains actions and builds other forms.",
    detail:
      "Joins a verb to what follows: another action in sequence, a request (〜てください), or the continuous (〜ている). It carries no tense of its own, taking that from the end of the sentence. The single most load-bearing form in Japanese grammar.",
    example: { ja: "{食|た}べて {寝|ね}ます。", en: "I'll eat and then sleep." }
  },
  で: {
    gist: "Connective — the て-form after a voiced sound.",
    detail:
      "The same connective as て, voiced to match the preceding sound (読んで, not 読んて). Nothing about the meaning changes; it is purely a sound adjustment.",
    example: {
      ja: "{本|ほん} を {読|よ}んで {寝|ね}ます。",
      en: "I'll read and then sleep."
    }
  },
  れる: {
    gist: "Passive or potential — is done, or can do.",
    detail:
      "Attaches to a godan verb for either the passive (it was done to someone) or the potential (being able to do it), with context separating them. The passive is also used as a mild honorific in formal speech. Japanese uses the passive more freely than English, often to describe something that happened to the speaker's detriment.",
    example: {
      ja: "{先生|せんせい} に {聞|き}かれた。",
      en: "I was asked by the teacher."
    }
  },
  られる: {
    gist: "Passive or potential — is done, or can do (ichidan).",
    detail:
      "The ichidan counterpart of れる, carrying the same passive, potential, and honorific uses. In casual speech the potential often drops the ら (食べれる rather than 食べられる), which is widespread but still considered non-standard in writing.",
    example: {
      ja: "{朝|あさ} {早|はや}く {起|お}きられる。",
      en: "I can get up early."
    }
  },
  せる: {
    gist: "Causative — make or let someone do.",
    detail:
      "Says that someone caused another to act. Whether it means made or let depends on context and on the particle: に leans toward letting or allowing, を toward making. Combined with the passive it produces 〜させられる, being made to do something against your will.",
    example: {
      ja: "{子供|こども} に {食|た}べさせる。",
      en: "I'll let the child eat."
    }
  },
  させる: {
    gist: "Causative — make or let someone do (ichidan).",
    detail:
      "The ichidan counterpart of せる, with the same make/let ambiguity resolved by context and particle choice. Frequently used in polite requests for permission — 〜させてください, please let me do this.",
    example: { ja: "{見|み}させて ください。", en: "Please let me see it." }
  },
  う: {
    gist: "Volitional — let's, or 'I think I'll…'.",
    detail:
      "Proposes doing something, either as a suggestion to others or as a decision you are making. Plain style; the polite equivalent is 〜ましょう. Followed by と思う it expresses an intention you have just settled on.",
    example: { ja: "{行|い}こう。", en: "Let's go." }
  },
  よう: {
    gist: "Volitional — let's, or 'I think I'll…' (ichidan).",
    detail:
      "The ichidan counterpart of the volitional う, with the same suggesting and intending uses. With とする it means being on the verge of doing something (食べようとした, I was about to eat).",
    example: { ja: "{食|た}べよう。", en: "Let's eat." }
  },
  まい: {
    gist: "Negative volitional — 'I won't' or 'surely not'.",
    detail:
      "Expresses a firm decision not to do something, or a guess that something is not the case. It is distinctly literary and formal; ordinary speech uses ないつもり or a plain negative instead. Recognise it rather than reach for it.",
    example: { ja: "もう {行|い}くまい。", en: "I won't go again." }
  },
  そう: {
    gist: "Looks like — a judgement from appearances.",
    detail:
      "Attached to a verb stem or adjective root, it says something looks or seems a certain way based on what you can observe. It reports your impression, not something you were told — that is 〜そうだ following a plain form, which is hearsay.",
    example: { ja: "おいしそうです。", en: "It looks delicious." }
  },
  そうだ: {
    gist: "Appearance or hearsay — depends on what precedes it.",
    detail:
      "Two constructions that look alike. After a plain form it is hearsay: I hear that, they say that. After a stem or adjective root it is appearance: it looks that way. The attachment point is the only thing distinguishing them, so it is worth checking.",
    example: {
      ja: "{雨|あめ} が {降|ふ}る そうだ。",
      en: "I hear it's going to rain."
    }
  },
  ようだ: {
    gist: "Seems — an inference the speaker is drawing.",
    detail:
      "Presents a conclusion the speaker has reached from evidence, more tentative than a flat statement and more considered than 〜そう's snap impression. Also used for likeness — 〜のようだ, like a…. The casual equivalent is みたい.",
    example: {
      ja: "{雨|あめ} が {降|ふ}ったようだ。",
      en: "It seems it rained."
    }
  },
  らしい: {
    gist: "Apparently — reporting what you have gathered.",
    detail:
      "Passes on information from somewhere else, keeping some distance from it: you heard it, read it, or inferred it, and you are not vouching for it. After a noun it has a second sense — being a typical example of that thing (学生らしい, student-like).",
    example: {
      ja: "{田中|たなか}さん は {来|こ}ないらしい。",
      en: "Apparently Tanaka isn't coming."
    }
  },
  いる: {
    gist: "Continuous — 〜ている, ongoing or a resulting state.",
    detail:
      "Following the て-form, it describes an action in progress or the state left behind by one. Which reading applies depends on the verb: 食べている is eating right now, while 結婚している is being married, not getting married. Casual speech contracts it to 〜てる.",
    example: {
      ja: "{本|ほん} を {読|よ}んで いる。",
      en: "I'm reading a book."
    }
  },
  ある: {
    gist: "Resultative — 〜てある, left in a prepared state.",
    detail:
      "Following the て-form, it says something was done deliberately and the result is still in place — the window is open because someone opened it for a reason. The contrast with 〜ている is intent: 〜てある implies a person did it on purpose.",
    example: {
      ja: "{窓|まど} が {開|あ}けて ある。",
      en: "The window has been left open."
    }
  },
  しまう: {
    gist: "Completion — finishing something, or regret.",
    detail:
      "Following the て-form, it marks an action as thoroughly finished, and very often carries regret: it happened, and that is unfortunate. Which reading applies is context; the regretful one is far more common in conversation.",
    example: {
      ja: "{全部|ぜんぶ} {食|た}べて しまった。",
      en: "I ate it all (oops)."
    }
  },
  ちゃう: {
    gist: "Completion, casual — the spoken form of 〜てしまう.",
    detail:
      "A contraction of 〜てしまう used constantly in speech, with the same finished-it or regrettably-did-it meaning. After voiced sounds it becomes じゃう. Casual, so keep it out of formal writing.",
    example: { ja: "{忘|わす}れちゃった。", en: "I forgot (oops)." }
  },
  おく: {
    gist: "In advance — doing something to be ready.",
    detail:
      "Following the て-form, it means doing something ahead of time in preparation, or leaving it in place for later. Contracts to 〜とく in casual speech. It is what you reach for when the point is that the action is groundwork for something else.",
    example: { ja: "{買|か}って おきます。", en: "I'll buy it in advance." }
  },
  くれる: {
    gist: "Someone does something for me — the sentence sits with the giver.",
    detail:
      "The giver is the subject and the favour comes toward the speaker: 友達が means the friend is the one acting. It describes the same event as もらう and differs only in vantage point, which is the hard part for English speakers — English picks one phrasing for 'a friend taught me' and Japanese asks you to choose whose side of it you are telling. くれる carries a note of gratitude, so omitting it where it belongs makes a sentence sound oddly cold. Polite: くださる.",
    example: {
      ja: "{友達|ともだち} が {教|おし}えて くれた。",
      en: "A friend taught me."
    },
    contrast: {
      ja: "{友達|ともだち} に {教|おし}えて もらった。",
      en: "I had a friend teach me.",
      note: "Same event, told from the receiver's side with もらう — 友達に, not 友達が."
    }
  },
  もらう: {
    gist: "I receive something done for me — the sentence sits with the receiver.",
    detail:
      "The receiver is the subject and the doer is marked with に. It reports the same event as くれる from the opposite vantage point: くれる makes the giver the actor, もらう makes the receiver the one who arranged or accepted it. That second reading is why もらう can imply you asked, where くれる implies it was offered. Humble: いただく, standard in polite requests.",
    example: {
      ja: "{先生|せんせい} に {教|おし}えて もらった。",
      en: "I had the teacher teach me."
    },
    contrast: {
      ja: "{先生|せんせい} が {教|おし}えて くれた。",
      en: "The teacher taught me.",
      note: "Same event with くれる — the teacher acts, rather than me receiving."
    }
  },
  あげる: {
    gist: "I do something for someone else — the favour goes outward.",
    detail:
      "The speaker acts for another person's benefit, the outward direction that completes the set with くれる and もらう. Its register is the thing to watch: narrating your own favours draws attention to them, so it can sound self-satisfied where English 'I helped him' would not. Japanese speakers often leave it out or soften it when describing what they did for someone, while using it freely when offering.",
    example: {
      ja: "{本|ほん} を {貸|か}して あげた。",
      en: "I lent them a book."
    },
    contrast: {
      ja: "{友達|ともだち} が {本|ほん} を {貸|か}して くれた。",
      en: "A friend lent me a book.",
      note: "Reverse the direction and it becomes くれる — the favour now arrives."
    }
  }
};

/**
 * Conjugation-form notes, keyed by the label `conjugate()` produces.
 *
 * The gists are the hints previously living in `Term.tsx`'s GLOSSARY, which the user singled out as
 * bringing clarity — kept verbatim so that review does not have to re-litigate approved wording, and
 * extended with detail + example.
 */
export const FORM_NOTES: Record<string, GrammarNote | undefined> = {
  "Non-past": {
    gist: "Present and future in one form — 'eat(s)' or 'will eat'. Plain style, used with friends and in most writing.",
    detail:
      "Japanese does not separate present from future: context or a time word does that work. This is the dictionary form, so it is also what you look a verb up by. Plain style, so it suits friends, family, and most writing.",
    example: {
      ja: "{毎|まい} {日本|にっぽん} を {読|よ}む。",
      en: "I read a book every day."
    }
  },
  "Non-past (polite)": {
    gist: "The 〜ます/〜です style — the safe default with strangers, coworkers, and customers.",
    detail:
      "The same present-and-future meaning at a polite register. If you are unsure which level to use, this is the one that is never wrong with someone you do not know well.",
    example: {
      ja: "{毎|まい} {日本|にっぽん} を {読|よ}みます。",
      en: "I read a book every day."
    }
  },
  Past: {
    gist: "Plain past, for casual speech and writing.",
    detail:
      "Marks the action as completed. Plain style; with strangers or at work you would use the polite past instead. Narrative writing stays in this form throughout.",
    example: {
      ja: "{昨|さく} {日本|にっぽん} を {読|よ}んだ。",
      en: "I read a book yesterday."
    }
  },
  "Past (polite)": {
    gist: "Polite past (〜ました/〜でした).",
    detail:
      "The completed action at a polite register — the past you want when speaking to strangers, coworkers, or customers.",
    example: {
      ja: "{昨|さく} {日本|にっぽん} を {読|よ}みました。",
      en: "I read a book yesterday."
    }
  },
  "Te-form": {
    gist: "The connector — chains actions (食べて寝る), makes requests (〜てください), and builds the continuous (〜ている).",
    detail:
      "The most versatile form in the language: it links clauses, and it is the base almost every compound construction attaches to. It carries no tense itself, taking that from whatever ends the sentence. Learning its sound changes pays off immediately.",
    example: { ja: "{食|た}べて {寝|ね}ます。", en: "I'll eat and then sleep." }
  },
  Potential: {
    gist: "Can do — ability or possibility.",
    detail:
      "Says the action is possible, whether through skill or circumstance. The thing you are able to do is usually marked with が rather than を. In casual speech ichidan potentials often drop the ら (食べれる).",
    example: {
      ja: "{日本語|にほんご} が {話|はな}せます。",
      en: "I can speak Japanese."
    }
  },
  Passive: {
    gist: "Is done (to someone) — also doubles as an honorific in formal speech.",
    detail:
      "The action is received rather than performed. Japanese uses it more freely than English, including for things that happened to the speaker's inconvenience. In formal speech the same form serves as a respectful way to describe someone else's actions.",
    example: {
      ja: "{先生|せんせい} に {名前|なまえ} を {呼|よ}ばれた。",
      en: "My name was called by the teacher."
    }
  },
  Causative: {
    gist: "Make or let someone do.",
    detail:
      "Someone causes another to act. Whether it reads as making or letting depends on context and particle — に leans permissive, を coercive. Its request form (〜させてください) is a common polite way to ask permission.",
    example: {
      ja: "{子供|こども} に {本|ほん} を {読|よ}ませる。",
      en: "I'll have the child read a book."
    }
  },
  Imperative: {
    gist: "Blunt command — strong. Mostly signs, emergencies, and rough speech; prefer 〜てください.",
    detail:
      "A direct order with no softening at all. Outside signage, emergencies, coaching, and deliberately rough speech it will sound aggressive. For ordinary requests use the て-form with ください.",
    example: { ja: "{止|と}まれ。", en: "Stop." }
  },
  Volitional: {
    gist: "Let's / shall we; with と思う it means 'I think I'll…'.",
    detail:
      "Proposes an action, either to others or to yourself. The polite equivalent is 〜ましょう. Followed by と思う it reports an intention you have just formed, which is the usual way to say what you plan to do.",
    example: {
      ja: "{一緒|いっしょ} に {行|い}こう。",
      en: "Let's go together."
    }
  },
  "Conditional (〜ば)": {
    gist: "If — the general or logical condition.",
    detail:
      "States a condition and its consequence in general terms, which makes it the natural fit for rules, advice, and hypotheticals. It is more abstract than 〜たら, which tends to describe a specific occasion.",
    example: {
      ja: "{安|やす}けれ ば {買|か}います。",
      en: "If it's cheap, I'll buy it."
    }
  },
  "Conditional (〜たら)": {
    gist: "If / when — the most common conditional in conversation.",
    detail:
      "Covers both if and when, and is the conditional you will hear most in speech. It is comfortable with one-off, concrete situations, where 〜ば sounds too much like stating a rule. It can also introduce a discovery — doing one thing and finding another.",
    example: {
      ja: "{家|いえ} に {帰|かえ}ったら {電話|でんわ}します。",
      en: "I'll call when I get home."
    }
  },
  "Desire (〜たい)": {
    gist: "Want to — the result conjugates like an い-adjective (食べたくない).",
    detail:
      "Expresses the speaker's own wish to do something. Because it conjugates as an い-adjective, its negative and past follow adjective patterns rather than verb ones. Stating another person's desires this way sounds presumptuous.",
    example: {
      ja: "{日本|にっぽん} に {行|い}きたいです。",
      en: "I want to go to Japan."
    }
  },
  Adverbial: {
    gist: "The 〜く form — turns the adjective into an adverb (早く → quickly).",
    detail:
      "Turns an い-adjective into a description of how an action is done. It is also the form that combines with なる to express change — 高くなる, to become expensive. な-adjectives use に for the same job.",
    example: { ja: "{早|はや}く {起|お}きます。", en: "I get up early." }
  },
  Conditional: {
    gist: "If / when (〜なら) — often 'as for…, then…'.",
    detail:
      "Takes up something just raised and responds to it: given that, here is what follows. That contextual quality is what separates it from the other conditionals — it usually reacts to what someone has said rather than stating a condition cold.",
    example: {
      ja: "{日本|にっぽん} に {行|い}くなら、{京都|きょうと} が いいです。",
      en: "If you're going to Japan, Kyoto is good."
    }
  }
};

/** An example with its ruby markup resolved to plain text: `{本|ほん} を` → `本 を`. */
export const exampleSurface = (ja: string): string =>
  ja.replace(/\{([^|{}]+)\|[^{}]+\}/gu, "$1");

/** The same example as its full kana reading: `{本|ほん} を` → `ほん を`. */
export const exampleReading = (ja: string): string =>
  ja.replace(/\{[^|{}]+\|([^{}]+)\}/gu, "$1");

/**
 * Render a note as hover Markdown: heading, gist, detail, then each example over two lines — the
 * sentence, and its reading beneath it.
 *
 * Two lines rather than `<ruby>` furigana, which VS Code CAN render but not legibly. A probe against
 * a live hover measured `<rt>` at 7px against a 14px body (the CSS default of 50%), and found that
 * VS Code's sanitizer strips `style` attributes — so an extension has no way to enlarge it. Ruby was
 * the better-looking option and the unreadable one; a second line at full body size trades exact
 * per-kanji alignment for kana a learner can actually read.
 *
 * The data keeps its ruby markup regardless: it is the honest source of truth, it drives the webview
 * (whose own CSS has no such limit), and it makes this reversible if VS Code ever allows styling.
 */
export const noteToMarkdown = (heading: string, note: GrammarNote): string => {
  const example = (ex: { ja: string; en: string }): string =>
    `${exampleSurface(ex.ja)} — ${ex.en}  \n${exampleReading(ex.ja)}`;
  return [
    `**${heading}** — ${note.gist}`,
    note.detail,
    example(note.example),
    ...(note.contrast === undefined
      ? []
      : [`${example(note.contrast)}  \n${note.contrast.note}`])
  ].join("\n\n");
};

/**
 * One-word auxiliary labels for the compact breakdown chain (食べる + 〜たい (want to) + …).
 *
 * Lives here rather than in `hover.ts` so the chain labels and the full notes have one home: every
 * key must have an `AUXILIARY_NOTES` entry, which a unit test enforces.
 */
export const AUX_GLOSS: Record<string, string | undefined> = {
  た: "past",
  だ: "copula",
  です: "polite copula",
  ます: "polite",
  ない: "negation",
  ん: "negation",
  ぬ: "negation",
  たい: "want to",
  て: "connective",
  で: "connective",
  れる: "passive/potential",
  られる: "passive/potential",
  せる: "causative",
  させる: "causative",
  う: "volitional",
  よう: "volitional",
  まい: "negative volitional",
  そう: "appearance",
  そうだ: "appearance/hearsay",
  ようだ: "seeming",
  らしい: "apparently",
  いる: "continuous",
  ある: "resultative",
  しまう: "completion",
  ちゃう: "completion (casual)",
  おく: "in advance",
  くれる: "for me",
  もらう: "receiving",
  あげる: "giving"
};
