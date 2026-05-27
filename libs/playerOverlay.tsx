// libs/playerOverlay.tsx
//
// Manages the visual state of the player overlay (collapsed / expanded / hidden).
//
// DESIGN:
//   - This context is intentionally minimal. It holds only the UI-level mode of
//     the bottom-sheet/overlay. Playback state lives in MusicPlayerContext.
//   - Returns safe no-op fallbacks instead of throwing when the context is
//     accessed outside the provider (e.g. during Fast Refresh before the provider
//     tree is restored).
//   - 'collapsed'  → mini-player bar visible at the bottom
//   - 'expanded'   → full player sheet open
//   - 'hidden'     → player UI is fully off-screen (e.g. no track loaded)

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type PlayerMode = 'collapsed' | 'expanded' | 'hidden';

export interface PlayerOverlayContextType {
  /** Current visual state of the player overlay. */
  playerMode: PlayerMode;
  /** Whether the player is visible (collapsed or expanded, not hidden). */
  isPlayerVisible: boolean;
  /** Expand the player to full-screen sheet. */
  expandPlayer: () => void;
  /** Collapse the player to the mini-bar. */
  collapsePlayer: () => void;
  /** Fully hide the player UI (e.g. when no track is loaded). */
  hidePlayer: () => void;
  /** Show the player UI (returns to collapsed state). */
  showPlayer: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT + FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

const PlayerOverlayContext = createContext<PlayerOverlayContextType | undefined>(undefined);

const noop = () => {};

/**
 * Safe fallback returned when usePlayerOverlay() is called outside a provider.
 * Prevents crashes during Fast Refresh before the provider tree is restored.
 */
const fallbackContext: PlayerOverlayContextType = {
  playerMode: 'hidden',
  isPlayerVisible: false,
  expandPlayer: noop,
  collapsePlayer: noop,
  hidePlayer: noop,
  showPlayer: noop,
};

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the PlayerOverlay context.
 *
 * Safe to call outside a provider: returns no-op fallbacks instead of throwing.
 * This is intentional — during Fast Refresh, MusicPlayerContext re-evaluates
 * before the provider tree is restored, so throwing would break the DX.
 */
export const usePlayerOverlay = (): PlayerOverlayContextType => {
  const ctx = useContext(PlayerOverlayContext);
  return ctx ?? fallbackContext;
};

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerOverlayProviderProps {
  children: ReactNode;
}

export const PlayerOverlayProvider = ({ children }: PlayerOverlayProviderProps) => {
  const [playerMode, setPlayerMode] = useState<PlayerMode>('hidden');

  const isPlayerVisible = playerMode !== 'hidden';

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
    // Showing restores to collapsed (mini-bar), not expanded.
    setPlayerMode('collapsed');
  }, []);

  return (
    <PlayerOverlayContext.Provider
      value={{
        playerMode,
        isPlayerVisible,
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