// modules/mavin-engine/src/MavinEngineModule.web.ts
import { registerWebModule, NativeModule } from 'expo';
import { 
  AudioResult, 
  ExtractAudioOptions,
  ExtractFromVideoIdOptions,
  ChangeEventPayload 
} from './MavinEngine.types';

type MavinEngineModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
  onExtractionStart?: (videoId: string) => void;
  onExtractionSuccess?: (result: AudioResult) => void;
  onExtractionError?: (error: string) => void;
}

class MavinEngineWebModule extends NativeModule<MavinEngineModuleEvents> {
  PI = Math.PI;
  
  // Web implementation - throws helpful error or could call a backend API
  async extractAudio(artist: string, title: string, isrc?: string): Promise<AudioResult> {
    console.log('🌐 Web module: YouTube extraction requested for:', { artist, title, isrc });
    
    // Option 1: Throw error (recommended for web)
    throw new Error(
      'YouTube audio extraction is not available on web. ' +
      'Please use the native Android app for this feature.'
    );
    
    // Option 2: If you have a backend API, you could call it here:
    // const response = await fetch('https://your-api.com/extract', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ artist, title, isrc })
    // });
    // return response.json();
  }
  
  async extractAudioFromVideoId(videoId: string): Promise<AudioResult> {
    console.log('🌐 Web module: Video extraction requested for:', videoId);
    
    throw new Error(
      'YouTube audio extraction is not available on web. ' +
      'Please use the native Android app for this feature.'
    );
  }
  
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value } as ChangeEventPayload);
    console.log('Value set to:', value);
  }
  
  hello(): string {
    return 'Hello from MavinEngine Web! 👋';
  }
}

// Register the web module
export default registerWebModule(MavinEngineWebModule, 'MavinEngine');