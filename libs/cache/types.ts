// src/cache/types.ts

/**
 * Core Types for Mavin Cache System
 */

// ============================================
// Cache Configuration Types
// ============================================

export interface DeviceCacheConfig {
  enabled: boolean;
  maxItems: number;
  ttlSeconds: number;
  storagePrefix: string;
}

export interface SupabaseCacheConfig {
  enabled: boolean;
  url: string;
  key: string;
  serviceKey: string;
  ttlSeconds: number;
  connectionPool: number;
}

export interface BackgroundJobsConfig {
  refreshIntervalMinutes: number;
  relatedTracksPerSearch: number;
  popularThreshold: number;
  maxPreCache: number;
}

export interface StreamConfig {
  maxFailures: number;
  refreshThreshold: number;
  defaultExpiryHours: number;
}

export interface CacheConfig {
  device: DeviceCacheConfig;
  supabase: SupabaseCacheConfig;
  background: BackgroundJobsConfig;
  stream: StreamConfig;
  keys: {
    searchPrefix: string;
    trackPrefix: string;
    streamPrefix: string;
    artistPrefix: string;
    relatedPrefix: string;
  };
}

// ============================================
// Cache Entry Types
// ============================================

export interface CacheEntry<T = any> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number;
  lastAccessed: number;
  accessCount: number;
}

export interface DeviceCacheEntry<T = any> extends CacheEntry<T> {
  version?: number;
}

// ============================================
// Track Types
// ============================================

export interface TrackMetadata {
  id?: string;
  isrc?: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  artworkUrl?: string;
  spotifyId?: string;
  youtubeId?: string;
  deezerId?: string;
  soundcloudId?: string;
  metadata?: Record<string, any>;
  accessCount?: number;
  lastAccessed?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TrackIdentifier {
  isrc?: string;
  title?: string;
  artist?: string;
  id?: string;
}

// ============================================
// Stream Types
// ============================================

export type StreamSource = 'youtube' | 'deezer' | 'soundcloud' | 'spotify' | 'vk' | 'yandex' | 'jiosaavn';

export interface StreamData {
  id?: string;
  trackId: string;
  source: StreamSource;
  streamUrl: string;
  quality: string;
  format: string;
  expiry?: string;
  isActive?: boolean;
  healthScore?: number;
  failureCount?: number;
  lastVerified?: string;
}

export interface StreamSaveData {
  trackId: string;
  source: StreamSource;
  streamUrl: string;
  quality?: string;
  format?: string;
}

// ============================================
// Search Types
// ============================================

export interface SearchResult {
  track: TrackMetadata;
  stream?: StreamData;
  source: 'device' | 'supabase' | 'api';
}

export interface SearchRecord {
  id?: string;
  query: string;
  normalized: string;
  trackId: string;
  hitCount: number;
  firstSeen: string;
  lastHit: string;
}

// ============================================
// Related Track Types
// ============================================

export interface RelatedTrack {
  sourceTrack: string;
  relatedTrack: TrackMetadata;
  relevance: number;
  reason: 'same_artist' | 'similar' | 'featured' | 'genre' | 'popular';
}

export interface RelatedTrackInput {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  relevance: number;
  reason: 'same_artist' | 'similar' | 'featured' | 'genre' | 'popular';
}

// ============================================
// Artist Types
// ============================================

export interface ArtistCache {
  id?: string;
  name: string;
  topTracks: TrackMetadata[];
  albums: Array<{
    title: string;
    year?: number;
    tracks?: string[];
  }>;
  similar: string[];
  lastUpdated: string;
}

// ============================================
// Statistics Types
// ============================================

export interface DeviceStats {
  size: number;
  maxSize: number;
  keys: string[];
}

export interface SupabaseStats {
  tracks: number;
  activeStreams: number;
  searches: number;
}

export interface CacheStats {
  device: DeviceStats;
  supabase: SupabaseStats | null;
  timestamp: string;
}

// ============================================
// API Response Types (for testing)
// ============================================

export interface TrackAPIResponse {
  success: boolean;
  data?: {
    track: TrackMetadata;
    stream?: StreamData;
  };
  error?: string;
  source?: string;
}

// ============================================
// Error Types
// ============================================

export class CacheError extends Error {
  constructor(
    message: string,
    public code: string,
    public layer?: 'device' | 'supabase'
  ) {
    super(message);
    this.name = 'CacheError';
  }
}
