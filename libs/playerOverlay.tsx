// libs/playerOverlay.tsx - Minimal working version
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type PlayerMode = 'collapsed' | 'expanded' | 'hidden';

interface PlayerOverlayContextType {
  playerMode: PlayerMode;
  expandPlayer: () => void;
  collapsePlayer: () => void;
  hidePlayer: () => void;
  showPlayer: () => void;
}

const PlayerOverlayContext = createContext<PlayerOverlayContextType | undefined>(undefined);

export const usePlayerOverlay = () => {
  const ctx = useContext(PlayerOverlayContext);
  if (!ctx) {
    throw new Error('usePlayerOverlay must be used within PlayerOverlayProvider');
  }
  return ctx;
};

interface PlayerOverlayProviderProps {
  children: ReactNode;
}

export const PlayerOverlayProvider = ({ children }: PlayerOverlayProviderProps) => {
  const [playerMode, setPlayerMode] = useState<PlayerMode>('collapsed');

  const expandPlayer = useCallback(() => {
    setPlayerMode('expanded');
  }, []);

  const collapsePlayer = useCallback(() => {
    setPlayerMode('collapsed');
  }, []);

  const hidePlayer = useCallback(() => {
    setPlayerMode('hidden');
  }, []);

  const showPlayer = useCallback(() => {
    setPlayerMode('collapsed');
  }, []);

  return (
    <PlayerOverlayContext.Provider
      value={{
        playerMode,
        expandPlayer,
        collapsePlayer,
        hidePlayer,
        showPlayer,
      }}
    >
      {children}
    </PlayerOverlayContext.Provider>
  );
};

export default PlayerOverlayProvider;