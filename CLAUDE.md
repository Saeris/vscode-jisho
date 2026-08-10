# General Rules of Contribution

These rules apply to every task in this project unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

## Rule 1 — Think Before Coding

- State assumptions explicitly. If uncertain, ask rather than guess
- Present multiple interpretations when ambiguity exists
- Push back when a simpler approach exists
- Stop when confused. Name what's unclear

## Rule 2 — Simplicity First

- Minimum code that solves the problem. Nothing speculative
- No features beyond what was asked. No abstractions for single-use code
- Test: would a senior engineer say this is overcomplicated? If yes, simplify

## Rule 3 — Surgical Changes

- Touch only what you must. Clean up only your own mess
- Don't "improve" adjacent code, comments, or formatting
- Don't refactor what isn't broken. Match existing style

## Rule 4 — Goal-Driven Execution

- Define success criteria. Loop until verified
- Don't follow steps. Define success and iterate
- Strong success criteria let you loop independently

## Rule 5 — Use the model only for judgment calls

- Use me for: classification, drafting, summarization, extraction
- Do NOT use me for: routing, retries, deterministic transforms
- If code can answer, code answers

## Rule 6 — Surface conflicts, don't average them

- If two patterns contradict, pick one (more recent / more tested)
- Explain why. Flag the other for cleanup
- Don't blend conflicting patterns

## Rule 7 — Read before you write

- Before adding code, read exports, immediate callers, shared utilities
- "Looks orthogonal" is dangerous. If unsure why code is structured a way, ask

## Rule 8 — Tests verify intent, not just behavior

- Tests must encode WHY behavior matters, not just WHAT it does
- A test that can't fail when business logic changes is wrong

## Rule 9 — Checkpoint after every significant step

- Summarize what was done, what's verified, what's left
- Don't continue from a state you can't describe back
- If you lose track, stop and restate

## Rule 10 — Match the codebase's conventions, even if you disagree

- Conformance > taste inside the codebase
- If you genuinely think a convention is harmful, surface it. Don't fork silently

## Rule 11 — Fail loud

- "Completed" is wrong if anything was skipped silently
- "Tests pass" is wrong if any were skipped
- Default to surfacing uncertainty, not hiding it

## Rule 12 - Research when you repeatedly hit a wall

- Probing isn't always the most efficient way to find answers
- When drilling deep doesn't yield results, that is a signal to step back and research online
- More likely than not, someone else has encountered the same problem before and has documented it

## Rule 13 - Soft-wrap prose

- Applies to code comments, markdown files, commit messages and GitHun Issue/PR bodies
- If you encounter hard-wrapped prose, you have permission to clean it up

## Rule 14 - Speak in plain terms

- Use ASD-STE100 aka Simplified Technical English in your writing and responses
- Follow Zinsser's four principles of quality writing:
  - **Clarity**: Clear writing is the product of clear thinking. If a sentence is muddled or confusing, it means the underlying idea is not yet fully understood by the writer.
  - **Simplicity**: Avoid jargon, bloated phrasing, and pompous language. Strip every sentence down to its cleanest components and use plain, straightforward words.
  - **Brevity**: Every word must earn its place. Ruthlessly cut clutter, redundant adverbs, and unnecessary modifiers that do no useful work.
  - **Humanity**: Let your personality and voice show. Write with warmth, honesty, and a conversational tone rather than hiding behind a cold, robotic corporate or academic facade.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.

<!--VITE PLUS END-->
