// src/cache/utils.ts

import * as Crypto from 'expo-crypto';
import { TrackMetadata, TrackIdentifier } from './types';

/**
 * Generate consistent cache key with type safety
 * (React Native compatible)
 */
export async function generateKey(type: string, value: string): Promise<string> {
  const normalized = value.toLowerCase().trim().replace(/\s+/g, ' ');

  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    normalized
  );

  return `${type}:${hash.substring(0, 16)}`;
}

/**
 * Search query to cache key
 */
export async function searchKey(query: string): Promise<string> {
  return generateKey('search', query);
}

/**
 * Track to cache key (by ISRC or title+artist)
 */
export async function trackKey(
  track: TrackMetadata | TrackIdentifier
): Promise<string> {
  if (track.isrc) {
    return `track:isrc:${track.isrc}`;
  }

  if (track.title && track.artist) {
    return generateKey('track', `${track.title} ${track.artist}`);
  }

  if (track.id) {
    return `track:id:${track.id}`;
  }

  throw new Error('Cannot generate track key: insufficient data');
}

/**
 * Stream key for track
 */
export function streamKey(trackId: string): string {
  return `stream:${trackId}`;
}

/**
 * Artist key
 */
export async function artistKey(artistName: string): Promise<string> {
  return generateKey('artist', artistName);
}

/**
 * Related tracks key
 */
export function relatedKey(trackId: string): string {
  return `related:${trackId}`;
}

/**
 * Check if timestamp is expired
 */
export function isExpired(timestamp: number): boolean {
  return Date.now() > timestamp;
}

/**
 * Calculate expiry timestamp
 * @param msFromNow - duration in milliseconds
 */
export function expiryTime(msFromNow: number): number {
  return Date.now() + msFromNow;
}

/**
 * Normalize search query
 */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Extract artist from query
 */
export function extractArtistFromQuery(query: string): string | null {
  const byMatch = query.match(/(.+) by (.+)/i);
  if (byMatch) {
    return byMatch[2].trim();
  }

  const dashMatch = query.match(/(.+)\s*-\s*(.+)/);
  if (dashMatch) {
    return dashMatch[1].trim();
  }

  return null;
}

/**
 * Extract song from query
 */
export function extractSongFromQuery(query: string): string | null {
  const byMatch = query.match(/(.+) by (.+)/i);
  if (byMatch) {
    return byMatch[1].trim();
  }

  const dashMatch = query.match(/(.+)\s*-\s*(.+)/);
  if (dashMatch) {
    return dashMatch[2].trim();
  }

  return query;
}

/**
 * Merge track data (update existing with new)
 */
export function mergeTrackData(
  existing: TrackMetadata,
  newData: Partial<TrackMetadata>
): TrackMetadata {
  const now = new Date().toISOString();

  return {
    ...existing,
    ...newData,
    lastAccessed: now,
    accessCount: (existing.accessCount || 0) + 1,
    updatedAt: now,
  };
}

/**
 * Sleep utility for testing
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format cache key for display
 */
export function formatCacheKey(key: string): string {
  return key.replace(/[:\/]/g, '_');
}

/**
 * Parse cache key to get type and identifier
 */
export function parseCacheKey(key: string): {
  type: string;
  identifier: string;
} {
  const parts = key.split(':');

  return {
    type: parts[0],
    identifier: parts.slice(1).join(':'),
  };
}