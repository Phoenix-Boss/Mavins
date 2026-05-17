// libs/supabase/types.ts
// Auto-maintained DB types — mirrors your Supabase schema exactly.
// Run `supabase gen types typescript` to regenerate from your project.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// ─────────────────────────────────────────────
// Table row types
// ─────────────────────────────────────────────

export interface Song {
  id: string;
  title: string;
  artist: string;
  featured_artists: string[] | null;
  artwork_url: string | null;
  artwork_thumbnail: string | null;
  duration: number;
  video_id: string;
  play_count: number | null;
  popularity: number | null;
  created_at: string;
  updated_at: string;
}

export interface Artist {
  id: string;
  name: string;
  is_verified: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Chart {
  id: string;
  name: string;
  chart_type: 'weekly' | 'trending' | 'curated' | 'featured' | string;
  created_at: string;
}

export interface ChartRanking {
  id: string;
  chart_id: string;
  song_id: string;
  position: number;
  previous_position: number | null;
  weeks_on_chart: number | null;
  peak_position: number | null;
  streams_today: number | null;
  date: string;
}

export interface Section {
  id: string;
  name: string;
  display_name: string;
  section_type: SectionType;
  display_order: number;
  is_visible: boolean;
  refresh_interval_minutes: number | null;
  last_refreshed: string | null;
  created_at: string;
  metadata: Json;
}

export type SectionType =
  | 'trending'
  | 'biggest_hits'
  | 'create_mix'
  | 'music_channels'
  | 'peoples_choice'
  | 'top_10_month'
  | 'mavins_best'
  | 'featured'
  | 'podcast'
  | 'radio_fm'
  | 'throwbacks'
  | 'new_releases'
  | 'navigation_buttons'
  | 'playlist_carousel'
  | string;

export interface SectionItem {
  id: string;
  section_id: string;
  track_id: string | null;
  album_id: string | null;
  artist_id: string | null;
  genre_id: string | null;
  playlist_id: string | null;
  podcast_id: string | null;
  radio_station_id: string | null;
  display_order: number;
  position: number | null;
  custom_title: string | null;
  custom_subtitle: string | null;
  custom_thumbnail_url: string | null;
  custom_metadata: Json | null;
  created_at: string;
}

export interface Playlist {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PodcastEpisode {
  id: string;
  title: string;
  description: string | null;
  artwork_url: string | null;
  duration: number | null;
  audio_url: string | null;
  created_at: string;
}

export interface RadioStation {
  id: string;
  name: string;
  stream_url: string | null;
  thumbnail_url: string | null;
  artwork_url: string | null;
  genre: string | null;
  listeners: number | null;
  listener_count: number | null;
  created_at: string;
}

// ─────────────────────────────────────────────
// Stream cache table (for MavinPlayer audio/video streams)
// ─────────────────────────────────────────────

export interface Stream {
  id: string;
  track_id: string;
  source: string;
  stream_url: string;
  stream_type: 'audio' | 'video';
  quality: string;
  format: string;
  duration: number;
  expiry: string;
  is_active: boolean;
  health_score: number;
  last_accessed: string;
  access_count: number;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────
// Database interface (for createClient generic)
// ─────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      songs:            { Row: Song;          Insert: Omit<Song, 'id' | 'created_at' | 'updated_at'>;  Update: Partial<Song> };
      artists:          { Row: Artist;        Insert: Omit<Artist, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Artist> };
      charts:           { Row: Chart;         Insert: Omit<Chart, 'id' | 'created_at'>;                Update: Partial<Chart> };
      chart_rankings:   { Row: ChartRanking;  Insert: Omit<ChartRanking, 'id'>;                        Update: Partial<ChartRanking> };
      sections:         { Row: Section;       Insert: Omit<Section, 'id' | 'created_at'>;              Update: Partial<Section> };
      section_items:    { Row: SectionItem;   Insert: Omit<SectionItem, 'id' | 'created_at'>;          Update: Partial<SectionItem> };
      playlists:        { Row: Playlist;      Insert: Omit<Playlist, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Playlist> };
      podcast_episodes: { Row: PodcastEpisode; Insert: Omit<PodcastEpisode, 'id' | 'created_at'>;     Update: Partial<PodcastEpisode> };
      radio_stations:   { Row: RadioStation;  Insert: Omit<RadioStation, 'id' | 'created_at'>;         Update: Partial<RadioStation> };
      streams:          { Row: Stream;        Insert: Omit<Stream, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Stream> };
    };
  };
}

// ─────────────────────────────────────────────
// Helper types for table operations
// ─────────────────────────────────────────────

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type Insertable<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type Updatable<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];

// Specific table type aliases
export type StreamRow = Tables<'streams'>;
export type StreamInsert = Insertable<'streams'>;
export type StreamUpdate = Updatable<'streams'>;
