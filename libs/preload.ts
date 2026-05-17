// libs/preload.ts
import { cache } from './cache';

export interface PreloadSong {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  videoId: string;
  duration: number;
}

/**
 * Preloads search results for instant playback
 * Caches track metadata and prefetches audio data
 */
export const preloadSearchResults = async (songs: PreloadSong[]): Promise<void> => {
  if (!songs || songs.length === 0) return;
  
  try {
    const preloadPromises = songs.map(async (song) => {
      const cacheKey = `preload:track:${song.id}`;
      await cache.set(
        cacheKey,
        {
          preloaded: true,
          timestamp: Date.now(),
          track: {
            id: song.id,
            title: song.title,
            artist: song.artist,
            url: song.url,
            videoId: song.videoId,
          }
        },
        3600000 // 1 hour TTL
      ).catch(() => {});
      
      // Prefetch to establish connection
      if (song.url) {
        fetch(song.url, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
      }
    });
    
    await Promise.allSettled(preloadPromises);
  } catch (error) {
    console.warn('[Preload] Failed:', error);
  }
};