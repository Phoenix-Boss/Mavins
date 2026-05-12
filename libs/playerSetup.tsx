// libs/playerSetup.tsx
//
// CANONICAL BRIDGE FILE — do not add player logic here.
//
// Responsibilities:
//   1. GestureContext — lives here to break the circular import:
//      playerContent → _layout → playerContent.
//      _layout defines the gesture shared value; playerContent consumes it.
//      Both import from this file, which imports from neither of them.
//
//   2. Re-exports of the canonical player types and hooks from
//      MusicPlayerContext so that every consumer can write:
//        import { usePlayerEngine } from '@/libs/playerSetup'
//      and always get the single populated context — no split-brain.
//
// DO NOT import expo-video, expo-audio, or any playback logic here.
// All of that lives in MusicPlayerContext.tsx.

import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

// ─────────────────────────────────────────────────────────────────────────────
// GestureContext
// ─────────────────────────────────────────────────────────────────────────────

export interface GestureContextValue {
  setSliderActive:  (active: boolean) => void;
  setButtonActive:  (active: boolean) => void;
  isGestureBlocked: () => boolean;
  gestureBlockedSV: SharedValue<boolean>;
}

const _defaultSV = { value: false } as unknown as SharedValue<boolean>;

export const GestureContext = createContext<GestureContextValue>({
  setSliderActive:  () => {},
  setButtonActive:  () => {},
  isGestureBlocked: () => false,
  gestureBlockedSV: _defaultSV,
});

export function useGestureContext(): GestureContextValue {
  return useContext(GestureContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports — canonical player types and hooks
//
// All consumer files import from '@/libs/playerSetup'.
// These re-exports guarantee they always get MusicPlayerContext's
// single provider — never a second, unpopulated context.
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ResolvedTrack,
  PlayerEngineState,
  TrackExtras,
} from '@/components/MusicPlayerContext';

export {
  usePlayerEngine,
  useMusicPlayer,
  getTrackExtras,
} from '@/components/MusicPlayerContext';