/**
 * Ambient fallback so the CLI typecheck (`vp check`) accepts CSS Module imports. The editor's
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
