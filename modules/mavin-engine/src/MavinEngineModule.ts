// modules/mavin-engine/src/MavinEngineModule.ts
import { NativeModule, requireNativeModule } from 'expo';
import { 
  AudioResult, 
  MavinEngineModuleEvents,
  ExtractAudioOptions,
  ExtractFromVideoIdOptions
} from './MavinEngine.types';


declare class MavinEngineModule extends NativeModule<MavinEngineModuleEvents> {
  extractAudio(
    artist: string, 
    title: string, 
    isrc?: string
  ): Promise<AudioResult>;
  
  extractAudioFromVideoId(videoId: string): Promise<AudioResult>;
}

// Load the native module - will throw if not found (production behavior)
const MavinEngine = requireNativeModule<MavinEngineModule>('MavinEngine');
console.log('✅ MavinEngine native module loaded successfully');

// Input validation helpers
const validateExtractAudioOptions = (options: ExtractAudioOptions): void => {
  if (!options.artist?.trim()) {
    throw new Error('Artist is required and cannot be empty');
  }
  if (!options.title?.trim()) {
    throw new Error('Title is required and cannot be empty');
  }
};

const validateExtractFromVideoIdOptions = (options: ExtractFromVideoIdOptions): void => {
  if (!options.videoId?.trim()) {
    throw new Error('Video ID is required and cannot be empty');
  }
};

// Export the native module directly
export default MavinEngine;

// Named exports with validation
export const extractAudio = async (options: ExtractAudioOptions): Promise<AudioResult> => {
  validateExtractAudioOptions(options);
  return MavinEngine.extractAudio(options.artist, options.title, options.isrc);
};

export const extractFromVideoId = async (options: ExtractFromVideoIdOptions): Promise<AudioResult> => {
  validateExtractFromVideoIdOptions(options);
  return MavinEngine.extractAudioFromVideoId(options.videoId);
};

// Re-export types
export type { 
  AudioResult, 
  MavinEngineModuleEvents,
  ExtractAudioOptions,
  ExtractFromVideoIdOptions 
} from './MavinEngine.types';
