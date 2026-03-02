// ./modules/modules/mavin-engine/index.ts
// ✅ COMPLETE - Your structure + ALL 15+ new MavinEngine methods

import { requireNativeModule } from 'expo-modules-core';

// ======================
// Type Definitions (Extended)
// ======================

export interface AudioResult {
  url: string;
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  views: number;
  likes?: number;
  expires: string;
  quality: 'high' | 'medium' | 'low';
  success: boolean;
}

export interface CoverItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  views: number;
  type?: string;
}

export interface SearchResult {
  type: 'song' | 'playlist' | 'artist';
  id: string;
  videoId?: string;
  title: string;
  artist?: string;
  thumbnail: string;
  views?: number;
  trackCount?: number;
  subscribers?: number;
  verified?: boolean;
}

export interface ExtractAudioOptions {
  artist: string;
  title: string;
  isrc?: string;
}

export interface ExtractFromVideoIdOptions {
  videoId: string;
}

// ======================
// Native Module Access
// ======================

export const MavinEngine = requireNativeModule('MavinEngine');

// ======================
// Type-Safe Wrapper Functions (Original + NEW)
// ======================

// ORIGINAL - Audio Extraction
export const extractAudio = async (
  artist: string,
  title: string,
  isrc?: string
): Promise<AudioResult> => {
  try {
    if (!MavinEngine?.extractAudio) {
      throw new Error('MavinEngine.extractAudio function is not available.');
    }
    return await MavinEngine.extractAudio(artist, title, isrc);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Audio extraction failed: ${errorMessage}`);
  }
};

export const extractFromVideoId = async (videoId: string): Promise<AudioResult> => {
  try {
    if (!MavinEngine?.extractAudioFromVideoId) {
      throw new Error('MavinEngine.extractAudioFromVideoId function is not available.');
    }
    return await MavinEngine.extractAudioFromVideoId(videoId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Video ID extraction failed: ${errorMessage}`);
  }
};

// ✅ NEW - Home Screen Sections (Your hook will work!)
export const getCoverSongs = async (): Promise<CoverItem[]> => {
  try {
    if (!MavinEngine?.getCoverSongs) {
      throw new Error('MavinEngine.getCoverSongs not available');
    }
    return await MavinEngine.getCoverSongs();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Cover songs fetch failed: ${errorMessage}`);
  }
};

export const getTrendingMusic = async (): Promise<CoverItem[]> => {
  try {
    return await MavinEngine.getTrendingMusic();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Trending fetch failed');
  }
};

export const getTopCharts = async (chartType: string = 'top50'): Promise<any[]> => {
  try {
    return await MavinEngine.getTopCharts(chartType);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Charts fetch failed');
  }
};

export const getNewReleases = async (): Promise<any[]> => {
  try {
    return await MavinEngine.getNewReleases();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'New releases fetch failed');
  }
};

export const getGenreStations = async (genre: string): Promise<any[]> => {
  try {
    return await MavinEngine.getGenreStations(genre);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Genre fetch failed');
  }
};

export const getPopularChoice = async (): Promise<any[]> => {
  try {
    return await MavinEngine.getPopularChoice();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Popular fetch failed');
  }
};

export const getMonthlyTop = async (): Promise<any[]> => {
  try {
    return await MavinEngine.getMonthlyTop();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Monthly top fetch failed');
  }
};

export const getEditorPicks = async (): Promise<any[]> => {
  try {
    return await MavinEngine.getEditorPicks();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Editor picks fetch failed');
  }
};

export const getSponsoredContent = async (): Promise<any[]> => {
  try {
    return await MavinEngine.getSponsoredContent();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Sponsored fetch failed');
  }
};

export const getPodcasts = async (): Promise<any[]> => {
  try {
    return await MavinEngine.getPodcasts();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Podcasts fetch failed');
  }
};

export const getLiveStations = async (): Promise<any[]> => {
  try {
    return await MavinEngine.getLiveStations();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Live fetch failed');
  }
};

export const searchMusic = async (query: string, filter?: string): Promise<SearchResult[]> => {
  try {
    return await MavinEngine.searchMusic(query, filter);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Search failed');
  }
};

export const getTrackDetails = async (videoId: string): Promise<any> => {
  try {
    return await MavinEngine.getTrackDetails(videoId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Track details failed');
  }
};

export const handleDeepLink = async (url: string): Promise<any> => {
  try {
    return await MavinEngine.handleDeepLink(url);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Deep link failed');
  }
};

// ======================
// Default Export (BACKWARD COMPATIBLE)
// ======================

export default {
  extractAudio,
  extractFromVideoId,
  MavinEngine,
  // ✅ ALL NEW METHODS - Your hook works!
  getCoverSongs,
  getTrendingMusic,
  getTopCharts,
  getNewReleases,
  getGenreStations,
  getPopularChoice,
  getMonthlyTop,
  getEditorPicks,
  getSponsoredContent,
  getPodcasts,
  getLiveStations,
  searchMusic,
  getTrackDetails,
  handleDeepLink,
};
