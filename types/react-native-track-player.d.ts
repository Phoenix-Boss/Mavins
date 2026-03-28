declare module 'react-native-track-player' {
  export function getAudioSessionId(): Promise<number>;
  
  // Add any other existing exports you need
  export const Capability: any;
  export const AppKilledPlaybackBehavior: any;
  export const Event: any;
  export const State: any;
  export function usePlaybackState(): any;
  export function useActiveTrack(): any;
  export function setupPlayer(config?: any): Promise<void>;
  export function updateOptions(options: any): Promise<void>;
  export function addEventListener(event: any, listener: any): any;
  export function play(): Promise<void>;
  export function pause(): Promise<void>;
  export function stop(): Promise<void>;
  export function skipToNext(): Promise<void>;
  export function skipToPrevious(): Promise<void>;
  export function seekTo(position: number): Promise<void>;
  export function getQueue(): Promise<any[]>;
  export function add(tracks: any[]): Promise<void>;
  export function reset(): Promise<void>;
  export function getVolume(): Promise<number>;
  export function setVolume(volume: number): Promise<void>;
}
