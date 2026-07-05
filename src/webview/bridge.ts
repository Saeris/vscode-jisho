/**
 * The webview side of the host bridge. Correlates each outgoing `Request` with the matching
 * `Response` by `requestId` and resolves a promise — which the TanStack Query layer consumes as a
 * `queryFn`. This is the *only* place `postMessage`/`onmessage` is touched.
 */
import type {
  GetWordResponse,
  Request,
  Response,
  SearchResponse
} from "../shared/messages";

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

let nextId = 0;
const pending = new Map<string, (response: Response) => void>();

// `event.data` is whatever the host posted; validate its shape before trusting it as a Response.
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const response = event.data;
  if (!isResponse(response)) return;
  const resolve = pending.get(response.requestId);
  if (resolve) {
    pending.delete(response.requestId);
    resolve(response);
  }
});

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
