/**
 * Ambient types for the vendored `lindera-nodejs` loader shim (`vendor/lindera-nodejs`) — just the
 * surface we use. The shim re-exports the NAPI binding, whose generated `.d.ts` isn't published
 * (the package ships broken; see docs/specs/14). Declaring the shape here types the import.
 *
 * A `lindera-nodejs` Token exposes its fields as GETTERS (napi class instance), and the IPADIC
 * feature data is a positional `details` array, NOT flat fields like the old WASM binding:
 *   details = [POS, subcat1, subcat2, subcat3, conjType, conjForm, baseForm, reading, pronunciation]
 * `*` marks an absent field. `tokenizer.ts` reads lemma/POS/reading out of these indices.
 */
declare module "*vendor/lindera-nodejs/index.mjs" {
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
  }
  export class UserDictionary {
    private constructor();
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
    metadata: unknown
  ): UserDictionary;
  export function version(): string;
}
