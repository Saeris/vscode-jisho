/**
 * The webview side of the host bridge. Correlates each outgoing `Request` with the matching
 * `Response` by `requestId` and resolves a promise — which the TanStack Query layer consumes as a
 * `queryFn`. This is the *only* place `postMessage`/`onmessage` is touched.
 */
import type {
  GetAboutResponse,
  GetKanjiResponse,
  GetMoreExamplesResponse,
  GetNameResponse,
  GetComponentTreeResponse,
  GetStrokeSvgResponse,
  GetWordResponse,
  HostPush,
  HostSettings,
  LookupRadicalsResponse,
  Request,
  Response,
  SearchNamesResponse,
  SearchResponse
} from "../shared/messages";

interface VsCodeApi {
  postMessage(message: unknown): void;
  /**
   * The ONLY way webview state survives the sidebar being hidden.
   *
   * VS Code deallocates a `WebviewView`'s document when its container is collapsed or the user
   * switches activity-bar containers, then recreates it on the way back — and unlike a
   * `WebviewPanel`, a view has no `retainContextWhenHidden` to opt out of that. (The typings' own
   * `WebviewViewResolveContext` doc points at `WebviewOptions.retainContextWhenHidden`, which does
   * not exist; that error is why the advice online contradicts itself.) State written here outlives
   * the document, so it is what a reopened sidebar reads to rebuild itself.
   */
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

/** Read the persisted webview state, or undefined when there is none (a first, cold open). */
export const readPersistedState = (): unknown => vscode.getState();

/** Persist webview state across the document being deallocated. Cheap; called on every navigation. */
export const persistState = (state: unknown): void => {
  vscode.setState(state);
};

let nextId = 0;
const pending = new Map<string, (response: Response) => void>();

/** Subscribers to host-initiated pushes (editor commands). */
const pushHandlers = new Set<(push: HostPush) => void>();

/** Subscribe to host pushes; returns the unsubscribe. */
export const onHostPush = (handler: (push: HostPush) => void): (() => void) => {
  pushHandlers.add(handler);
  return (): void => {
    pushHandlers.delete(handler);
  };
};

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
    for (const handler of pushHandlers) handler(message);
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

const isResponse = (value: unknown): value is Response =>
  typeof value === "object" &&
  value !== null &&
  "requestId" in value &&
  typeof value.requestId === "string" &&
  "type" in value;

/**
 * Post a fully-formed request (its `requestId` already set) and await the correlated response.
 * Rejects on an `error` response. Callers narrow the returned `Response` by its `type`.
 */
const send = async (request: Request): Promise<Response> =>
  new Promise<Response>((resolve, reject) => {
    pending.set(request.requestId, (response) => {
      if (response.type === "error") reject(new Error(response.message));
      else resolve(response);
    });
    vscode.postMessage(request);
  });

const nextRequestId = (): string => `r${nextId++}`;

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
  payload: Omit<Extract<Request, { type: T }>, "type" | "requestId">
): Promise<Extract<Response, { type: T }>> => {
  // Two assertions, both confined here rather than repeated at ten call sites — the same trade as
  // `Dictionary`'s typed read helpers. TypeScript cannot prove that spreading `payload` onto a `type`
  // reconstitutes the matching union member, nor that a response whose `type` equals `T` is that
  // member; the runtime check on the next line is what actually establishes the second.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const response = await send({
    type,
    requestId: nextRequestId(),
    ...payload
  } as Request);
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

export const getAbout = async (): Promise<GetAboutResponse> =>
  request("getAbout", {});

export const searchNames = async (
  query: string
): Promise<SearchNamesResponse> => request("searchNames", { query });

export const getName = async (id: string): Promise<GetNameResponse> =>
  request("getName", { id });

/** Ask the host to open VS Code's Settings UI at the Jisho section (the sidebar's ⚙). */
export const openSettings = async (): Promise<void> => {
  await send({ type: "openSettings", requestId: nextRequestId() });
};

/**
 * Put text on the clipboard via the host. Rejects (through the error response) when the write
 * fails, so callers can report it rather than silently claiming success.
 */
export const copyText = async (text: string): Promise<void> => {
  await send({ type: "copyText", requestId: nextRequestId(), text });
};
