import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { isSpeechAvailable } from "./speech";
import "./styles/theme.css";

// Pre-warm the TTS voice list: getVoices() populates asynchronously (up to ~1s), and paying that
// wait at startup instead of on the first Play/Speak click removes OUR share of TTS latency (the
// OS speech engine's own spin-up remains).
void isSpeechAvailable();

// Results are stable for a given query; cache generously and skip refetch-on-focus (there is no
// "focus" concept that matters inside a webview panel).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false }
  }
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
