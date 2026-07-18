/**
 * The webview side of the host bridge. Correlates each outgoing `Request` with the matching
 * `Response` by `requestId` and resolves a promise — which the TanStack Query layer consumes as a
 * `queryFn`. This is the *only* place `postMessage`/`onmessage` is touched.
 */
import type {
  GetAboutResponse,
  GetKanjiResponse,
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
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

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

export const searchWords = async (query: string): Promise<SearchResponse> => {
  const response = await send({
    type: "search",
    requestId: nextRequestId(),
    query
  });
  if (response.type !== "search")
    throw new Error("Unexpected response for search");
  return response;
};

export const getWord = async (id: string): Promise<GetWordResponse> => {
  const response = await send({
    type: "getWord",
    requestId: nextRequestId(),
    id
  });
  if (response.type !== "getWord")
    throw new Error("Unexpected response for getWord");
  return response;
};

export const getKanji = async (literal: string): Promise<GetKanjiResponse> => {
  const response = await send({
    type: "getKanji",
    requestId: nextRequestId(),
    literal
  });
  if (response.type !== "getKanji")
    throw new Error("Unexpected response for getKanji");
  return response;
};

export const getStrokeSvg = async (
  literal: string
): Promise<GetStrokeSvgResponse> => {
  const response = await send({
    type: "getStrokeSvg",
    requestId: nextRequestId(),
    literal
  });
  if (response.type !== "getStrokeSvg")
    throw new Error("Unexpected response for getStrokeSvg");
  return response;
};

export const getComponentTree = async (
  literal: string
): Promise<GetComponentTreeResponse> => {
  const response = await send({
    type: "getComponentTree",
    requestId: nextRequestId(),
    literal
  });
  if (response.type !== "getComponentTree")
    throw new Error("Unexpected response for getComponentTree");
  return response;
};

export const lookupRadicals = async (
  selected: string[]
): Promise<LookupRadicalsResponse> => {
  const response = await send({
    type: "lookupRadicals",
    requestId: nextRequestId(),
    selected
  });
  if (response.type !== "lookupRadicals")
    throw new Error("Unexpected response for lookupRadicals");
  return response;
};

export const getAbout = async (): Promise<GetAboutResponse> => {
  const response = await send({ type: "getAbout", requestId: nextRequestId() });
  if (response.type !== "getAbout")
    throw new Error("Unexpected response for getAbout");
  return response;
};

export const searchNames = async (
  query: string
): Promise<SearchNamesResponse> => {
  const response = await send({
    type: "searchNames",
    requestId: nextRequestId(),
    query
  });
  if (response.type !== "searchNames")
    throw new Error("Unexpected response for searchNames");
  return response;
};

export const getName = async (id: string): Promise<GetNameResponse> => {
  const response = await send({
    type: "getName",
    requestId: nextRequestId(),
    id
  });
  if (response.type !== "getName")
    throw new Error("Unexpected response for getName");
  return response;
};

/** Ask the host to open VS Code's Settings UI at the Jisho section (the sidebar's ⚙). */
export const openSettings = async (): Promise<void> => {
  await send({ type: "openSettings", requestId: nextRequestId() });
};
