/**
 * Ambient declarations for non-TS imports Vite resolves (CSS Modules, `?raw` assets).
 *
 * The CSS Module fallback exists so the CLI typecheck (`vp check`) accepts them; the editor's
 * `typescript-plugin-css-modules` provides more precise per-file class-name types that shadow this.
 */
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

/** Plain CSS imported for its side effect (global styles). */
declare module "*.css" {
  const css: string;
  export default css;
}

/**
 * Vite's `?raw` suffix: import a file's contents as a string. Used by the browser-mode tests to load
 * a real stroke SVG — they run in Chromium, so the file has to come through the bundler rather than
 * `readFileSync`.
 */
declare module "*?raw" {
  const contents: string;
  export default contents;
}
