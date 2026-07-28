/**
 * ESM wrapper over `index.cjs` (the platform-loader shim for the broken `lindera-nodejs` package).
 * Named re-exports so our ESM code imports directly — no `createRequire` (see index.cjs / spec 14).
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const binding = require("./index.cjs");

export const {
  Dictionary,
  Metadata,
  Schema,
  Token,
  Tokenizer,
  TokenizerBuilder,
  UserDictionary,
  loadDictionary,
  loadUserDictionary,
  buildDictionary,
  buildUserDictionary,
  version
} = binding;
