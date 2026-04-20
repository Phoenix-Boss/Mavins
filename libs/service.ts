// libs/service.ts
//
// RNTP Playback Service — handles all remote-control events.
// Uses State enum for comparison instead of PlaybackState type.

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

// Safe enum accessor — prevents null reference during hot reload
const getEvent = (eventName: keyof typeof Event): any => {
  return Event?.[eventName] ?? eventName;
};

const getStateValue = (stateName: keyof typeof State): any => {
  return State?.[stateName] ?? stateName;
};

export async function PlaybackService(): Promise<void> {
  console.log('[PlaybackService] Started');

  TrackPlayer.addEventListener(getEvent('PlaybackState'), ({ state }: any) => {
    // Compare against State.Playing value (typically 3)
    _isPlaying = state === getStateValue('Playing');
    console.log(`[PlaybackService] State → ${state}`);
  });

  TrackPlayer.addEventListener(getEvent('PlaybackProgressUpdated'), ({ position, duration }: any) => {
    _position = position;
    _duration = duration;
  });

  TrackPlayer.addEventListener(getEvent('RemotePlay'), () => {
    safe(() => TrackPlayer.play(), 'RemotePlay');
  });

  TrackPlayer.addEventListener(getEvent('RemotePause'), () => {
    safe(() => TrackPlayer.pause(), 'RemotePause');
  });

  TrackPlayer.addEventListener(getEvent('RemoteStop'), () => {
    safe(() => TrackPlayer.stop(), 'RemoteStop');
  });

  TrackPlayer.addEventListener(getEvent('RemoteTogglePlayback'), () => {
    if (_isPlaying) {
      safe(() => TrackPlayer.pause(), 'TogglePause');
    } else {
      safe(() => TrackPlayer.play(), 'TogglePlay');
    }
  });

  TrackPlayer.addEventListener(getEvent('RemoteNext'), () => {
    safe(() => TrackPlayer.skipToNext(), 'RemoteNext');
  });

  TrackPlayer.addEventListener(getEvent('RemotePrevious'), () => {
    if (_position > 3) {
      safe(() => TrackPlayer.seekTo(0), 'SeekToStart');
    } else {
      safe(() => TrackPlayer.skipToPrevious(), 'SkipToPrevious');
    }
  });

  TrackPlayer.addEventListener(getEvent('RemoteSeek'), ({ position }: any) => {
    if (typeof position === 'number' && !isNaN(position) && position >= 0 && position <= _duration) {
      safe(() => TrackPlayer.seekTo(position), 'RemoteSeek');
    }
  });

  TrackPlayer.addEventListener(getEvent('RemoteJumpForward'), ({ interval = 10 }: any) => {
    const newPos = Math.min(_position + interval, _duration);
    safe(() => TrackPlayer.seekTo(newPos), 'JumpForward');
  });

  TrackPlayer.addEventListener(getEvent('RemoteJumpBackward'), ({ interval = 10 }: any) => {
    const newPos = Math.max(0, _position - interval);
    safe(() => TrackPlayer.seekTo(newPos), 'JumpBackward');
  });

  TrackPlayer.addEventListener(getEvent('RemoteLike'), () => {
    console.log('[PlaybackService] 📱 RemoteLike');
  });

  TrackPlayer.addEventListener(getEvent('RemoteDislike'), () => {
    console.log('[PlaybackService] 📱 RemoteDislike');
  });

  TrackPlayer.addEventListener(getEvent('RemoteBookmark'), () => {
    console.log('[PlaybackService] 📱 RemoteBookmark');
  });

  TrackPlayer.addEventListener(getEvent('RemoteSetRating'), ({ rating }: any) => {
    console.log(`[PlaybackService] 📱 RemoteSetRating: ${rating}`);
  });

  TrackPlayer.addEventListener(getEvent('RemoteDuck'), ({ paused, permanent }: any) => {
    console.log(`[PlaybackService] 🎧 Duck (paused: ${paused}, permanent: ${permanent})`);
    if (permanent || paused) {
      safe(() => TrackPlayer.pause(), 'DuckPause');
    } else {
      safe(() => TrackPlayer.play(), 'DuckResume');
    }
  });

  TrackPlayer.addEventListener(getEvent('PlaybackError'), ({ code, message }: any) => {
    console.error('[PlaybackService] ❌ PlaybackError:', code, message);
  });

  TrackPlayer.addEventListener(getEvent('PlaybackQueueEnded'), ({ track, position }: any) => {
    console.log(`[PlaybackService] ⏹️ Queue ended at track ${track}, pos ${position}`);
  });

  TrackPlayer.addEventListener(getEvent('PlaybackActiveTrackChanged'), ({ index, track }: any) => {
    console.log(`[PlaybackService] 🎵 Active track [${index}]: ${track?.title ?? 'Unknown'}`);
  });

  TrackPlayer.addEventListener(getEvent('PlaybackReady'), () => {
    console.log('[PlaybackService] ✅ Playback ready');
  });

  TrackPlayer.addEventListener(getEvent('AudioCommonMetadataReceived'), ({ metadata }: any) => {
    console.log('[PlaybackService] 📝 Common metadata:', metadata);
  });

  TrackPlayer.addEventListener(getEvent('AudioTimedMetadataReceived'), ({ metadata }: any) => {
    console.log('[PlaybackService] 📝 Timed metadata:', metadata);
  });

  TrackPlayer.addEventListener(getEvent('PlaybackTrackChanged'), ({ track, position, nextTrack }: any) => {
    console.log(`[PlaybackService] 🔄 Track transition: ${track} → ${nextTrack} at ${position}s`);
  });

  console.log('[PlaybackService] ✅ All listeners registered');
}

export default PlaybackService;