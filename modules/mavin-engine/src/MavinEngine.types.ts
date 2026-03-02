// modules/mavin-engine/src/MavinEngine.types.ts

/**
 * Core audio result returned by the extraction functions
 */
export interface AudioResult {
  url: string;
  videoId: string;
  expires: string; // ISO date string
  quality: 'low' | 'medium' | 'high';
  success: boolean;
}

/**
 * Events that can be emitted by the module
 * Index signature must return a function, not undefined
 */
export interface MavinEngineModuleEvents {
  onExtractionStart: (videoId: string) => void;
  onExtractionSuccess: (result: AudioResult) => void;
  onExtractionError: (error: string) => void;
  onChange: (payload: ChangeEventPayload) => void;
  
  // Index signature - must return a function, not undefined
  [eventName: string]: (...args: any[]) => void;
}

/**
 * Change event payload (for web module)
 */
export interface ChangeEventPayload {
  value: string;
}

/**
 * Options for extracting audio by artist and title (from Step 3 metadata)
 */
export type ExtractAudioOptions = {
  artist: string;
  title: string;
  isrc?: string;        // International Standard Recording Code for perfect matching
  duration?: number;     // Optional duration for verification
};

/**
 * Options for extracting audio directly from a YouTube video ID
 */
export type ExtractFromVideoIdOptions = {
  videoId: string;
};

/**
 * Search result from YouTube Music/InnerTube
 */
export interface SearchResult {
  videoId: string;
  title: string;
  duration: number;
  artist?: string;
  thumbnail?: string;
}

/**
 * Stream format from YouTube's player response
 */
export interface StreamFormat {
  itag: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;       // Alternative field name sometimes used
  mimeType: string;
  bitrate?: number;
  audioQuality?: string;
  contentLength?: string;
  approxDurationMs?: string;
  audioSampleRate?: string;
  audioChannels?: number;
}

/**
 * Complete player response from YouTube InnerTube
 */
export interface PlayerResponse {
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: string;
    author: string;
    channelId: string;
    shortDescription?: string;
    thumbnail?: {
      thumbnails: Array<{
        url: string;
        width: number;
        height: number;
      }>;
    };
    viewCount?: string;
    averageRating?: number;
  };
  streamingData?: {
    formats: StreamFormat[];
    adaptiveFormats: StreamFormat[];
    expiresInSeconds: string;
    dashManifestUrl?: string;
    hlsManifestUrl?: string;
  };
  playabilityStatus?: {
    status: string;
    reason?: string;
    errorScreen?: {
      playabilityError?: {
        reason: string;
      };
    };
  };
  microformat?: {
    playerMicroformatRenderer?: {
      lengthSeconds: string;
      ownerProfileUrl: string;
      externalChannelId: string;
      publishDate?: string;
    };
  };
}

/**
 * Error response from the module
 */
export interface ModuleError {
  code: string;
  message: string;
  stack?: string;
}

/**
 * Props for the MavinEngineView component
 */
export interface MavinEngineViewProps {
  url?: string;
  style?: any;
  onLoad?: (event: { nativeEvent: { url: string } }) => void;
  onError?: (event: { nativeEvent: { error: string } }) => void;
}

/**
 * Type guard to check if a result is an AudioResult
 */
export function isAudioResult(result: any): result is AudioResult {
  return (
    result &&
    typeof result === 'object' &&
    typeof result.url === 'string' &&
    typeof result.videoId === 'string' &&
    typeof result.expires === 'string' &&
    ['low', 'medium', 'high'].includes(result.quality) &&
    typeof result.success === 'boolean'
  );
}

/**
 * Type guard to check if a result is an error
 */
export function isModuleError(result: any): result is ModuleError {
  return (
    result &&
    typeof result === 'object' &&
    typeof result.code === 'string' &&
    typeof result.message === 'string'
  );
}

/**
 * Type guard to check if options are for artist/title extraction
 */
export function isExtractAudioOptions(options: any): options is ExtractAudioOptions {
  return (
    options &&
    typeof options === 'object' &&
    typeof options.artist === 'string' &&
    typeof options.title === 'string'
  );
}

/**
 * Type guard to check if options are for video ID extraction
 */
export function isExtractFromVideoIdOptions(options: any): options is ExtractFromVideoIdOptions {
  return (
    options &&
    typeof options === 'object' &&
    typeof options.videoId === 'string'
  );
}