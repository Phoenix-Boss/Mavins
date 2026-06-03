import { requireNativeModule, EventEmitter } from 'expo-modules-core';

const Native = requireNativeModule('MavinPlayer');

export type PlayMode =
  | 'IDLE'
  | 'EMBEDDED_VIDEO'
  | 'FULLSCREEN_VIDEO'
  | 'PIP'
  | 'FULLSCREEN_AUDIO'
  | 'EMBEDDED_AUDIO';

export type RepeatMode = 'off' | 'one' | 'all';

export interface PlayerState {
  isPlaying: boolean;
  position: number;
  duration: number;
  bufferedPercent: number;
  playMode: PlayMode;
  repeatMode: RepeatMode;
  shuffle: boolean;
  currentItem: string;
}

// ── FIX: EventEmitter expects EventsMap where each property is a function type ──
type MavinPlayerEvents = {
  onPlaybackStateChanged: (e: {
    state: string;
    isPlaying: boolean;
    playMode: PlayMode;
  }) => void;
  onPositionChanged: (e: {
    position: number;
    duration: number;
    bufferedPercent: number;
  }) => void;
  onTrackChanged: (e: { item: string }) => void;
  onPlaylistChanged: (e: { playlist: string[] }) => void;
  onError: (e: { message: string }) => void;
};

const emitter = new EventEmitter<MavinPlayerEvents>(Native);

const MavinPlayer = {
  // ── Core playback ────────────────────────────────────────────────────────
  playStream: (videoId: string): Promise<{ success: boolean }> =>
    Native.playStream(videoId),
  playStreamEmbedded: (videoId: string): Promise<{ success: boolean }> =>
    Native.playStreamEmbedded(videoId),
  playStreamVideo: (videoId: string): Promise<{ success: boolean }> =>
    Native.playStreamVideo(videoId),

  play: (): Promise<{ success: boolean }> => Native.play(),
  pause: (): Promise<{ success: boolean }> => Native.pause(),
  prepare: (): Promise<{ success: boolean }> => Native.prepare(),
  release: (): Promise<{ success: boolean }> => Native.release(),
  seekTo: (positionMs: number): Promise<{ success: boolean }> =>
    Native.seekTo(positionMs),

  // ── Queue management ─────────────────────────────────────────────────────
  addToPlaylist: (videoId: string): Promise<{ success: boolean }> =>
    Native.addToPlaylist(videoId),
  removeFromPlaylist: (uniqueId: number): Promise<{ success: boolean }> =>
    Native.removeFromPlaylist(uniqueId),
  movePlaylistItem: (
    fromIndex: number,
    toIndex: number
  ): Promise<{ success: boolean }> =>
    Native.movePlaylistItem(fromIndex, toIndex),
  skipToPlaylistItem: (index: number): Promise<{ success: boolean }> =>
    Native.skipToPlaylistItem(index),

  // ── Settings ─────────────────────────────────────────────────────────────
  setRepeatMode: (mode: RepeatMode): Promise<{ success: boolean }> =>
    Native.setRepeatMode(mode),
  setShuffle: (enabled: boolean): Promise<{ success: boolean }> =>
    Native.setShuffle(enabled),
  setPlaybackSpeed: (speed: number): Promise<{ success: boolean }> =>
    Native.setPlaybackSpeed(speed),
  selectChapter: (index: number): Promise<{ success: boolean }> =>
    Native.selectChapter(index),

  // ── State ────────────────────────────────────────────────────────────────
  getState: (): Promise<PlayerState> => Native.getState(),

  // ── Events ───────────────────────────────────────────────────────────────
  onPlaybackStateChanged: (
    listener: (e: {
      state: string;
      isPlaying: boolean;
      playMode: PlayMode;
    }) => void
  ) => emitter.addListener('onPlaybackStateChanged', listener),

  onPositionChanged: (
    listener: (e: {
      position: number;
      duration: number;
      bufferedPercent: number;
    }) => void
  ) => emitter.addListener('onPositionChanged', listener),

  onTrackChanged: (
    listener: (e: { item: string }) => void
  ) => emitter.addListener('onTrackChanged', listener),

  onPlaylistChanged: (
    listener: (e: { playlist: string[] }) => void
  ) => emitter.addListener('onPlaylistChanged', listener),

  onError: (
    listener: (e: { message: string }) => void
  ) => emitter.addListener('onError', listener),
};

export default MavinPlayer;