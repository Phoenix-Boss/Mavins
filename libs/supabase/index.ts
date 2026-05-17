// libs/supabase/index.ts
// Public API — import everything from here, never from sub-paths.
//
// Usage:
//   import { supabase, useTrendingSection, queryClient } from '@/libs/supabase';

// ── Client ───────────────────────────────────────────────────────────────────
export { supabase } from './client';
export type { Database } from './client';

// ── Query infrastructure ─────────────────────────────────────────────────────
export { queryClient } from './querry-client';
export { queryKeys } from './query-keys';

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  Song,
  Artist,
  Chart,
  ChartRanking,
  Section,
  SectionType,
  SectionItem,
  Playlist,
  PodcastEpisode,
  RadioStation,
  Json,
  Stream,        // ← ADDED: Export Stream type
  StreamInsert,  // ← ADDED: Export StreamInsert type (fixes your error)
  StreamUpdate,  // ← ADDED: Export StreamUpdate type (for consistency)
  StreamRow,     // ← ADDED: Export StreamRow type (for consistency)
  // Helper types (optional but useful)
  Tables,
  Insertable,
  Updatable,
} from './types';

// ── Services (low-level, use in hooks or server code) ────────────────────────
export * from './services/sections';
export * from './services/songs';
export * from './services/artists';
export * from './services/playlists';
export * from './services/podcast';
export * from './services/radio';

// ── Home section hooks ───────────────────────────────────────────────────────
export {
  useTrendingSection,
  useBiggestHitsSection,
  useTop10MonthSection,
  useMavinsBestSection,
  useFeaturedSection,
  useNewReleasesSection,
  useThrowbacksSection,
  usePeoplesChoiceSection,
  useMusicChannelsSection,
  useCreateMixSection,
  usePodcastsSection,
  useRadioFmSection,
  useGenresSection,
} from './hooks/useHomeSection';

export type {
  TrackSectionItem,
  ArtistSectionItem,
  PlaylistSectionItem,
  PodcastSectionItem,
  RadioSectionItem,
  GenreSectionItem,
} from './hooks/useHomeSection';

// ── Auth hooks ───────────────────────────────────────────────────────────────
export { useSession, useUser, useSignInWithEmail, useSignOut } from './hooks/useAuth';
