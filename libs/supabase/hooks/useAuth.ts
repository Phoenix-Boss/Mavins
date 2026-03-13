// libs/supabase/hooks/useAuth.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../client';
import { queryKeys } from '../query-keys';

// ─────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────

export function useSession() {
  return useQuery({
    queryKey: queryKeys.auth.session(),
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUser() {
  const { data: session } = useSession();
  return session?.user ?? null;
}

// ─────────────────────────────────────────────
// Sign in / out
// ─────────────────────────────────────────────

export function useSignInWithEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      supabase.auth.signInWithPassword({ email, password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.auth.session() });
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => supabase.auth.signOut(),
    onSuccess: () => {
      // Clear all cached data on sign out
      qc.clear();
    },
  });
}