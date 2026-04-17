// contexts/GlobalUIStateContext.tsx

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { usePlaybackState } from "@/modules/mavin-eq";
import { triggerHaptic } from "@/helpers/haptics";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

// 🔥 FIX: Define State locally as string union to avoid import issues
type State = 
  | 'none' 
  | 'idle' 
  | 'ready' 
  | 'playing' 
  | 'paused' 
  | 'stopped' 
  | 'buffering' 
  | 'loading' 
  | 'error' 
  | 'ended' 
  | 'connection-error';

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

// 🔥 FIX: Use string literals instead of State enum
const PLAYING_STATE: State = 'playing';
const BUFFERING_STATE: State = 'buffering';
const NONE_STATE: State = 'none';

// ─────────────────────────────────────────────────────────────────────────────
// Provider
//
// IMPORTANT: This component calls usePlaybackState() at the top level.
// It must only be rendered after MavinPlayer.setupPlayer() has resolved.
// In _layout.tsx this is guaranteed by the `playerReady` gate on AppShell.
// ─────────────────────────────────────────────────────────────────────────────

export const GlobalUIStateProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [tabsVisible,    setTabsVisibleState]    = useState(true);
  const [tabsLocked,     setTabsLockedState]     = useState(false);
  const [handleVisible,  setHandleVisibleState]  = useState(false);
  const [isMusicPlaying, setIsMusicPlayingState] = useState(false);

  /**
   * usePlaybackState() returns { state: PlaybackState, isLoading, error }.
   * `state` is itself a PlaybackState object: { state: State, stateCode?, error? }.
   * We drill into `.state.state` to get the actual State enum value.
   */
  const { state: playbackState } = usePlaybackState();

  const currentState = useMemo<State>(() => {
    const raw = playbackState?.state;
    if (!raw) return NONE_STATE;
    // 🔥 FIX: Use string literal comparison instead of State enum
    return raw as State;
  }, [playbackState]);

  const isPlaying = useMemo(
    () => currentState === PLAYING_STATE || currentState === BUFFERING_STATE,
    [currentState]
  );

  // ── Sync tab/handle visibility with playback ──────────────────────────────
  useEffect(() => {
    setIsMusicPlayingState(isPlaying);
    setHandleVisibleState(isPlaying);

    if (!tabsLocked) {
      setTabsVisibleState(!isPlaying);
    }

    if (!isPlaying) {
      setTabsLockedState(false);
    }
  }, [isPlaying, tabsLocked]);

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