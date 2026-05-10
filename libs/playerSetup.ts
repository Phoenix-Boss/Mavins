// libs/playerSetup.ts
//
// Clean initialization for expo-av
//
// expo-av provides a simpler API without the complex setup requirements
// of react-native-track-player

import { Audio } from 'expo-av';

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

      // Configure audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      console.log('[PlayerSetup] ✅ Audio mode configured');

      isInitialized = true;
      initPromise = null;
      console.log('[PlayerSetup] ✅ Player fully ready');
      return true;

    } catch (err: any) {
      const msg: string = err?.message ?? String(err);

      // Concurrent call already succeeded — treat as success
      if (
        msg.includes('already') ||
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
    // Unload all sounds and release resources
    await Audio.setIsEnabledAsync(false);
  } catch (e) {
    console.log('[PlayerSetup] Release error (ignored):', e);
  }
  isInitialized = false;
  initPromise = null;
}