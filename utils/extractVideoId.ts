/**
 * Extract YouTube Video ID from various URL formats
 * Matches the Kotlin implementation in MavinEngineModule.kt
 * 
 * Supported formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://music.youtube.com/watch?v=VIDEO_ID
 * - https://youtube.com/shorts/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/v/VIDEO_ID
 * - Direct VIDEO_ID string (11 characters)
 */
export function extractVideoId(url: string): string {
  if (!url) return '';

  // If it's already just a video ID (11 characters alphanumeric + -_)
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }

  // List of regex patterns to match different YouTube URL formats
  const patterns = [
    // Standard YouTube watch URLs
    /(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.*[?&]v=)([a-zA-Z0-9_-]{11})/,
    // YouTu.be short URLs
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    // YouTube Music URLs
    /music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    // YouTube Shorts
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    // Embedded URLs
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    // YouTube video URLs with /v/
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    // YouTube music playlist items (extract video ID from URL params)
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    // Any YouTube domain with video ID in path
    /(?:youtube|youtu\.be|music\.youtube)\.com\/[^?]*(?:\?.*?)?[?&]v=([a-zA-Z0-9_-]{11})/,
    // Fallback: try to find any 11-character alphanumeric string that looks like a video ID
    /\b([a-zA-Z0-9_-]{11})\b/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  // If no patterns match, return the original string (will likely cause errors, but better than undefined)
  console.warn(`[extractVideoId] Could not extract video ID from: ${url}`);
  return url;
}

/**
 * Check if a string is a valid YouTube video ID
 */
export function isValidVideoId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

/**
 * Extract video ID from a track item (handles both id and videoId properties)
 */
export function extractVideoIdFromItem(item: any): string | null {
  if (!item) return null;
  
  // Check common property names
  const possibleIds = [
    item.videoId,
    item.id,
    item.url,
    item.permalink
  ];

  for (const possibleId of possibleIds) {
    if (!possibleId) continue;
    
    // If it's already a valid ID
    if (isValidVideoId(possibleId)) {
      return possibleId;
    }
    
    // If it's a URL, try to extract
    if (typeof possibleId === 'string') {
      const extracted = extractVideoId(possibleId);
      if (isValidVideoId(extracted)) {
        return extracted;
      }
    }
  }

  return null;
}

/**
 * Extract playlist ID from YouTube URL
 */
export function extractPlaylistId(url: string): string | null {
  if (!url) return null;

  const patterns = [
    /[?&]list=([a-zA-Z0-9_-]+)/,
    /youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Build YouTube watch URL from video ID
 */
export function buildYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Build YouTube Music URL from video ID
 */
export function buildYouTubeMusicUrl(videoId: string): string {
  return `https://music.youtube.com/watch?v=${videoId}`;
}