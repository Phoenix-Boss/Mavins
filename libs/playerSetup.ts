// libs/playerSetup.ts
//
// Clean initialization for react-native-track-player 4.1.2
//
// CRITICAL: Uses only APIs confirmed present in the 4.1.2 type definitions:
// - State enum (for state comparison)
// - getQueue() (for hot reload detection instead of getPlaybackState)
// - setupPlayer(), updateOptions(), reset()
// - Capability enum with null-safety

import TrackPlayer, { 
  Capability, 
  AppKilledPlaybackBehavior,
  State,
} from 'react-native-track-player';

let isInitialized = false;
let initPromise: Promise<boolean> | null = null;

// Safe capability constants with fallback values
const CAP_PLAY = Capability?.Play ?? 0;
const CAP_PAUSE = Capability?.Pause ?? 1;
const CAP_STOP = Capability?.Stop ?? 2;
const CAP_SKIP_NEXT = Capability?.SkipToNext ?? 4;
const CAP_SKIP_PREV = Capability?.SkipToPrevious ?? 5;
const CAP_SEEK = Capability?.SeekTo ?? 6;
const CAP_JUMP_FWD = Capability?.JumpForward ?? 8;
const CAP_JUMP_BWD = Capability?.JumpBackward ?? 9;
const CAP_RATING = Capability?.SetRating ?? 10;
const CAP_LIKE = Capability?.Like ?? 11;
const CAP_DISLIKE = Capability?.Dislike ?? 12;
const CAP_BOOKMARK = Capability?.Bookmark ?? 13;

// Type guard for valid capability numbers
const validCaps = (arr: (number | null | undefined)[]): number[] => 
  arr.filter((c): c is number => typeof c === 'number');

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

      // Hot reload detection: Try getQueue() instead of getPlaybackState()
      // If it succeeds without error, player is already set up
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

      // Reset any stale state from a previous crashed session
      try {
        await TrackPlayer.reset();
      } catch {
        // Nothing to reset on first launch
      }

      const capabilities = validCaps([
        CAP_PLAY, CAP_PAUSE, CAP_STOP, CAP_SKIP_NEXT, CAP_SKIP_PREV,
        CAP_SEEK, CAP_RATING, CAP_JUMP_FWD, CAP_JUMP_BWD,
        CAP_LIKE, CAP_DISLIKE, CAP_BOOKMARK,
      ]);

      const compactCapabilities = validCaps([
        CAP_PLAY, CAP_PAUSE, CAP_SKIP_NEXT, CAP_SKIP_PREV, CAP_STOP,
      ]);

      const notificationCapabilities = validCaps([
        CAP_PLAY, CAP_PAUSE, CAP_STOP, CAP_SKIP_NEXT, CAP_SKIP_PREV,
        CAP_SEEK, CAP_JUMP_FWD, CAP_JUMP_BWD, CAP_LIKE, CAP_DISLIKE,
      ]);

      await TrackPlayer.setupPlayer({
        autoHandleInterruptions: true,
        alwaysPauseOnInterruption: false,
        waitForReady: true,
        enableRemoteVolumeControl: true,
        maxQueueSize: 100,
        minBuffer: 15,
        maxBuffer: 50,
        backBuffer: 10,

        capabilities,
        compactCapabilities,
        notificationCapabilities,

        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
          notificationChannelId: 'mavin_playback_channel',
          notificationChannelName: 'Mavin Player Playback',
          notificationChannelDescription: 'Shows currently playing song with playback controls',
          notificationChannelImportance: 4,
          clickAction: 'android.intent.action.MAIN',
          showWhenStarted: true,
          showWhenStopped: false,
          color: 0xD4AF37,
          largeIcon: 'ic_notification_large',
          smallIcon: 'ic_notification_small',
          compactView: true,
          enableSkipGestures: true,
          enableSeekGestures: true,
          showArtwork: true,
          showProgress: true,
          stopWithApp: false,
        },
      });

      console.log('[PlayerSetup] ✅ setupPlayer complete');

      // Update notification options post-setup (non-critical)
      try {
        await TrackPlayer.updateOptions({
          capabilities: validCaps([
            CAP_PLAY, CAP_PAUSE, CAP_STOP, CAP_SKIP_NEXT, CAP_SKIP_PREV,
            CAP_SEEK, CAP_JUMP_FWD, CAP_JUMP_BWD,
          ]),
          compactCapabilities: validCaps([
            CAP_PLAY, CAP_PAUSE, CAP_SKIP_NEXT, CAP_SKIP_PREV,
          ]),
          notificationCapabilities: validCaps([
            CAP_PLAY, CAP_PAUSE, CAP_STOP, CAP_SKIP_NEXT, CAP_SKIP_PREV, CAP_SEEK,
          ]),
        });
      } catch (e) {
        console.warn('[PlayerSetup] updateOptions failed (non-critical):', e);
      }

      isInitialized = true;
      initPromise = null;
      console.log('[PlayerSetup] ✅ Player ready');
      return true;

    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      const code: string = err?.code ?? '';

      // A concurrent call already succeeded — treat as success
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