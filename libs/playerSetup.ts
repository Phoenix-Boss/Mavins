// libs/playerSetup.ts
//
// Clean initialization for react-native-track-player 4.1.2 (New Architecture)
//
// API pattern confirmed from official RNTP 4.1.2 example:
// - setupPlayer() only accepts: autoHandleInterruptions, alwaysPauseOnInterruption
// - ALL capabilities/notification options go into updateOptions() only
// - Hot reload detection via getActiveTrack() — getCurrentTrack() removed in 4.x

import TrackPlayer, {
  Capability,
  AppKilledPlaybackBehavior,
} from 'react-native-track-player';

let isInitialized = false;
let initPromise: Promise<boolean> | null = null;

export async function setupPlayerGlobal(): Promise<boolean> {
  if (isInitialized) {
    console.log('[PlayerSetup] Already initialized');
    return true;
  }

  if (initPromise) {
    console.log('[PlayerSetup] Waiting for in-progress initialization...');
    return initPromise;
  }

  initPromise = (async () => {
    try {
      console.log('[PlayerSetup] Starting...');

      // Hot reload detection: getQueue() succeeds if player is already set up
      // getActiveTrack/getCurrentTrack both removed in RNTP 4.x — use getQueue() instead
      try {
        const queue = await TrackPlayer.getQueue();
        if (Array.isArray(queue)) {
          console.log('[PlayerSetup] Already set up (hot reload detected via queue)');
          isInitialized = true;
          initPromise = null;
          return true;
        }
      } catch {
        // Expected on cold launch — player not initialized yet
      }

      // In RNTP 4.1.2, setupPlayer only accepts these two options
      await TrackPlayer.setupPlayer({
        autoHandleInterruptions: true,
        alwaysPauseOnInterruption: false,
      });

      console.log('[PlayerSetup] ✅ setupPlayer complete');

      // All capabilities and notification config go into updateOptions
      await TrackPlayer.updateOptions({
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
        },
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.JumpForward,
          Capability.JumpBackward,
          Capability.SetRating,
          Capability.Like,
          Capability.Dislike,
          Capability.Bookmark,
        ],
        compactCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.Stop,
        ],
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.JumpForward,
          Capability.JumpBackward,
          Capability.Like,
          Capability.Dislike,
        ],
        progressUpdateEventInterval: 2,
      });

      isInitialized = true;
      initPromise = null;
      console.log('[PlayerSetup] ✅ Player fully ready');
      return true;

    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      const code: string = err?.code ?? '';

      // Concurrent call already succeeded — treat as success
      if (
        msg.includes('already') ||
        code === 'player_already_initialized' ||
        msg.includes('already initialized')
      ) {
        console.log('[PlayerSetup] Already initialized by concurrent caller');
        isInitialized = true;
        initPromise = null;
        return true;
      }

      console.error('[PlayerSetup] ❌ Setup failed:', msg);
      initPromise = null;
      return false;
    }
  })();

  return initPromise;
}

export function isPlayerReady(): boolean {
  return isInitialized;
}

export async function releasePlayerGlobal(): Promise<void> {
  try {
    await TrackPlayer.reset();
  } catch (e) {
    console.log('[PlayerSetup] Release error (ignored):', e);
  }
  isInitialized = false;
  initPromise = null;
}