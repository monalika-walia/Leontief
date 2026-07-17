import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ConfigError } from "./components/ConfigError";
import { AppProvider } from "./ctx";
import "./index.css";
import { loadEnv } from "./lib/env";

const qc = new QueryClient({
  defaultOptions: {
    queries: { refetchInterval: 12_000, staleTime: 10_000, retry: 2, retryDelay: 800 },
  },
});

const result = loadEnv();
const root = createRoot(document.getElementById("root")!);

root.render(
  <StrictMode>
    {result.ok ? (
      <QueryClientProvider client={qc}>
        <AppProvider env={result.env}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AppProvider>
      </QueryClientProvider>
    ) : (
      <ConfigError missing={result.missing} />
    )}
  </StrictMode>,
);
