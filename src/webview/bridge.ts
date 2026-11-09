/**
 * The webview side of the host bridge. Correlates each outgoing `Request` with the matching
 * `Response` by `requestId` and resolves a promise — which the TanStack Query layer consumes as a
 * `queryFn`. This is the *only* place `postMessage`/`onmessage` is touched.
 */
import type {
  DictionaryErrorCode,
  DictionaryStatusPush,
  GetAboutResponse,
  BrowseResponse,
  KanjiListResponse,
  BrowseCountsResponse,
  GetKanjiResponse,
  GetMoreExamplesResponse,
  GetNameResponse,
  GetComponentTreeResponse,
  GetStrokeSvgResponse,
  GetWordResponse,
  HostPush,
  HostSettings,
  GetKanjiPreviewsResponse,
  GetDiagnosticsResponse,
  LookupRadicalsResponse,
  ClearRecentSearchesResponse,
  GetRecentSearchesResponse,
  RecordRecentSearchResponse,
  Request,
  Response,
  SearchNamesResponse,
  SearchResponse
} from "../shared/messages";

interface VsCodeApi {
  postMessage(message: unknown): void;
  /**
   * The only way webview state survives the document being recreated.
   *
   * The sidebar keeps its context when hidden (`retainContextWhenHidden`, set where the view is
   * registered), so collapsing it no longer destroys the document. But a VS Code restart or a window
   * reload still does, and state written here outlives that — it is what a reopened sidebar reads to
   * rebuild itself.
   *
   * (This used to say a view CANNOT retain its context. It can: the option is on
   * `registerWebviewViewProvider`'s `webviewOptions`, not on `WebviewOptions`, which is where the
   * claim looked. Audit I-14.)
   */
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

/** Read the persisted webview state, or undefined when there is none (a first, cold open). */
export const readPersistedState = (): unknown => vscode.getState();

/** Persist webview state across the document being recreated. Cheap; called on every navigation. */
export const persistState = (state: unknown): void => {
  vscode.setState(state);
};

const pending = new Map<string, (response: Response) => void>();

/** Subscribers to host-initiated pushes (editor commands). */
const pushHandlers = new Set<(push: HostPush) => void>();
/**
 * Pushes that arrived before anything subscribed.
 *
 * `webviewReady` is posted while this module first evaluates, and the host answers it by delivering
 * any editor command it held — but `App` subscribes from an effect, after React's first commit. Four
 * cold launches all happened to subscribe first; nothing guaranteed it (audit SM-3). Held here, a
 * command that arrives early is delivered on subscribe instead of to nobody.
 */
const earlyPushes: HostPush[] = [];

/** Subscribe to host pushes; returns the unsubscribe. Delivers any that arrived before it. */
export const onHostPush = (handler: (push: HostPush) => void): (() => void) => {
  pushHandlers.add(handler);
  for (const push of earlyPushes.splice(0)) handler(push);
  return (): void => {
    pushHandlers.delete(handler);
  };
};

/** Both dictionaries' state, as last pushed — readable at any time, not only when it changes. */
let dictionaryStatus: Omit<DictionaryStatusPush, "type"> = {
  words: { state: "absent" },
  names: { state: "absent" }
};
const statusHandlers = new Set<() => void>();

/** The dictionaries' current state. For `useSyncExternalStore`. */
export const getDictionaryStatus = (): Omit<DictionaryStatusPush, "type"> =>
  dictionaryStatus;

/** Subscribe to dictionary state changes; returns the unsubscribe. */
export const onDictionaryStatus = (handler: () => void): (() => void) => {
  statusHandlers.add(handler);
  return (): void => {
    statusHandlers.delete(handler);
  };
};

/**
 * A request the host refused, with the dictionary's state as the reason when that is the cause — so
 * a view can offer the recovery that fits instead of a report.
 */
export class HostError extends Error {
  readonly code: DictionaryErrorCode | undefined;

  constructor(message: string, code?: DictionaryErrorCode) {
    super(message);
    this.name = "HostError";
    this.code = code;
  }
}

/** Subscribers to host settings snapshots (initial + on every Settings-UI edit). */
const settingsHandlers = new Set<
  (settings: HostSettings["settings"]) => void
>();

/** Subscribe to settings snapshots; returns the unsubscribe. */
export const onHostSettings = (
  handler: (settings: HostSettings["settings"]) => void
): (() => void) => {
  settingsHandlers.add(handler);
  return (): void => {
    settingsHandlers.delete(handler);
  };
};

// `event.data` is whatever the host posted; validate its shape before trusting it.
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (isHostPush(message)) {
    if (pushHandlers.size === 0) earlyPushes.push(message);
    for (const handler of pushHandlers) handler(message);
    return;
  }
  if (isDictionaryStatus(message)) {
    dictionaryStatus = { words: message.words, names: message.names };
    for (const handler of statusHandlers) handler();
    return;
  }
  if (isHostSettings(message)) {
    for (const handler of settingsHandlers) handler(message.settings);
    return;
  }
  if (!isResponse(message)) return;
  const resolve = pending.get(message.requestId);
  if (resolve) {
    pending.delete(message.requestId);
    resolve(message);
  }
});

// Tell the host the bridge is listening — it queues editor-command pushes until this arrives.
vscode.postMessage({ type: "webviewReady" });

const isHostPush = (value: unknown): value is HostPush =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  value.type === "hostPush" &&
  "action" in value &&
  "text" in value &&
  typeof value.text === "string";

const isHostSettings = (value: unknown): value is HostSettings =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  value.type === "hostSettings" &&
  "settings" in value;

const isDictionaryStatus = (value: unknown): value is DictionaryStatusPush =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  value.type === "dictionaryStatus" &&
  "words" in value &&
  "names" in value;

const isResponse = (value: unknown): value is Response =>
  typeof value === "object" &&
  value !== null &&
  "requestId" in value &&
  typeof value.requestId === "string" &&
  "type" in value;

/**
 * How long a request waits for an answer before it gives up.
 *
 * A backstop, not a deadline anything should reach: the host answers a request at once when the
 * dictionary is not ready, and holds answers for a hidden panel rather than dropping them. It exists
 * because a lost answer used to leave its query pending forever — a search that never ended (audit
 * SM-3). Installing the names dictionary waits through a download, so it passes no limit.
 */
const ANSWER_TIMEOUT_MS = 60_000;

/**
 * Post a fully-formed request (its `requestId` already set) and await the correlated response.
 * Rejects on an `error` response, or when no answer arrives in time. Callers narrow the returned
 * `Response` by its `type`.
 */
const send = async (
  request: Request,
  { untimed = false }: { untimed?: boolean } = {}
): Promise<Response> =>
  new Promise<Response>((resolve, reject) => {
    const timer = untimed
      ? undefined
      : setTimeout(() => {
          pending.delete(request.requestId);
          reject(new HostError("Jisho did not answer. Try again."));
        }, ANSWER_TIMEOUT_MS);
    pending.set(request.requestId, (response) => {
      clearTimeout(timer);
      if (response.type === "error")
        reject(new HostError(response.message, response.code));
      else resolve(response);
    });
    vscode.postMessage(request);
  });

/**
 * A request id that cannot repeat across document lifetimes.
 *
 * A counter restarts at zero whenever the webview document is recreated, so an answer meant for an
 * earlier document could resolve a different request of the same type in the new one. Random ids
 * make a stray answer simply unmatched.
 */
const nextRequestId = (): string => crypto.randomUUID();

/**
 * Send a request and return the response of the matching type.
 *
 * Ten call sites wrote out the same three steps: send, assert the response type, return it. The type
 * guard is not ceremony — `send` resolves to the whole `Response` union, and narrowing it is what
 * makes each caller's return type sound — so this keeps the guard and removes only the copy. Extra
 * request fields are passed as `payload` rather than spread by the caller, so `requestId` cannot be
 * forgotten or supplied twice.
 */
const request = async <T extends Request["type"]>(
  type: T,
  payload: Omit<Extract<Request, { type: T }>, "type" | "requestId">,
  options: { untimed?: boolean } = {}
): Promise<Extract<Response, { type: T }>> => {
  // Two assertions, both confined here rather than repeated at ten call sites — the same trade as
  // `Dictionary`'s typed read helpers. TypeScript cannot prove that spreading `payload` onto a `type`
  // reconstitutes the matching union member, nor that a response whose `type` equals `T` is that
  // member; the runtime check on the next line is what actually establishes the second.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const message = { type, requestId: nextRequestId(), ...payload } as Request;
  const response = await send(message, options);
  if (response.type !== type) {
    throw new Error(`Unexpected response for ${type}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return response as Extract<Response, { type: T }>;
};

export const searchWords = async (query: string): Promise<SearchResponse> =>
  request("search", { query });

export const getWord = async (id: string): Promise<GetWordResponse> =>
  request("getWord", { id });

export const getMoreExamples = async (
  id: string
): Promise<GetMoreExamplesResponse> => request("getMoreExamples", { id });

export const browse = async (
  id: string,
  order: "frequency" | "gojuon"
): Promise<BrowseResponse> => request("browse", { id, order });

export const kanjiList = async (id: string): Promise<KanjiListResponse> =>
  request("kanjiList", { id });

export const browseCounts = async (
  applied: string[] = []
): Promise<BrowseCountsResponse> => request("browseCounts", { applied });

export const getKanji = async (literal: string): Promise<GetKanjiResponse> =>
  request("getKanji", { literal });

export const getStrokeSvg = async (
  literal: string
): Promise<GetStrokeSvgResponse> => request("getStrokeSvg", { literal });

export const getComponentTree = async (
  literal: string
): Promise<GetComponentTreeResponse> =>
  request("getComponentTree", { literal });

export const lookupRadicals = async (
  selected: string[]
): Promise<LookupRadicalsResponse> => request("lookupRadicals", { selected });

export const getKanjiPreviews = async (
  literals: string[]
): Promise<GetKanjiPreviewsResponse> =>
  request("getKanjiPreviews", { literals });

export const getAbout = async (): Promise<GetAboutResponse> =>
  request("getAbout", {});

export const searchNames = async (
  query: string
): Promise<SearchNamesResponse> => request("searchNames", { query });

export const getName = async (id: string): Promise<GetNameResponse> =>
  request("getName", { id });

/** Install the names dictionary (the user accepted). Resolves once it is downloaded and opened. */
export const installNames = async (): Promise<void> => {
  // Untimed: it waits through an ~85 MB download on purpose — the user asked for it.
  await request("installNames", {}, { untimed: true });
};

/** Ask the host for the recovery a dictionary failure needs — see `DictionaryActionRequest`. */
export const dictionaryAction = async (
  action: "retry" | "update" | "updateJisho"
): Promise<void> => {
  await request("dictionaryAction", { action });
};

/** Decline the names offer under search results. Remembered across windows; About still offers it. */
export const declineNames = async (): Promise<void> => {
  await request("declineNames", {});
};

/** Ask the host to open VS Code's Settings UI at the Jisho section (the sidebar's ⚙). */
export const openSettings = async (): Promise<void> => {
  await send({ type: "openSettings", requestId: nextRequestId() });
};

/**
 * File a crash report, with the stack already sanitized on this side.
 *
 * Sanitized HERE rather than in the host so the user's directory layout never crosses the bridge at
 * all — it cannot then end up in a host log on its way to being scrubbed.
 */
export const getDiagnostics = async (): Promise<GetDiagnosticsResponse> =>
  request("getDiagnostics", {});

export const reportCrash = async (
  message: string,
  stack?: string
): Promise<void> => {
  await send({
    type: "reportCrash",
    requestId: nextRequestId(),
    message,
    stack
  });
};

/**
 * Put text on the clipboard via the host. Rejects (through the error response) when the write
 * fails, so callers can report it rather than silently claiming success.
 */
export const copyText = async (text: string): Promise<void> => {
  await send({ type: "copyText", requestId: nextRequestId(), text });
};

/**
 * Recent-search history (#17). All three reply with the full list, so a record or a clear updates
 * the cache directly and needs no follow-up fetch.
 */
export const getRecentSearches = async (): Promise<GetRecentSearchesResponse> =>
  request("getRecentSearches", {});

export const recordRecentSearch = async (
  query: string,
  headword: string
): Promise<RecordRecentSearchResponse> =>
  request("recordRecentSearch", { query, headword });

export const clearRecentSearches =
  async (): Promise<ClearRecentSearchesResponse> =>
    request("clearRecentSearches", {});
