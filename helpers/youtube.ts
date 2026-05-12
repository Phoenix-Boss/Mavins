// helpers/youtube.ts
//
// LAYER 1: Identifier Normalization — Single source of truth for YouTube URL/video ID extraction
//
// This file provides a unified interface for all YouTube URL parsing needs across the app.
// Every component that needs to extract a video ID or validate a YouTube URL must use these functions.
//
// Supported URL formats:
//   - https://www.youtube.com/watch?v=VIDEO_ID
//   - https://youtu.be/VIDEO_ID
//   - https://youtube.com/shorts/VIDEO_ID
//   - https://www.youtube.com/live/VIDEO_ID
//   - https://music.youtube.com/watch?v=VIDEO_ID
//   - https://youtu.be/VIDEO_ID?si=TOKEN
//   - Plain 11-character video ID
//
// All functions are pure, synchronous where possible, and return normalized results.

/**
 * Regular expression for matching YouTube video IDs from any URL format
 * Matches 11-character strings with allowed chars: a-z A-Z 0-9 - _
 */
const VIDEO_ID_REGEX = /[a-zA-Z0-9_-]{11}/;

/**
 * Regular expression for validating a clean video ID (exactly 11 chars, allowed charset)
 */
const VALID_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Check if a string is a valid YouTube video ID format
 * @param str - String to validate
 * @returns True if string matches exactly 11 characters of allowed charset
 */
export function isYouTubeVideoId(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return VALID_VIDEO_ID_REGEX.test(str.trim());
}

/**
 * Check if a string contains a YouTube domain
 * @param url - URL to check
 * @returns True if URL contains youtube.com or youtu.be
 */
export function isYouTubeUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be');
}

/**
 * Extract a clean 11-character YouTube video ID from any URL format or plain ID
 * 
 * Supported formats:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://youtube.com/shorts/VIDEO_ID
 *   - https://www.youtube.com/live/VIDEO_ID
 *   - https://music.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID?si=TOKEN&t=123
 *   - Plain VIDEO_ID string
 * 
 * @param urlOrId - YouTube URL or plain video ID string
 * @returns Extracted video ID or null if not found
 */
export function extractVideoId(urlOrId: string): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;
  
  // Case 1: Already a valid 11-character video ID
  if (isYouTubeVideoId(trimmed)) {
    return trimmed;
  }
  
  // Case 2: Not a URL - but might be a video ID with extra chars
  if (!trimmed.includes('http') && !trimmed.includes('youtube') && !trimmed.includes('youtu.be')) {
    const match = trimmed.match(VIDEO_ID_REGEX);
    if (match) return match[0];
    return null;
  }
  
  // Case 3: Standard watch URL with v= parameter
  if (trimmed.includes('watch?v=')) {
    const vParamMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (vParamMatch) return vParamMatch[1];
  }
  
  // Case 4: youtu.be short URL format
  if (trimmed.includes('youtu.be/')) {
    const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];
  }
  
  // Case 5: YouTube Shorts URL format
  if (trimmed.includes('/shorts/')) {
    const shortsMatch = trimmed.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
  }
  
  // Case 6: YouTube Live URL format
  if (trimmed.includes('/live/')) {
    const liveMatch = trimmed.match(/\/live\/([a-zA-Z0-9_-]{11})/);
    if (liveMatch) return liveMatch[1];
  }
  
  // Case 7: Embed URL format
  if (trimmed.includes('/embed/')) {
    const embedMatch = trimmed.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
  }
  
  // Case 8: Any remaining YouTube URL - try regex on the whole string
  const universalMatch = trimmed.match(VIDEO_ID_REGEX);
  if (universalMatch) return universalMatch[0];
  
  return null;
}

/**
 * Convert a video ID or URL to a standard YouTube watch URL
 * @param videoIdOrUrl - Video ID or YouTube URL
 * @returns Standard watch URL or empty string if invalid
 */
export function toWatchUrl(videoIdOrUrl: string): string {
  if (!videoIdOrUrl || typeof videoIdOrUrl !== 'string') return '';
  
  // Try to extract video ID first
  const videoId = extractVideoId(videoIdOrUrl);
  if (!videoId) return '';
  
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Convert a video ID or URL to a standard YouTube Music watch URL
 * @param videoIdOrUrl - Video ID or YouTube URL
 * @returns YouTube Music watch URL or empty string if invalid
 */
export function toMusicWatchUrl(videoIdOrUrl: string): string {
  const videoId = extractVideoId(videoIdOrUrl);
  if (!videoId) return '';
  
  return `https://music.youtube.com/watch?v=${videoId}`;
}

/**
 * Convert a video ID or URL to a thumbnail URL
 * @param videoIdOrUrl - Video ID or YouTube URL
 * @param quality - Thumbnail quality: 'default', 'mqdefault', 'hqdefault', 'sddefault', 'maxresdefault'
 * @returns Thumbnail URL or empty string if invalid
 */
export function toThumbnailUrl(
  videoIdOrUrl: string,
  quality: 'default' | 'mqdefault' | 'hqdefault' | 'sddefault' | 'maxresdefault' = 'hqdefault'
): string {
  const videoId = extractVideoId(videoIdOrUrl);
  if (!videoId) return '';
  
  const qualityMap = {
    default: 'default.jpg',
    mqdefault: 'mqdefault.jpg',
    hqdefault: 'hqdefault.jpg',
    sddefault: 'sddefault.jpg',
    maxresdefault: 'maxresdefault.jpg',
  };
  
  return `https://i.ytimg.com/vi/${videoId}/${qualityMap[quality]}`;
}

/**
 * Normalize a video ID to ensure consistent casing (lowercase)
 * YouTube video IDs are case-sensitive but URLs are case-insensitive
 * @param videoId - Video ID to normalize
 * @returns Lowercase video ID or empty string
 */
export function normalizeVideoId(videoId: string): string {
  if (!videoId || typeof videoId !== 'string') return '';
  return videoId.toLowerCase().trim();
}

/**
 * Batch extract video IDs from an array of URLs or IDs
 * @param items - Array of URLs or IDs
 * @returns Array of extracted video IDs (filtered to non-null)
 */
export function batchExtractVideoIds(items: string[]): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => extractVideoId(item))
    .filter((id): id is string => id !== null);
}

/**
 * Check if two video IDs or URLs refer to the same video
 * @param first - First video ID or URL
 * @param second - Second video ID or URL
 * @returns True if both extract to the same normalized video ID
 */
export function isSameVideo(first: string, second: string): boolean {
  const id1 = extractVideoId(first);
  const id2 = extractVideoId(second);
  
  if (!id1 || !id2) return false;
  
  return normalizeVideoId(id1) === normalizeVideoId(id2);
}

/**
 * Get the best available artwork URL from a video ID
 * Tries maxresdefault first, falls back to hqdefault
 * @param videoIdOrUrl - Video ID or YouTube URL
 * @returns Best available thumbnail URL
 */
export function getBestArtworkUrl(videoIdOrUrl: string): string {
  const videoId = extractVideoId(videoIdOrUrl);
  if (!videoId) return '';
  
  // maxresdefault is 1280x720, best for player screen
  // hqdefault is 480x360, fallback
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

/**
 * Get a low-res thumbnail for list views (faster loading)
 * @param videoIdOrUrl - Video ID or YouTube URL
 * @returns Low-res thumbnail URL (mqdefault - 320x180)
 */
export function getListThumbnailUrl(videoIdOrUrl: string): string {
  const videoId = extractVideoId(videoIdOrUrl);
  if (!videoId) return '';
  
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * Parse a YouTube URL to extract all available information
 * @param url - Full YouTube URL
 * @returns Object with videoId, type, and timestamp if present
 */
export interface ParsedYouTubeUrl {
  videoId: string | null;
  type: 'watch' | 'shorts' | 'live' | 'embed' | 'unknown';
  startTime?: number;  // seconds
  playlistId?: string;
  isMusic: boolean;
}

export function parseYouTubeUrl(url: string): ParsedYouTubeUrl {
  const result: ParsedYouTubeUrl = {
    videoId: null,
    type: 'unknown',
    isMusic: url.toLowerCase().includes('music.youtube.com'),
  };
  
  if (!url) return result;
  
  const lowerUrl = url.toLowerCase();
  
  // Determine URL type
  if (lowerUrl.includes('/shorts/')) result.type = 'shorts';
  else if (lowerUrl.includes('/live/')) result.type = 'live';
  else if (lowerUrl.includes('/embed/')) result.type = 'embed';
  else if (lowerUrl.includes('watch') || lowerUrl.includes('youtu.be')) result.type = 'watch';
  
  // Extract video ID
  result.videoId = extractVideoId(url);
  
  // Extract start time (t parameter)
  const tMatch = url.match(/[?&]t=(\d+)/);
  if (tMatch) {
    result.startTime = parseInt(tMatch[1], 10);
  }
  
  // Extract playlist ID
  const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (listMatch) {
    result.playlistId = listMatch[1];
  }
  
  return result;
}

// Default export for convenience
export default {
  isYouTubeVideoId,
  isYouTubeUrl,
  extractVideoId,
  toWatchUrl,
  toMusicWatchUrl,
  toThumbnailUrl,
  normalizeVideoId,
  batchExtractVideoIds,
  isSameVideo,
  getBestArtworkUrl,
  getListThumbnailUrl,
  parseYouTubeUrl,
};