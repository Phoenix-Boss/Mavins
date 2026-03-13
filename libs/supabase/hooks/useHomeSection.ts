// libs/supabase/hooks/useHomeSection.ts
// TanStack Query hooks for every home screen section.
// Each hook:
//   1. Resolves the section ID by type
//   2. Fetches section_items
//   3. Fetches the related entity rows (songs, artists, etc.)
//   4. Maps to a clean typed result
//
// staleTime / gcTime come from queryClient defaults.
// Override per-hook by passing queryOptions if needed.

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../query-keys';
import { getSectionByType, getTrackItems, getArtistItems, getPlaylistItems, getPodcastItems, getRadioItems, getGenreItems } from '../services/sections';
import { getSongsByIds } from '../services/songs';
import { getArtistsByIds } from '../services/artists';
import { getPlaylistsByIds } from '../services/playlists';
import { getPodcastsByIds } from '../services/podcast';
import { getRadioStationsByIds } from '../services/radio';
import type { Song, Artist, Playlist, PodcastEpisode, RadioStation, SectionItem } from '../../supabase/types';

// ─────────────────────────────────────────────
// Shared item types
// ─────────────────────────────────────────────

export interface TrackSectionItem extends Song {
  displayOrder: number;
}

export interface ArtistSectionItem extends Artist {
  displayOrder: number;
}

export interface PlaylistSectionItem extends Playlist {
  displayOrder: number;
}

export interface PodcastSectionItem extends PodcastEpisode {
  displayOrder: number;
}

export interface RadioSectionItem extends RadioStation {
  displayOrder: number;
  isLive: true;
}

export interface GenreSectionItem {
  id: string;
  playlistId: string | null;
  title: string;
  subtitle: string;
  thumbnail: string;
  metadata: Record<string, any>;
  displayOrder: number;
}

// ─────────────────────────────────────────────
// Helper: fetch section → track items → songs
// ─────────────────────────────────────────────
async function fetchTrackSection(sectionType: string, limit: number): Promise<TrackSectionItem[]> {
  const section = await getSectionByType(sectionType);
  const items = await getTrackItems(section.id, limit);
  if (!items.length) return [];
  const ids = items.map(i => i.track_id!);
  const songs = await getSongsByIds(ids);
  return songs.map((song, i) => ({ ...song, displayOrder: items[i]?.display_order ?? i }));
}

// ─────────────────────────────────────────────
// Song-based section hooks
// ─────────────────────────────────────────────

export function useTrendingSection(limit = 10) {
  return useQuery({
    queryKey: queryKeys.homeSection.trending(),
    queryFn: () => fetchTrackSection('trending', limit),
  });
}

export function useBiggestHitsSection(limit = 10) {
  return useQuery({
    queryKey: queryKeys.homeSection.biggestHits(),
    queryFn: () => fetchTrackSection('biggest_hits', limit),
  });
}

export function useTop10MonthSection(limit = 10) {
  return useQuery({
    queryKey: queryKeys.homeSection.top10Month(),
    queryFn: () => fetchTrackSection('top_10_month', limit),
  });
}

export function useMavinsBestSection(limit = 10) {
  return useQuery({
    queryKey: queryKeys.homeSection.mavinsBest(),
    queryFn: () => fetchTrackSection('mavins_best', limit),
  });
}

export function useFeaturedSection(limit = 8) {
  return useQuery({
    queryKey: queryKeys.homeSection.featured(),
    queryFn: () => fetchTrackSection('featured', limit),
    // Featured content changes less often — extend stale time
    staleTime: 30 * 60 * 1000,
  });
}

export function useNewReleasesSection(limit = 20) {
  return useQuery({
    queryKey: queryKeys.homeSection.newReleases(),
    queryFn: () => fetchTrackSection('new_releases', limit),
  });
}

export function useThrowbacksSection(limit = 8) {
  return useQuery({
    queryKey: queryKeys.homeSection.throwbacks(),
    queryFn: () => fetchTrackSection('throwbacks', limit),
    staleTime: 24 * 60 * 60 * 1000, // throwbacks don't change — 24h stale
  });
}

export function usePeoplesChoiceSection(limit = 20) {
  return useQuery({
    queryKey: queryKeys.homeSection.peoplesChoice(),
    queryFn: () => fetchTrackSection('peoples_choice', limit),
  });
}

// ─────────────────────────────────────────────
// Music Channels (artists)
// ─────────────────────────────────────────────

export function useMusicChannelsSection(limit = 50) {
  return useQuery({
    queryKey: queryKeys.homeSection.musicChannels(),
    queryFn: async (): Promise<ArtistSectionItem[]> => {
      const section = await getSectionByType('music_channels');
      const items = await getArtistItems(section.id, limit);
      if (!items.length) return [];
      const ids = items.map(i => i.artist_id!);
      const artists = await getArtistsByIds(ids);
      return artists.map((artist, i) => ({ ...artist, displayOrder: items[i]?.display_order ?? i }));
    },
    staleTime: 60 * 60 * 1000, // artists list doesn't change often — 1h
  });
}

// ─────────────────────────────────────────────
// Create Mix (playlists)
// ─────────────────────────────────────────────

export function useCreateMixSection(limit = 20) {
  return useQuery({
    queryKey: queryKeys.homeSection.createMix(),
    queryFn: async (): Promise<PlaylistSectionItem[]> => {
      const section = await getSectionByType('create_mix');
      const items = await getPlaylistItems(section.id, limit);
      if (!items.length) return [];
      const ids = items.map(i => i.playlist_id!);
      const playlists = await getPlaylistsByIds(ids);
      return playlists.map((p, i) => ({ ...p, displayOrder: items[i]?.display_order ?? i }));
    },
  });
}

// ─────────────────────────────────────────────
// Podcasts
// ─────────────────────────────────────────────

export function usePodcastsSection(limit = 10) {
  return useQuery({
    queryKey: queryKeys.homeSection.podcasts(),
    queryFn: async (): Promise<PodcastSectionItem[]> => {
      const section = await getSectionByType('podcast');
      const items = await getPodcastItems(section.id, limit);
      if (!items.length) return [];
      const ids = items.map(i => i.podcast_id!);
      const episodes = await getPodcastsByIds(ids);
      return episodes.map((ep, i) => ({ ...ep, displayOrder: items[i]?.display_order ?? i }));
    },
  });
}

// ─────────────────────────────────────────────
// Radio FM
// ─────────────────────────────────────────────

export function useRadioFmSection(limit = 10) {
  return useQuery({
    queryKey: queryKeys.homeSection.radioFm(),
    queryFn: async (): Promise<RadioSectionItem[]> => {
      const section = await getSectionByType('radio_fm');
      const items = await getRadioItems(section.id, limit);
      if (!items.length) return [];
      const ids = items.map(i => i.radio_station_id!);
      const stations = await getRadioStationsByIds(ids);
      return stations.map((s, i) => ({ ...s, isLive: true as const, displayOrder: items[i]?.display_order ?? i }));
    },
    // Radio data is live — refetch more aggressively
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: true,
  });
}

// ─────────────────────────────────────────────
// Moods & Genres (navigation_buttons)
// ─────────────────────────────────────────────

export function useGenresSection(genre?: string, limit = 20) {
  return useQuery({
    queryKey: queryKeys.homeSection.genres(genre),
    queryFn: async (): Promise<GenreSectionItem[]> => {
      const section = await getSectionByType('navigation_buttons');
      const items = await getGenreItems(section.id, genre, limit);
      return items.map(item => ({
        id: item.id,
        playlistId: item.playlist_id ?? null,
        title: item.custom_title ?? 'Unknown',
        subtitle: item.custom_subtitle ?? '',
        thumbnail: item.custom_thumbnail_url ?? '',
        metadata: (item.custom_metadata as Record<string, any>) ?? {},
        displayOrder: item.display_order,
      }));
    },
    staleTime: 7 * 24 * 60 * 60 * 1000, // genres barely change — 7 days
  });
}