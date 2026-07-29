/**
 * Types for the vendored `lindera-nodejs` loader shim — just the surface the extension uses. The
 * shim re-exports the NAPI binding, whose generated `.d.ts` isn't published (the package ships
 * broken; see ../../docs/specs/14), so we declare the shape here.
 *
 * A `lindera-nodejs` Token exposes its fields as GETTERS (napi class instance), and the IPADIC
 * feature data is a positional `details` array, NOT flat fields:
 *   details = [POS, subcat1, subcat2, subcat3, conjType, conjForm, baseForm, reading, pronunciation]
 * "*" marks an absent field. `tokenizer.ts` reads lemma/POS/reading out of these indices.
 */
export class Token {
  readonly surface: string;
  /** Positional IPADIC feature array (see the index map above); entries may be "*". */
  readonly details: string[];
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly isUnknown: boolean;
}
export class Dictionary {
  private constructor();
  private readonly __brand: "Dictionary";
}
export class UserDictionary {
  private constructor();
  private readonly __brand: "UserDictionary";
}
/** Dictionary metadata; the no-arg form supplies the defaults a user dictionary needs. */
export class Metadata {
  constructor(name?: string | null, encoding?: string | null);
}
export class Tokenizer {
  constructor(
    dictionary: Dictionary,
    mode?: string,
    userDictionary?: UserDictionary | null
  );
  tokenize(text: string): Token[];
}
export function loadDictionary(uri: string): Dictionary;
export function loadUserDictionary(
  uri: string,
  metadata: Metadata
): UserDictionary;
export function version(): string;
