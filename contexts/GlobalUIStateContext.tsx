// contexts/GlobalUIStateContext.tsx
//
// IMPORTANT: This context NO LONGER controls tab bar visibility.
// Tab bar visibility is now managed solely by (player)/_layout.tsx
// based on playerMode === 'expanded'.
//
// This context now ONLY manages:
//   - Drag handle visibility for the mini player
//   - Music playing state (for other UI components)
//   - Tab lock state (deprecated - kept for compatibility)

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { usePlayerEngine } from '@/libs/playerSetup';
import { triggerHaptic } from '@/helpers/haptics';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GlobalUIStateContextType {
  // Deprecated - tabs are now controlled by (player)/_layout.tsx
  tabsVisible:          boolean;
  tabsLocked:           boolean;
  handleVisible:        boolean;
  isMusicPlaying:       boolean;
  setTabsVisible:       (visible: boolean, isUserAction?: boolean) => void;
  resetNavigationState: () => void;
  setIsMusicPlaying:    (playing: boolean) => void;
  setHandleVisible:     (visible: boolean) => void;
  setTabsLocked:        (locked: boolean) => void;
  handleUserTappedHandle: () => void;
}

const GlobalUIStateContext = createContext<GlobalUIStateContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export const GlobalUIStateProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Safely try to get player engine - if not ready yet, use default values
  let engine;
  try {
    engine = usePlayerEngine();
  } catch (error) {
    // Player engine not ready yet - use safe default values
    engine = {
      isPlaying: false,
      isBuffering: false,
      currentTrack: null,
      position: 0,
      duration: 0,
      queue: [],
      queueIndex: -1,
      repeatMode: 'off' as const,
      shuffleMode: 'off' as const,
      play: () => {},
      pause: () => {},
      seekTo: () => {},
      skipToNext: async () => {},
      skipToPrevious: async () => {},
      skipToIndex: async () => {},
      togglePlayPause: () => {},
      setRepeatMode: () => {},
      setShuffleMode: () => {},
      addToQueue: () => {},
      removeFromQueue: () => {},
      moveQueueItem: () => {},
      clearQueue: () => {},
      setPlayerOverlayRefs: () => {},
      expandPlayer: () => {},
      collapsePlayer: () => {},
    };
  }

  // Tab bar state is now IGNORED - kept only for compatibility
  // Actual tab bar visibility is controlled by playerMode in (player)/_layout.tsx
  const [tabsVisible,    setTabsVisibleState]    = useState(true);
  const [tabsLocked,     setTabsLockedState]     = useState(false);
  const [handleVisible,  setHandleVisibleState]  = useState(false);
  const [isMusicPlaying, setIsMusicPlayingState] = useState(false);

  // Sync with engine playback state
  const isActive = engine.isPlaying || engine.isBuffering;

  useEffect(() => {
    setIsMusicPlayingState(isActive);
    setHandleVisibleState(isActive);
    
    // CRITICAL FIX: REMOVED auto-hide logic for tabs
    // Tabs should NEVER auto-hide due to music playback
    // They are ONLY controlled by expanded player state in the layout
    // The tabsVisible state is now purely for compatibility and not used
    // for actual tab bar visibility

    // When playback stops, clear the lock
    if (!isActive) {
      setTabsLockedState(false);
    }
  }, [isActive]);

  // ── Setters (kept for compatibility but tab bar no longer uses them) ─────────

  const setTabsVisible = useCallback(
    (visible: boolean, isUserAction = false) => {
      // This no longer affects actual tab bar visibility
      // Tab bar visibility is now controlled by playerMode in (player)/_layout.tsx
      setTabsVisibleState(visible);
      if (isUserAction) setTabsLockedState(visible);
    },
    [],
  );

  const setTabsLocked = useCallback(
    (locked: boolean) => setTabsLockedState(locked),
    [],
  );

  const handleUserTappedHandle = useCallback(() => {
    if (!isMusicPlaying) return;
    
    // Toggle handle visibility only - no tab bar control
    const newVisibility = !handleVisible;
    setHandleVisibleState(newVisibility);
    triggerHaptic();
  }, [isMusicPlaying, handleVisible]);

  const resetNavigationState = useCallback(() => {
    // Only reset internal states, don't affect tab bar
    setTabsLockedState(false);
  }, []);

  const setIsMusicPlaying = useCallback(
    (playing: boolean) => setIsMusicPlayingState(playing),
    [],
  );

  const setHandleVisible = useCallback(
    (visible: boolean) => setHandleVisibleState(visible),
    [],
  );

  return (
    <GlobalUIStateContext.Provider
      value={{
        tabsVisible,      // Kept for compatibility, not used for actual tab bar
        tabsLocked,
        handleVisible,
        isMusicPlaying,
        setTabsVisible,
        resetNavigationState,
        setIsMusicPlaying,
        setHandleVisible,
        setTabsLocked,
        handleUserTappedHandle,
      }}
    >
      {children}
    </GlobalUIStateContext.Provider>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export const useGlobalUIState = (): GlobalUIStateContextType => {
  const context = useContext(GlobalUIStateContext);
  if (!context) {
    throw new Error('useGlobalUIState must be used within a GlobalUIStateProvider');
  }
  return context;
};