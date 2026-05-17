// libs/supabase/query-client.ts
// Single QueryClient instance shared across the app.
// Import this in your root _layout.tsx / App.tsx.

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ── Caching ────────────────────────────────────────────────
      // Data is fresh for 5 minutes — no refetch during this window
      staleTime: 5 * 60 * 1000,
      // Keep inactive queries in cache for 30 minutes
      gcTime: 30 * 60 * 1000,

      // ── Refetch behaviour ──────────────────────────────────────
      // Refetch when user returns to the app (tab switch / foreground)
      refetchOnWindowFocus: true,
      // Don't refetch just because the component re-mounts
      refetchOnMount: false,
      // Don't refetch on reconnect — our cache handles offline
      refetchOnReconnect: false,

      // ── Retries ────────────────────────────────────────────────
      // Retry failed requests twice with exponential backoff
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
    mutations: {
      retry: 0,
    },
  },
});
