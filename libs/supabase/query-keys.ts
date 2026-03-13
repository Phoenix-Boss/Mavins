// libs/supabase/query-keys.ts
// Centralised query key factory.
// Every useQuery/useInfiniteQuery in the app references these —
// never hardcode strings in hooks.

import type { SectionType } from './types';

export const queryKeys = {
  // ── Sections ────────────────────────────────
  sections: {
    all:     ()            => ['sections'] as const,
    byType:  (type: SectionType) => ['sections', type] as const,
  },

  // ── Songs ───────────────────────────────────
  songs: {
    all:        ()              => ['songs'] as const,
    byIds:      (ids: string[]) => ['songs', 'byIds', ids] as const,
    top:        (limit: number) => ['songs', 'top', limit] as const,
    newReleases:(limit: number) => ['songs', 'newReleases', limit] as const,
    search:     (query: string) => ['songs', 'search', query] as const,
  },

  // ── Home screen sections (composed) ─────────
  homeSection: {
    trending:     () => ['homeSection', 'trending'] as const,
    biggestHits:  () => ['homeSection', 'biggestHits'] as const,
    top10Month:   () => ['homeSection', 'top10Month'] as const,
    mavinsBest:   () => ['homeSection', 'mavinsBest'] as const,
    featured:     () => ['homeSection', 'featured'] as const,
    newReleases:  () => ['homeSection', 'newReleases'] as const,
    throwbacks:   () => ['homeSection', 'throwbacks'] as const,
    peoplesChoice:() => ['homeSection', 'peoplesChoice'] as const,
    musicChannels:() => ['homeSection', 'musicChannels'] as const,
    createMix:    () => ['homeSection', 'createMix'] as const,
    podcasts:     () => ['homeSection', 'podcasts'] as const,
    radioFm:      () => ['homeSection', 'radioFm'] as const,
    genres:       (genre?: string) => ['homeSection', 'genres', genre ?? 'all'] as const,
  },

  // ── Artists ─────────────────────────────────
  artists: {
    all:    ()              => ['artists'] as const,
    byIds:  (ids: string[]) => ['artists', 'byIds', ids] as const,
    search: (q: string)     => ['artists', 'search', q] as const,
  },

  // ── Playlists ────────────────────────────────
  playlists: {
    all:   ()              => ['playlists'] as const,
    byIds: (ids: string[]) => ['playlists', 'byIds', ids] as const,
  },

  // ── Podcasts ─────────────────────────────────
  podcasts: {
    all:   ()              => ['podcasts'] as const,
    byIds: (ids: string[]) => ['podcasts', 'byIds', ids] as const,
  },

  // ── Radio ────────────────────────────────────
  radio: {
    all:   ()              => ['radio'] as const,
    byIds: (ids: string[]) => ['radio', 'byIds', ids] as const,
  },

  // ── Auth ─────────────────────────────────────
  auth: {
    session: () => ['auth', 'session'] as const,
    user:    () => ['auth', 'user'] as const,
  },
} as const;