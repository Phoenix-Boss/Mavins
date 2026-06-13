// libs/gestureContext.tsx
//
// GestureContext lives in its own file so that playerSetup.tsx and _layout.tsx
// can both import it WITHOUT creating a circular dependency.
//
// Previous location: playerSetup.tsx
// Moved because: playerSetup imports MusicPlayerContext (heavy, has module-level
// IIFE side-effects), and _layout imports both playerSetup AND FloatingPlayer.
// Having GestureContext inside playerSetup created the cycle:
//   FloatingPlayer → playerSetup → MusicPlayerContext → ... → FloatingPlayer
//
// Now the import graph is clean:
//   _layout        → gestureContext  (defines + provides)
//   playerContent  → gestureContext  (consumes)
//   playerSetup    → gestureContext  (re-exports for backward compat)

import { createContext, useContext } from 'react';
import { type SharedValue } from 'react-native-reanimated';

export interface GestureContextValue {
  setSliderActive: (active: boolean) => void;
  setButtonActive: (active: boolean) => void;
  isGestureBlocked: () => boolean;
  gestureBlockedSV: SharedValue<boolean>;
}

export const GestureContext = createContext<GestureContextValue | null>(null);

export const useGestureContext = (): GestureContextValue => {
  const ctx = useContext(GestureContext);
  if (!ctx) throw new Error('useGestureContext must be used within GestureContext.Provider');
  return ctx;
};