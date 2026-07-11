/**
 * Minimal ambient types for `lindera-wasm-nodejs-ipadic` — just the surface we use. The package
 * ships its own generated `.d.ts`, but its `tokenize` returns `any`; declaring the token shape
 * here lets `import()` be typed without a cast at the call site.
 */
declare module "lindera-wasm-nodejs-ipadic" {
  export interface LinderaToken {
    surface: string;
    baseForm: string;
    reading: string;
    partOfSpeech: string;
    partOfSpeechSubcategory1: string;
  }
  export class Tokenizer {
    tokenize(text: string): LinderaToken[];
  }
  export class TokenizerBuilder {
    setDictionary(uri: string): void;
    setMode(mode: string): void;
    build(): Tokenizer;
  }
}
