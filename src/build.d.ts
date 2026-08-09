/**
 * Constants replaced at build time by the `define` in vite.config.ts.
 *
 * Declared globally because both bundles get the same substitution — the host through tsdown, the
 * webview through Vite — and a crash report has to name one build whichever side raised it.
 */

/** The short commit this bundle was built from, or `"dev"` outside a git checkout. */
declare const __JISHO_COMMIT__: string;
