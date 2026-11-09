import { useSyncExternalStore } from "react";
import { getDictionaryStatus, onDictionaryStatus } from "./bridge";
import type { DictionaryStatusPush } from "../shared/messages";

/**
 * Both dictionaries' state, re-rendering the caller when it changes.
 *
 * The bridge keeps the latest snapshot and replaces it on each push, so every consumer reads the same
 * object identity until something actually changes — which is what keeps `getSnapshot` stable.
 */
export const useDictionaryStatus = (): Omit<DictionaryStatusPush, "type"> =>
  useSyncExternalStore(onDictionaryStatus, getDictionaryStatus);
