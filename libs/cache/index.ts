// libs/cache/index.ts

import { cacheManager } from './cache-manager';
import { backgroundJobs } from './background-jobs';
import { deviceCache } from './device-cache';
import { supabaseCache } from './supabase-cache';
import { getConfig } from './config';
import * as utils from './utils';
import * as types from './types';

/**
 * Initialize cache system
 */
export function initCache(options: { startBackgroundJobs?: boolean } = {}): void {
  console.log('🚀 Initializing Mavin Cache System...');

  const config = getConfig();

  console.log(`   Device cache: ${config.device.enabled ? 'ON' : 'OFF'}`);
  console.log(`   Supabase cache: ${config.supabase?.enabled ? 'ON' : 'OFF'}`);

  if (options.startBackgroundJobs) {
    backgroundJobs.start();
  }
}

/**
 * Shutdown cache system
 */
export async function shutdownCache(): Promise<void> {
  console.log('Shutting down cache system...');
  backgroundJobs.stop();
}

// ─────────────────────────────────────────────
// Key classification
//
// "List keys" are used by home-screen hooks to store arrays of
// section items fetched from Supabase. They must round-trip as
// plain JSON blobs through deviceCache — not through cacheManager,
// which only understands single-track SearchResult objects.
//
// "Track keys" (track:*) and "search keys" continue to go through
// cacheManager so the full L1 → L2 pipeline is preserved.
// ─────────────────────────────────────────────
const LIST_KEY_PREFIXES = [
  'trending:',
  'charts:',
  'music:',
  'popular:',
  'top:',
  'editor:',
  'sponsored:',
  'podcasts:',
  'radio:',
  'throwbacks:',
  'featured:',
  'genre:',
] as const;

function isListKey(key: string): boolean {
  return LIST_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}



// ─────────────────────────────────────────────
// Cache wrapper
// ─────────────────────────────────────────────
const cacheWrapper = {
  // Spread all specific cacheManager methods for advanced use
  ...cacheManager,

  /**
   * Generic get — routes by key type:
   * - List keys  → deviceCache (plain JSON blob, returns array or object as stored)
   * - track:*    → cacheManager.getTrack()
   * - everything else → cacheManager.getSearch(), falls back to deviceCache
   */
  async get(key: string): Promise<any> {
    // ── List keys: plain device cache round-trip ──────────────────
    if (isListKey(key)) {
      const result = await deviceCache.get(key);
      console.log(`📦 [cache.get] "${key}" → ${result ? `hit (${Array.isArray(result) ? result.length + ' items' : 'object'})` : 'miss'}`);
      return result ?? null;
    }

    // ── Track by ID ───────────────────────────────────────────────
    if (key.startsWith('track:')) {
      const trackId = key.split(':')[1];
      return await cacheManager.getTrack(trackId);
    }

    // ── Search / everything else ──────────────────────────────────
    const searchResult = await cacheManager.getSearch(key);
    if (searchResult) return searchResult;

    // Final fallback
    return await deviceCache.get(key);
  },

  /**
   * Generic set — routes by key type:
   * - List keys  → deviceCache directly (stores array/object as-is)
   * - track:*    → cacheManager.saveSearch() (full L1+L2 pipeline)
   * - everything else → deviceCache fallback
   *
   * TTL is accepted in either ms or seconds and normalised to seconds
   * before being passed to deviceCache.
   */
  async set(key: string, value: any, ttl?: number): Promise<boolean> {
    const ttlMs = ttl;

    // ── List keys: store blob directly ────────────────────────────
    if (isListKey(key)) {
      console.log(`💾 [cache.set] "${key}" → deviceCache (${Array.isArray(value) ? value.length + ' items' : 'object'}, TTL: ${ttlMs}ms)`);
      return await deviceCache.set(key, value, ttlMs);
    }

    // ── Track metadata ────────────────────────────────────────────
    if (key.startsWith('track:') && value && (value.videoId || value.id)) {
      const trackId = value.videoId || value.id;
      const artistName = value.artist || value.uploader || 'Unknown';

      return !!(await cacheManager.saveSearch(
        key,
        {
          id: trackId,
          title: value.title || '',
          artist: artistName,
          duration: value.duration || 0,
          isrc: value.isrc,
        },
        {
          trackId,
          source: value.source || 'youtube',
          streamUrl: value.url || '',
          quality: value.quality || 'high',
          format: value.format || 'webm',
        }
      ));
    }

    // ── Fallback ──────────────────────────────────────────────────
    return await deviceCache.set(key, value, ttlMs);
  },

  /** Check if a key exists and is valid */
  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null && value !== undefined;
  },

  /** Delete a key */
  async delete(key: string): Promise<boolean> {
    await deviceCache.delete(key);
    return true;
  },

  /** Clear everything */
  async clear(): Promise<void> {
    await cacheManager.clearAll();
  },

  /** Direct device cache read (advanced use) */
  async getFromDevice(key: string): Promise<any> {
    return await deviceCache.get(key);
  },

  /** Direct device cache write (advanced use) */
  async setInDevice(key: string, value: any, ttl?: number): Promise<void> {
    await deviceCache.set(key, value, ttl);
  },
};

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────
export const cache = cacheWrapper;
export { cacheManager };
export { backgroundJobs, deviceCache, supabaseCache, utils, types };

export default {
  cache: cacheWrapper,
  cacheManager,
  backgroundJobs,
  deviceCache,
  supabaseCache,
  initCache,
  shutdownCache,
  utils,
  types,
};