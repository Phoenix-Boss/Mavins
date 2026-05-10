// contexts/GlobalUIStateContext.tsx
/**
 * GlobalUIStateContext - expo-av version
 * 
 * Manages global UI state including tab visibility and music playing status.
 * Uses MusicPlayerContext instead of RNTP's usePlaybackState.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { useMusicPlayer } from "@/components/MusicPlayerContext";
import { triggerHaptic } from "@/helpers/haptics";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GlobalUIStateContextType {
  tabsVisible: boolean;
  tabsLocked: boolean;
  handleVisible: boolean;
  isMusicPlaying: boolean;
  setTabsVisible: (visible: boolean, isUserAction?: boolean) => void;
  resetNavigationState: () => void;
  setIsMusicPlaying: (playing: boolean) => void;
  setHandleVisible: (visible: boolean) => void;
  setTabsLocked: (locked: boolean) => void;
  handleUserTappedHandle: () => void;
}

const GlobalUIStateContext =
  createContext<GlobalUIStateContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export const GlobalUIStateProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [tabsVisible, setTabsVisibleState] = useState(true);
  const [tabsLocked, setTabsLockedState] = useState(false);
  const [handleVisible, setHandleVisibleState] = useState(false);
  const [isMusicPlaying, setIsMusicPlayingState] = useState(false);

  // Get playback state from MusicPlayerContext (expo-av)
  const { isPlaying, isLoading, position, duration } = useMusicPlayer();
  
  // Determine if music is playing (includes buffering as "active" state)
  // For expo-av, we consider isPlaying as the main state
  const isPlayingValue = useMemo(() => {
    return isPlaying;
  }, [isPlaying]);

  // ── Sync tab/handle visibility with playback ──────────────────────────────
  useEffect(() => {
    setIsMusicPlayingState(isPlayingValue);
    setHandleVisibleState(isPlayingValue);

    if (!tabsLocked) {
      setTabsVisibleState(!isPlayingValue);
    }

    if (!isPlayingValue) {
      setTabsLockedState(false);
    }
  }, [isPlayingValue, tabsLocked]);

  // ── Setters ───────────────────────────────────────────────────────────────

  /**
   * Set tab visibility. Pass `isUserAction=true` to lock the state so the
   * playback-driven auto-sync won't override a deliberate user choice.
   */
  const setTabsVisible = useCallback(
    (visible: boolean, isUserAction = false) => {
      setTabsVisibleState(visible);
      if (isUserAction) setTabsLockedState(visible);
    },
    []
  );

  const setTabsLocked = useCallback(
    (locked: boolean) => setTabsLockedState(locked),
    []
  );

  /**
   * Called when the user taps the drag handle on the FloatingPlayer.
   * Toggles tab bar visibility and locks it to prevent auto-override.
   */
  const handleUserTappedHandle = useCallback(() => {
    if (!isMusicPlaying) return;

    const newVisibility = !tabsVisible;
    setTabsLockedState(newVisibility); // lock when showing, unlock when hiding
    setTabsVisibleState(newVisibility);
    triggerHaptic();
  }, [isMusicPlaying, tabsVisible]);

  const resetNavigationState = useCallback(() => {
    setTabsVisibleState(false);
    setTabsLockedState(false);
  }, []);

  const setIsMusicPlaying = useCallback(
    (playing: boolean) => setIsMusicPlayingState(playing),
    []
  );

  const setHandleVisible = useCallback(
    (visible: boolean) => setHandleVisibleState(visible),
    []
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
    throw new Error(
      "useGlobalUIState must be used within a GlobalUIStateProvider"
    );
  }
  return context;
};