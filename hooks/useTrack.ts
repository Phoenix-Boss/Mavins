// src/hooks/useTrack.ts
import { useState, useCallback } from 'react';
import { getStreamInfo, getStreamInfoById, search, StreamInfo } from '@/modules/mavin-engine';

// Inline interface for track data - matches what the UI expects
interface TrackData {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  url?: string; // Full stream URL for playback
}

// Simple params interface - no external dependencies
interface GetTrackParams {
  trackId?: string; // URL or video ID
  artistName?: string;
  trackName?: string;
}

interface UseTrackReturn {
  fetchTrack: (params: GetTrackParams) => Promise<void>;
  track: TrackData | null;
  loading: boolean;
  error: string | null;
  clearTrack: () => void;
}

export const useTrack = (): UseTrackReturn => {
  const [track, setTrack] = useState<TrackData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrack = useCallback(async (params: GetTrackParams) => {
    // Support both URL and ID-based fetching
    if (!params.trackId && !params.artistName) {
      setError('Either trackId (URL) or artistName is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let result: StreamInfo;

      // If trackId looks like a URL, use getStreamInfo, otherwise use getStreamInfoById
      if (params.trackId && (params.trackId.startsWith('http') || params.trackId.startsWith('https'))) {
        result = await getStreamInfo(params.trackId, 0);
      } else if (params.trackId) {
        // Assume it's a video ID
        result = await getStreamInfoById(params.trackId, 0);
      } else {
        // Fallback: search by artist name if no ID provided
        const searchResult = await search(`${params.artistName} ${params.trackName || ''}`, 'songs', undefined, 0);
        if (!searchResult.success || !searchResult.results.length) {
          throw new Error('Track not found');
        }
        const firstResult = searchResult.results[0];
        if (firstResult.type !== 'stream') {
          throw new Error('No stream found');
        }
        result = await getStreamInfo(firstResult.url, 0);
      }

      if (result && result.success) {
        // Map StreamInfo to TrackData
        const trackData: TrackData = {
          id: result.id,
          title: result.title,
          artist: result.uploaderName,
          duration: result.duration,
          thumbnail: result.thumbnails?.[0]?.url || '',
          url: result.url, // Full URL for playback
        };
        setTrack(trackData);
      } else {
        setError('Track not found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch track');
      console.error('Track fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearTrack = useCallback(() => {
    setTrack(null);
    setError(null);
  }, []);

  return {
    fetchTrack,
    track,
    loading,
    error,
    clearTrack,
  };
};
