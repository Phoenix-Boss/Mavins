import { requireNativeModule, requireNativeViewManager, EventEmitter } from 'expo-modules-core';
import React from 'react';

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

/**
 * The HTTP context captured by MavinEngine at extraction time.
 * These are the exact session credentials that were sent to YouTube
 * during the resolution request. They must travel to ExoPlayer unchanged
 * so that CDN segment requests carry the same session identity.
 *
 * Industry standard: Origin, Referer, and Cookie on segment requests
 * must match the values used during resolution. YouTube CDN validates this.
 */
export interface PlayerHttpContext {
  /** Raw cookie string (e.g. "SOCS=CAISAiAD; ..."). Injected as Cookie header. */
  cookie: string;
  /** Always "https://www.youtube.com" */
  origin: string;
  /** Always "https://www.youtube.com/" */
  referer: string;
  acceptLanguage: string;
  xYoutubeClientName: string;
  xYoutubeClientVersion: string;
  userAgent: string;
}

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

  // ── PRIMARY ENTRY POINT ───────────────────────────────────────────────────
  //
  // loadAndPlay — industry standard one-cycle handoff.
  //
  // Call this when you have a fully resolved bundle from MavinEngine.
  // Pass the pre-resolved URLs and the HTTP context that produced them.
  // The Kotlin module stores the bundle, then fires playStream internally.
  // NewPlayer reads streams and HTTP context directly from the stored bundle.
  // ExoPlayer fetches CDN segments with the exact same session that extracted.
  //
  // Priority of URL selection (set by JS before calling):
  //   dashManifestUrl  — first preference (DASH, adaptive, session-bound)
  //   hlsManifestUrl   — second preference
  //   progressiveAudioUrl — last resort, only when no manifests available
  //
  // httpContext must be captured from MavinEngine at extraction time.
  // Pass null for httpContext only for local files (never for YouTube).

  loadAndPlay: (
    videoId: string,
    dashManifestUrl: string | null,
    hlsManifestUrl: string | null,
    progressiveAudioUrl: string | null,
    httpContext: PlayerHttpContext | null
  ): Promise<{ success: boolean }> =>
    Native.loadAndPlay(
      videoId,
      dashManifestUrl,
      hlsManifestUrl,
      progressiveAudioUrl,
      httpContext
    ),

  loadAndPlayVideo: (
    videoId: string,
    dashManifestUrl: string | null,
    hlsManifestUrl: string | null,
    progressiveAudioUrl: string | null,
    httpContext: PlayerHttpContext | null
  ): Promise<{ success: boolean }> =>
    Native.loadAndPlayVideo(
      videoId,
      dashManifestUrl,
      hlsManifestUrl,
      progressiveAudioUrl,
      httpContext
    ),

  // ── Legacy playStream — kept for backwards compatibility ──────────────────
  // Use loadAndPlay() instead for all new remote tracks.
  // playStream() will fail if no bundle has been stored for the given videoId.

  playStream: (videoId: string): Promise<{ success: boolean }> =>
    Native.playStream(videoId),

  playStreamEmbedded: (videoId: string): Promise<{ success: boolean }> =>
    Native.playStreamEmbedded(videoId),

  playStreamVideo: (videoId: string): Promise<{ success: boolean }> =>
    Native.playStreamVideo(videoId),

  // ── Core playback ─────────────────────────────────────────────────────────

  play:    (): Promise<{ success: boolean }> => Native.play(),
  pause:   (): Promise<{ success: boolean }> => Native.pause(),
  prepare: (): Promise<{ success: boolean }> => Native.prepare(),
  release: (): Promise<{ success: boolean }> => Native.release(),

  seekTo: (positionMs: number): Promise<{ success: boolean }> =>
    Native.seekTo(positionMs),

  // ── Queue management ──────────────────────────────────────────────────────

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

  // ── Settings ──────────────────────────────────────────────────────────────

  setRepeatMode: (mode: RepeatMode): Promise<{ success: boolean }> =>
    Native.setRepeatMode(mode),

  setShuffle: (enabled: boolean): Promise<{ success: boolean }> =>
    Native.setShuffle(enabled),

  setPlaybackSpeed: (speed: number): Promise<{ success: boolean }> =>
    Native.setPlaybackSpeed(speed),

  selectChapter: (index: number): Promise<{ success: boolean }> =>
    Native.selectChapter(index),

  // ── State ─────────────────────────────────────────────────────────────────

  getState: (): Promise<PlayerState> => Native.getState(),

  // ── Events ────────────────────────────────────────────────────────────────

  onPlaybackStateChanged: (
    listener: (e: { state: string; isPlaying: boolean; playMode: PlayMode }) => void
  ) => emitter.addListener('onPlaybackStateChanged', listener),

  onPositionChanged: (
    listener: (e: { position: number; duration: number; bufferedPercent: number }) => void
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

// ── Native video surface component ────────────────────────────────────────────
//
// MavinPlayerVideoView renders the ExoPlayer video frames inside a React Native
// view. It attaches a SurfaceView to the live NewPlayer ExoPlayer instance when
// mounted, and clears the surface (audio-only continues) when unmounted.
//
// Used in playerContent.tsx to render the Video tab without a second player.
// Registered on the Kotlin side via the View() block in MavinPlayerModule.
export const MavinPlayerVideoView: React.ComponentType<{
  style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
  contentFit?: 'cover' | 'contain' | 'stretch';
  allowsPictureInPicture?: boolean;
  onFirstFrameRender?: (e: { surfaceReady: boolean }) => void;
  onPictureInPictureStart?: () => void;
  onPictureInPictureStop?: () => void;
}> = requireNativeViewManager('MavinPlayerVideoView');