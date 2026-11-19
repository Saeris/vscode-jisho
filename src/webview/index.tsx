import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  getDictionaryStatus,
  onDictionaryStatus,
  onHostSettings
} from "./bridge";
import { recordRejections } from "./lastRejection";
import { applySettings } from "./settings";
import { isSpeechAvailable, onVoicesChanged } from "./speech";
import "./styles/theme.css";
import "./styles/posPalette.css";
// After posPalette.css: that file defines the `--pos-*` values this one reads.
import "./styles/posCategory.css";
// The region fonts (spec 22). Each chunk loads only when a page draws a character in its range.
import "./styles/regionalFonts.css";

// Pre-warm the TTS voice list: getVoices() populates asynchronously (up to ~1s), and paying that
// wait at startup instead of on the first Play/Speak click removes OUR share of TTS latency (the
// OS speech engine's own spin-up remains).
void isSpeechAvailable();

// A rejection with no query attached is otherwise completely silent. Recorded, not reported —
// see lastRejection.ts for why prompting on every one would make the reporter noise.
recordRejections();

// Settings arrive as host pushes (initial snapshot on ready, again on every Settings-UI edit) and
// land as CSS variables — no re-render involved.
onHostSettings(applySettings);

// Results are stable for a given query; cache generously and skip refetch-on-focus (there is no
// "focus" concept that matters inside a webview panel).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false }
  }
});

/**
 * Refresh every query when the word dictionary becomes ready.
 *
 * Queries made before it was ready were answered `not-ready` (it was downloading) or failed with a
 * reason; and after an update's swap the file is a different one. Either way, what is cached is no
 * longer the answer. Subscribed here, beside the client it refreshes, and keyed on the TRANSITION so
 * a stream of progress pushes does not refetch anything.
 */
let wordsWereReady = getDictionaryStatus().words.state === "ready";
onDictionaryStatus(() => {
  const ready = getDictionaryStatus().words.state === "ready";
  if (ready && !wordsWereReady) void queryClient.invalidateQueries();
  wordsWereReady = ready;
});

// Ask again whether speech is available when the OS voices change: voices can load after the first
// check, and the play buttons stay hidden until something asks (see `onVoicesChanged`).
onVoicesChanged(() => {
  void queryClient.invalidateQueries({ queryKey: ["speechAvailable"] });
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* INSIDE the query provider, not outside it. The boundary's whole purpose is to file a
          report, which needs the bridge — a boundary wrapped around the providers would catch the
          crash and then be unable to do the one thing it exists for. */}
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>
);
