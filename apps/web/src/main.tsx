import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isApiError } from "@/lib/api/client.ts";
import "./index.css";
import { router } from "./app/router";

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 600;
const RETRY_MAX_DELAY_MS = 4_000;
const DEFAULT_STALE_MS = 15_000;
const ROOT_ELEMENT_ID = "root";

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES || !isApiError(error)) {
    return false;
  }
  if (error.kind === "network" || error.kind === "timeout") {
    return true;
  }
  if (error.status === null) {
    return false;
  }
  return error.status === 429 || error.status >= 500;
}

function retryDelay(attempt: number): number {
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      retryDelay,
      staleTime: DEFAULT_STALE_MS,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

const container = document.getElementById(ROOT_ELEMENT_ID);
if (container === null) {
  throw new Error("elemen #root tidak ditemukan pada dokumen");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
