/**
 * Bundle entry for the benchmark build.
 *
 * deoptkit profiles BUILT output on purpose: bundling changes object shapes and inlining, so
 * findings against source would describe code that never ships. This re-exports the recognizer so
 * `bench/*.bench.mjs` can import one built artifact rather than reaching into `src/`.
 */
export { recognize } from "../src/webview/recognizer/index";
export { refPatterns } from "../src/webview/recognizer/patterns";
