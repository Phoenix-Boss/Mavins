// contexts/GlobalUIStateContext.tsx
//
// Migrated from react-native-track-player → expo-audio engine (usePlayerEngine).
//
// ARCHITECTURE:
//   isPlaying is now derived from engine.isPlaying (set by MusicPlayerContext)
//   rather than RNTP's usePlaybackState hook.
//
//   PlayerOverlayProvider (in _layout.tsx) already watches engine.currentTrack
//   to show/hide the mini player — this context handles the tab bar and handle
//   visibility that responds to the same playback lifecycle.

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
  const engine = usePlayerEngine();

  const [tabsVisible,    setTabsVisibleState]    = useState(true);
  const [tabsLocked,     setTabsLockedState]     = useState(false);
  const [handleVisible,  setHandleVisibleState]  = useState(false);
  // Mirrors engine.isPlaying — kept in state so consumers can subscribe via
  // context without reaching into the engine directly.
  const [isMusicPlaying, setIsMusicPlayingState] = useState(false);

  // ── Sync with engine playback state ────────────────────────────────────────
  //
  // engine.isPlaying is true while audio is actively playing (expo-audio),
  // and engine.isBuffering covers the loading state that RNTP's State.Buffering
  // previously handled.  We treat either as "active" for UI purposes.

  const isActive = engine.isPlaying || engine.isBuffering;

  useEffect(() => {
    setIsMusicPlayingState(isActive);
    setHandleVisibleState(isActive);

    if (!tabsLocked) {
      setTabsVisibleState(!isActive);
    }

    // When playback stops, always clear the lock so the next play auto-hides tabs.
    if (!isActive) {
      setTabsLockedState(false);
    }
  }, [isActive, tabsLocked]);

  // ── Setters ─────────────────────────────────────────────────────────────────

  /**
   * Set tab visibility. Pass `isUserAction=true` to lock the state so the
   * playback-driven auto-sync won't override a deliberate user choice.
   */
  const setTabsVisible = useCallback(
    (visible: boolean, isUserAction = false) => {
      setTabsVisibleState(visible);
      if (isUserAction) setTabsLockedState(visible);
    },
    [],
  );

  const setTabsLocked = useCallback(
    (locked: boolean) => setTabsLockedState(locked),
    [],
  );

  /**
   * Called when the user taps the drag handle on the FloatingPlayer.
   * Toggles tab bar visibility and locks it to prevent the auto-sync from
   * immediately overriding the user's choice.
   */
  const handleUserTappedHandle = useCallback(() => {
    if (!isMusicPlaying) return;

    const newVisibility = !tabsVisible;
    setTabsLockedState(newVisibility);  // lock when showing, release when hiding
    setTabsVisibleState(newVisibility);
    triggerHaptic();
  }, [isMusicPlaying, tabsVisible]);

  const resetNavigationState = useCallback(() => {
    setTabsVisibleState(false);
    setTabsLockedState(false);
  }, []);

  // Escape hatch: allow external callers to force-set the playing flag
  // (e.g. optimistic UI before the engine state propagates).
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
        tabsVisible,
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