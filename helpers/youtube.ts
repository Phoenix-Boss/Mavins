import { getYouTubeAudio as extractAudio } from '../modules/modules/mavin-engine'; // ✅ Fixed path with double modules
import { cache } from '../libs/cache';

export interface YouTubeAudioResult {
  url: string;
  videoId: string;
  expires: string;
  quality: 'low' | 'medium' | 'high';
  success: boolean;
}

export interface YouTubeAudioError {
  error: string;
  success: false;
}

export type YouTubeAudioResponse = YouTubeAudioResult | YouTubeAudioError;

export async function getYouTubeAudio(metadata: {
  artist: string;
  title: string;
  isrc?: string;
  duration?: number;
}): Promise<YouTubeAudioResult> {
  // Validate input
  if (!metadata.artist || !metadata.title) {
    throw new Error('Artist and title are required');
  }

  // Generate cache key
  const cacheKey = `youtube:${metadata.artist.toLowerCase()}:${metadata.title.toLowerCase()}`;
  
  // Check L1 cache first
  try {
    const cached = await cache.get<YouTubeAudioResult>(cacheKey);
    if (cached && cached.url && cached.expires) {
      // Check if cache is still valid
      const expiryDate = new Date(cached.expires);
      if (expiryDate > new Date()) {
        console.log('✅ YouTube audio cache hit');
        return cached;
      } else {
        console.log('📦 Cache expired, removing...');
        await cache.delete(cacheKey);
      }
    }
  } catch (cacheError) {
    console.warn('⚠️ Cache read failed:', cacheError);
    // Continue with extraction even if cache fails
  }

  console.log('🔴 YouTube audio cache miss, extracting...');
  
  try {
    // Call native module with timeout
    const extractionPromise = extractAudio({
      artist: metadata.artist,
      title: metadata.title,
      isrc: metadata.isrc
    });

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Extraction timeout after 15 seconds')), 15000);
    });

    const audio = await Promise.race([extractionPromise, timeoutPromise]) as YouTubeAudioResult;

    // Validate response
    if (!audio || !audio.url) {
      throw new Error('Invalid audio response from extractor');
    }

    // Set expiry if not provided (default 6 hours)
    if (!audio.expires) {
      audio.expires = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    }

    // Store in cache (24 hours TTL)
    try {
      await cache.set(cacheKey, audio, 24 * 60 * 60 * 1000);
      console.log('💾 Cached successfully');
    } catch (cacheError) {
      console.warn('⚠️ Cache write failed:', cacheError);
      // Continue even if caching fails
    }

    console.log('✅ YouTube extraction successful:', {
      videoId: audio.videoId,
      quality: audio.quality,
      urlPreview: audio.url.substring(0, 50) + '...'
    });

    return audio;
  } catch (error: any) {
    console.error('❌ YouTube extraction failed:', error?.message || error);
    
    // Enhance error message
    const errorMessage = error?.message || 'Unknown extraction error';
    throw new Error(`YouTube extraction failed: ${errorMessage}`);
  }
}

// Optional: Add a method to pre-warm cache for popular tracks
export async function preWarmYouTubeAudio(tracks: Array<{
  artist: string;
  title: string;
  isrc?: string;
}>) {
  console.log(`🔥 Pre-warming cache for ${tracks.length} tracks...`);
  
  const results = await Promise.allSettled(
    tracks.map(track => 
      getYouTubeAudio(track).catch(err => ({
        success: false,
        error: err.message,
        track: `${track.artist} - ${track.title}`
      }))
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  console.log(`✅ Pre-warm complete: ${succeeded}/${tracks.length} successful`);
  
  return results;
}