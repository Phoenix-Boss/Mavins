// libs/service.ts
//
// Notification action listener — the ONLY thing this file does.
//
// All playback state lives in MusicPlayerContext. This file simply listens
// for user taps on lock-screen notification buttons and forwards them to
// whatever callbacks MusicPlayerContext registers.
//
// DO NOT add Audio.setAudioModeAsync here — _layout.tsx owns that.
// DO NOT duplicate queue / sound state here — MusicPlayerContext owns that.

import * as Notifications from 'expo-notifications';

// ─────────────────────────────────────────────────────────────────────────────
// Action callback registry
// MusicPlayerContext registers these on mount so the notification listener
// can call into the live player without holding any state itself.
// ─────────────────────────────────────────────────────────────────────────────

type ActionCallback = () => Promise<void>;

let _onPlay:     ActionCallback | null = null;
let _onPause:    ActionCallback | null = null;
let _onStop:     ActionCallback | null = null;
let _onNext:     ActionCallback | null = null;
let _onPrevious: ActionCallback | null = null;

export interface RemoteActionCallbacks {
  onPlay:     ActionCallback;
  onPause:    ActionCallback;
  onStop:     ActionCallback;
  onNext:     ActionCallback;
  onPrevious: ActionCallback;
}

/**
 * Register playback callbacks from MusicPlayerContext.
 * Call this in a useEffect on mount; deregister on unmount.
 */
export function registerRemoteActionCallbacks(cbs: RemoteActionCallbacks): void {
  _onPlay     = cbs.onPlay;
  _onPause    = cbs.onPause;
  _onStop     = cbs.onStop;
  _onNext     = cbs.onNext;
  _onPrevious = cbs.onPrevious;
}

export function deregisterRemoteActionCallbacks(): void {
  _onPlay = _onPause = _onStop = _onNext = _onPrevious = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification response handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleRemoteAction(actionIdentifier: string): Promise<void> {
  console.log(`[PlaybackService] Remote action: ${actionIdentifier}`);

  switch (actionIdentifier) {
    case 'PLAY':     await _onPlay?.();     break;
    case 'PAUSE':    await _onPause?.();    break;
    case 'STOP':     await _onStop?.();     break;
    case 'NEXT':     await _onNext?.();     break;
    case 'PREVIOUS': await _onPrevious?.(); break;
    default:
      console.log(`[PlaybackService] Unhandled action: ${actionIdentifier}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service init — call once from _layout.tsx after notification permissions granted
// ─────────────────────────────────────────────────────────────────────────────

let _listenerSubscription: ReturnType<typeof Notifications.addNotificationResponseReceivedListener> | null = null;

export function startPlaybackService(): void {
  if (_listenerSubscription) return; // guard against double-init

  _listenerSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.type === 'MEDIA_PLAYBACK') {
      handleRemoteAction(response.actionIdentifier).catch(console.error);
    }
  });

  console.log('[PlaybackService] ✅ Notification listener registered');
}

export function stopPlaybackService(): void {
  _listenerSubscription?.remove();
  _listenerSubscription = null;
  deregisterRemoteActionCallbacks();
  console.log('[PlaybackService] Stopped');
}