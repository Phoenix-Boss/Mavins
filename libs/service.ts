// libs/service.ts
//
// RNTP 4.1.2 Playback Service — New Architecture compatible

import TrackPlayer, { Event, State } from 'react-native-track-player';

let _isPlaying = false;
let _position  = 0;
let _duration  = 0;

async function safe(fn: () => Promise<unknown>, label: string, retries = 1): Promise<void> {
  try {
    await fn();
    console.log(`[PlaybackService] ✅ ${label}`);
  } catch (e) {
    if (retries > 0) {
      console.log(`[PlaybackService] ⚠️ ${label} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 50));
      return safe(fn, label, retries - 1);
    }
    console.error(`[PlaybackService] ❌ ${label} failed:`, e);
  }
}

export async function PlaybackService(): Promise<void> {
  console.log('[PlaybackService] Started');

  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }: { state: string | number }) => {
    _isPlaying = state === State.Playing || state === 'playing';
    console.log(`[PlaybackService] State → ${state}`);
  });

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }: { position: number; duration: number; buffered: number }) => {
    _position = position;
    _duration = duration;
  });

  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    safe(() => TrackPlayer.play(), 'RemotePlay');
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    safe(() => TrackPlayer.pause(), 'RemotePause');
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    safe(() => TrackPlayer.stop(), 'RemoteStop');
  });

  TrackPlayer.addEventListener(Event.RemoteTogglePlayback, () => {
    if (_isPlaying) {
      safe(() => TrackPlayer.pause(), 'TogglePause');
    } else {
      safe(() => TrackPlayer.play(), 'TogglePlay');
    }
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    safe(() => TrackPlayer.skipToNext(), 'RemoteNext');
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    if (_position > 3) {
      safe(() => TrackPlayer.seekTo(0), 'SeekToStart');
    } else {
      safe(() => TrackPlayer.skipToPrevious(), 'SkipToPrevious');
    }
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }: { position: number }) => {
    if (typeof position === 'number' && !isNaN(position) && position >= 0 && position <= _duration) {
      safe(() => TrackPlayer.seekTo(position), 'RemoteSeek');
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpForward, ({ interval }: { interval: number }) => {
    const newPos = Math.min(_position + (interval ?? 10), _duration);
    safe(() => TrackPlayer.seekTo(newPos), 'JumpForward');
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, ({ interval }: { interval: number }) => {
    const newPos = Math.max(0, _position - (interval ?? 10));
    safe(() => TrackPlayer.seekTo(newPos), 'JumpBackward');
  });

  // Note: RemoteLike / RemoteDislike / RemoteBookmark / RemoteSetRating
  // were removed in react-native-track-player v5 alpha — listeners omitted.

  TrackPlayer.addEventListener(Event.RemoteDuck, ({ paused, permanent }: { paused: boolean; permanent: boolean }) => {
    console.log(`[PlaybackService] 🎧 Duck (paused: ${paused}, permanent: ${permanent})`);
    if (permanent || paused) {
      safe(() => TrackPlayer.pause(), 'DuckPause');
    } else {
      safe(() => TrackPlayer.play(), 'DuckResume');
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackError, ({ code, message }: { code: string; message: string }) => {
    console.error('[PlaybackService] ❌ PlaybackError:', code, message);
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, ({ track, position }: { track: number; position: number }) => {
    console.log(`[PlaybackService] ⏹️ Queue ended at track ${track}, pos ${position}`);
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ index, track }: { index: number; track: { title?: string } | undefined }) => {
    console.log(`[PlaybackService] 🎵 Active track [${index}]: ${track?.title ?? 'Unknown'}`);
  });

  TrackPlayer.addEventListener(Event.PlaybackReady, () => {
    console.log('[PlaybackService] ✅ Playback ready');
  });

  TrackPlayer.addEventListener(Event.AudioChapterMetadataReceived, ({ metadata }: { metadata: unknown }) => {
    console.log('[PlaybackService] 📝 Chapter metadata:', metadata);
  });

  TrackPlayer.addEventListener(Event.AudioTimedMetadataReceived, ({ metadata }: { metadata: unknown }) => {
    console.log('[PlaybackService] 📝 Timed metadata:', metadata);
  });

  TrackPlayer.addEventListener(Event.AudioCommonMetadataReceived, ({ metadata }: { metadata: unknown }) => {
    console.log('[PlaybackService] 📝 Common metadata:', metadata);
  });

  console.log('[PlaybackService] ✅ All listeners registered');
}

export default PlaybackService;