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
  
  // ✅ Get config at runtime
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

// ✅ Create a wrapper that provides both:
// 1. The full cacheManager with all its specific methods
// 2. Generic get/set methods that map to the appropriate specific methods
const cacheWrapper = {
  // Full cacheManager methods (all specific ones)
  ...cacheManager,
  
  // Generic get method that routes to appropriate specific method
  async get(key: string): Promise<any> {
    // Try to determine the type of data from the key pattern
    if (key.startsWith('trending:') || key.startsWith('charts:') || 
        key.startsWith('music:') || key.startsWith('popular:') ||
        key.startsWith('top:') || key.startsWith('editor:') ||
        key.startsWith('sponsored:') || key.startsWith('podcasts:') ||
        key.startsWith('radio:') || key.startsWith('covers:')) {
      
      // These are all search-like keys
      const result = await cacheManager.getSearch(key);
      return result?.track ? [result.track] : null;
    }
    
    if (key.includes('track:')) {
      const trackId = key.split(':')[1];
      return await cacheManager.getTrack(trackId);
    }
    
    // Fallback to device cache
    return await deviceCache.get(key);
  },
  
  // Generic set method that routes to appropriate specific method
  async set(key: string, value: any, ttl?: number): Promise<boolean> {
    // Try to determine the type of data from the key pattern
    if (key.startsWith('trending:') || key.startsWith('charts:') || 
        key.startsWith('music:') || key.startsWith('popular:') ||
        key.startsWith('top:') || key.startsWith('editor:') ||
        key.startsWith('sponsored:') || key.startsWith('podcasts:') ||
        key.startsWith('radio:') || key.startsWith('covers:')) {
      
      // If it's an array of items, save each one
      if (Array.isArray(value)) {
        let success = true;
        for (const item of value) {
          if (item.videoId || item.id) {
            const itemKey = `${key}:${item.videoId || item.id}`;
            
            // Extract artist as string
            const artistName = item.artist || item.uploader || item.name || 'Unknown';
            
            const saveResult = await cacheManager.saveSearch(
              itemKey,
              {
                id: item.videoId || item.id,
                title: item.title || item.name || '',
                artist: artistName,  // ✅ String
                duration: item.duration || 0,
                isrc: undefined
                // ✅ REMOVED: source - doesn't exist in TrackMetadata
              },
              {
                trackId: item.videoId || item.id,
                source: 'youtube',
                streamUrl: '',
                quality: item.quality || 'high',
                format: 'webm'
              }
            );
            success = success && !!saveResult;
          }
        }
        return success;
      }
      
      // Single item
      if (value.videoId || value.id) {
        const artistName = value.artist || value.uploader || value.name || 'Unknown';
        
        return !!(await cacheManager.saveSearch(
          key,
          {
            id: value.videoId || value.id,
            title: value.title || value.name || '',
            artist: artistName,  // ✅ String
            duration: value.duration || 0,
            isrc: undefined
            // ✅ REMOVED: source - doesn't exist in TrackMetadata
          },
          {
            trackId: value.videoId || value.id,
            source: 'youtube',
            streamUrl: '',
            quality: value.quality || 'high',
            format: 'webm'
          }
        ));
      }
    }
    
    // Handle track:* pattern
    if (key.startsWith('track:')) {
      // This is a track metadata cache
      if (value && (value.videoId || value.id)) {
        const trackId = value.videoId || value.id;
        const artistName = value.artist || value.uploader || 'Unknown';
        
        return !!(await cacheManager.saveSearch(
          key,
          {
            id: trackId,
            title: value.title || '',
            artist: artistName,  // ✅ String
            duration: value.duration || 0,
            isrc: value.isrc
            // ✅ REMOVED: source - doesn't exist in TrackMetadata
          },
          {
            trackId: trackId,
            source: value.source || 'youtube',
            streamUrl: value.url || '',
            quality: value.quality || 'high',
            format: value.format || 'webm'
          }
        ));
      }
    }
    
    // Fallback to device cache
    await deviceCache.set(key, value, ttl);
    return true;
  },
  
  // Helper method to check if cache has key
  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null && value !== undefined;
  },
  
  // Delete from cache
  async delete(key: string): Promise<boolean> {
    // For now, just delete from device cache
    await deviceCache.delete(key);
    return true;
  },
  
  // Clear all cache
  async clear(): Promise<void> {
    await cacheManager.clearAll();
  },
  
  // Get from device cache specifically
  async getFromDevice(key: string): Promise<any> {
    return await deviceCache.get(key);
  },
  
  // Set in device cache specifically
  async setInDevice(key: string, value: any, ttl?: number): Promise<void> {
    await deviceCache.set(key, value, ttl);
  }
};

// Export the wrapped cache manager
export const cache = cacheWrapper;

// Also export the raw cacheManager for advanced use cases
export { cacheManager };

// Export other modules
export {
  backgroundJobs,
  deviceCache,
  supabaseCache,
  utils,
  types
};

// Default export
export default {
  cache: cacheWrapper,
  cacheManager,
  backgroundJobs,
  deviceCache,
  supabaseCache,
  initCache,
  shutdownCache,
  utils,
  types
};