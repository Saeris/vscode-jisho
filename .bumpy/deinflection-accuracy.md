---
vscode-jisho: patch
---

Searching a conjugated word now surfaces the right verb. Previously typing an inflected form could bury the intended word under grammatically-impossible matches — searching して (the te-form of する) returned 仕手 / 知る / 汁 above 為る. Deinflection now checks that each candidate's part of speech actually fits the conjugation, so the noise is gone. Conjugated する-verbs (勉強した → 勉強) and kanji-written 来る (来た → 来る) resolve correctly too.
