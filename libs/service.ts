// libs/service.ts
//
// RNTP 4.1.2 Playback Service — New Architecture compatible
//
// Key changes for 4.1.2 New Architecture (bridgeless mode):
// - Use Event enum directly (no defensive string fallbacks needed in New Arch)
// - PlaybackActiveTrackChanged replaces PlaybackTrackChanged for active track
// - AudioChapterMetadataReceived replaces deprecated AudioCommonMetadataReceived

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

  // Track playback state for toggle logic
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    _isPlaying = state === State.Playing;
    console.log(`[PlaybackService] State → ${state}`);
  });

  // Track position/duration for seek bounds checking
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    _position = position;
    _duration = duration;
  });

  // Remote control events
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

  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => {
    if (typeof position === 'number' && !isNaN(position) && position >= 0 && position <= _duration) {
      safe(() => TrackPlayer.seekTo(position), 'RemoteSeek');
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpForward, ({ interval = 10 }) => {
    const newPos = Math.min(_position + interval, _duration);
    safe(() => TrackPlayer.seekTo(newPos), 'JumpForward');
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, ({ interval = 10 }) => {
    const newPos = Math.max(0, _position - interval);
    safe(() => TrackPlayer.seekTo(newPos), 'JumpBackward');
  });

  TrackPlayer.addEventListener(Event.RemoteLike, () => {
    console.log('[PlaybackService] 📱 RemoteLike');
  });

  TrackPlayer.addEventListener(Event.RemoteDislike, () => {
    console.log('[PlaybackService] 📱 RemoteDislike');
  });

  TrackPlayer.addEventListener(Event.RemoteBookmark, () => {
    console.log('[PlaybackService] 📱 RemoteBookmark');
  });

  TrackPlayer.addEventListener(Event.RemoteSetRating, ({ rating }) => {
    console.log(`[PlaybackService] 📱 RemoteSetRating: ${rating}`);
  });

  TrackPlayer.addEventListener(Event.RemoteDuck, ({ paused, permanent }) => {
    console.log(`[PlaybackService] 🎧 Duck (paused: ${paused}, permanent: ${permanent})`);
    if (permanent || paused) {
      safe(() => TrackPlayer.pause(), 'DuckPause');
    } else {
      safe(() => TrackPlayer.play(), 'DuckResume');
    }
  });

  // Playback lifecycle events
  TrackPlayer.addEventListener(Event.PlaybackError, ({ code, message }) => {
    console.error('[PlaybackService] ❌ PlaybackError:', code, message);
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, ({ track, position }) => {
    console.log(`[PlaybackService] ⏹️ Queue ended at track ${track}, pos ${position}`);
  });

  // PlaybackActiveTrackChanged is the correct event in 4.1.2
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ index, track }) => {
    console.log(`[PlaybackService] 🎵 Active track [${index}]: ${track?.title ?? 'Unknown'}`);
  });

  TrackPlayer.addEventListener(Event.PlaybackReady, () => {
    console.log('[PlaybackService] ✅ Playback ready');
  });

  // Metadata events (4.1.2 uses these three)
  TrackPlayer.addEventListener(Event.AudioChapterMetadataReceived, ({ metadata }) => {
    console.log('[PlaybackService] 📝 Chapter metadata:', metadata);
  });

  TrackPlayer.addEventListener(Event.AudioTimedMetadataReceived, ({ metadata }) => {
    console.log('[PlaybackService] 📝 Timed metadata:', metadata);
  });

  TrackPlayer.addEventListener(Event.AudioCommonMetadataReceived, ({ metadata }) => {
    console.log('[PlaybackService] 📝 Common metadata:', metadata);
  });

  console.log('[PlaybackService] ✅ All listeners registered');
}

export default PlaybackService;