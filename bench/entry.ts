/**
 * Bundle entry for the benchmark build.
 *
 * deoptkit profiles BUILT output on purpose: bundling changes object shapes and inlining, so
 * findings against source would describe code that never ships. This re-exports the recognizer so
 * `bench/*.bench.mjs` can import one built artifact rather than reaching into `src/`.
 */
export { recognize } from "../src/webview/recognizer/index";
export { refPatterns } from "../src/webview/recognizer/patterns";
export {
  addFuriganaToLine,
  removeFuriganaFromLine
} from "../src/host/furigana";
export { addSpacingToLine } from "../src/host/spacing";
// Tokenizer + the highlight-walk helpers, for the tokenization deopt profile. `segment` loads its
// WASM lazily on first call, so importing this is cheap until the profile actually tokenizes.
export { segment } from "../src/host/tokenizer";
export { japaneseRuns, stripRuby } from "../src/host/hover";
export { deinflect } from "../src/host/deinflect";
