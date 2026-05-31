// hooks/useResponsivePlayback.ts
//
// INDUSTRY STANDARD RESPONSIVE PLAYBACK HOOK
// Features:
// - Optimistic UI updates (immediate visual feedback)
// - Sync verification with drift correction
// - Position drift detection and auto-sync
// - App foreground state recovery
// - Debounced sync to prevent thrashing
// - Single source of truth for UI state
// - FIXED: No double engine calls - callbacks are passed from parent components

import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export interface PlaybackState {
  isPlaying: boolean;
  position: number;
  duration: number;
  isBuffering: boolean;
}

export interface ResponsivePlaybackOptions {
  // Current playback state from source of truth (master player)
  actualPlaying: boolean;
  actualPosition: number;
  actualDuration: number;
  actualBuffering: boolean;
  
  // Callbacks to control playback - parent component provides these
  // These should NOT call both engine methods AND togglePlayPause
  // They should call the appropriate single source of truth method
  onPlay: () => void;
  onPause: () => void;
  onSeek: (position: number) => void;
  
  // Optional configuration
  syncDelayMs?: number;        // Delay before verifying sync (default: 500ms)
  positionDriftThreshold?: number; // Max allowed drift before correction (default: 0.3s)
  syncIntervalMs?: number;     // Interval for periodic sync checks (default: 2000ms)
  enablePositionDriftCorrection?: boolean; // Auto-correct position drift (default: true)
  
  // Callbacks for sync events
  onSyncNeeded?: () => void;
  onSyncComplete?: () => void;
  onDriftDetected?: (drift: number) => void;
}

export interface ResponsivePlaybackReturn {
  // UI-facing state (optimistic, always responsive)
  uiPlaying: boolean;
  uiPosition: number;
  uiDuration: number;
  uiBuffering: boolean;
  
  // Sync status
  isSyncing: boolean;
  needsSync: boolean;
  lastSyncTime: number;
  positionDrift: number;
  
  // Control methods (use these for user interactions)
  setPlaying: (playing: boolean) => void;
  setPosition: (position: number) => void;
  seekTo: (position: number) => void;
  forceSync: () => void;
  resetSync: () => void;
}

export function useResponsivePlayback({
  actualPlaying,
  actualPosition,
  actualDuration,
  actualBuffering,
  onPlay,
  onPause,
  onSeek,
  syncDelayMs = 500,
  positionDriftThreshold = 0.3,
  syncIntervalMs = 2000,
  enablePositionDriftCorrection = true,
  onSyncNeeded,
  onSyncComplete,
  onDriftDetected,
}: ResponsivePlaybackOptions): ResponsivePlaybackReturn {
  
  // UI State (optimistic, updates immediately on user action)
  const [uiPlaying, setUiPlaying] = useState(actualPlaying);
  const [uiPosition, setUiPosition] = useState(actualPosition);
  const [uiDuration, setUiDuration] = useState(actualDuration);
  const [uiBuffering, setUiBuffering] = useState(actualBuffering);
  
  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [needsSync, setNeedsSync] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(Date.now());
  const [positionDrift, setPositionDrift] = useState(0);
  
  // Refs for tracking
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingActionRef = useRef<{ type: 'play' | 'pause' | 'seek'; position?: number } | null>(null);
  const lastKnownActualRef = useRef({ playing: actualPlaying, position: actualPosition, timestamp: Date.now() });
  const lastUiActionRef = useRef({ playing: uiPlaying, position: uiPosition, timestamp: Date.now() });
  const isMountedRef = useRef(true);
  
  // Update refs when actual state changes
  useEffect(() => {
    lastKnownActualRef.current = {
      playing: actualPlaying,
      position: actualPosition,
      timestamp: Date.now(),
    };
  }, [actualPlaying, actualPosition]);
  
  // Update UI when actual state changes (but only if not in sync delay window)
  useEffect(() => {
    if (!isSyncing && !needsSync) {
      // Check if this actual change was caused by our own action
      const timeSinceLastUiAction = Date.now() - lastUiActionRef.current.timestamp;
      
      // If it's been more than syncDelayMs since last UI action, update UI to match actual
      if (timeSinceLastUiAction > syncDelayMs) {
        setUiPlaying(actualPlaying);
        setUiPosition(actualPosition);
      }
    }
    
    setUiDuration(actualDuration);
    setUiBuffering(actualBuffering);
  }, [actualPlaying, actualPosition, actualDuration, actualBuffering, isSyncing, needsSync, syncDelayMs]);
  
  // Monitor position drift
  useEffect(() => {
    if (!enablePositionDriftCorrection) return;
    if (isSyncing || needsSync) return;
    
    const drift = Math.abs(uiPosition - actualPosition);
    setPositionDrift(drift);
    
    if (drift > positionDriftThreshold && actualPlaying && uiPlaying) {
      // Significant drift detected while playing
      onDriftDetected?.(drift);
      
      // Auto-correct drift by seeking to actual position
      const driftCheckTimeout = setTimeout(() => {
        if (Math.abs(uiPosition - actualPosition) > positionDriftThreshold) {
          setUiPosition(actualPosition);
        }
      }, 100);
      
      return () => clearTimeout(driftCheckTimeout);
    }
  }, [uiPosition, actualPosition, actualPlaying, uiPlaying, isSyncing, needsSync, enablePositionDriftCorrection, positionDriftThreshold, onDriftDetected]);
  
  // Periodic sync check (every syncIntervalMs)
  useEffect(() => {
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    
    syncIntervalRef.current = setInterval(() => {
      if (isSyncing) return;
      
      const actual = lastKnownActualRef.current;
      const timeSinceLastSync = Date.now() - lastSyncTime;
      
      // Check if UI state differs from actual state significantly
      const playingMismatch = uiPlaying !== actual.playing;
      const positionMismatch = Math.abs(uiPosition - actual.position) > positionDriftThreshold;
      
      if ((playingMismatch || positionMismatch) && timeSinceLastSync > syncDelayMs * 2) {
        setNeedsSync(true);
        onSyncNeeded?.();
      }
    }, syncIntervalMs);
    
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [uiPlaying, uiPosition, isSyncing, lastSyncTime, syncIntervalMs, syncDelayMs, positionDriftThreshold, onSyncNeeded]);
  
  // Handle sync when needsSync becomes true
  useEffect(() => {
    if (!needsSync) return;
    if (isSyncing) return;
    
    const performSync = () => {
      setIsSyncing(true);
      
      const actual = lastKnownActualRef.current;
      let changes = false;
      
      // Sync playing state
      if (uiPlaying !== actual.playing) {
        setUiPlaying(actual.playing);
        changes = true;
      }
      
      // Sync position
      if (Math.abs(uiPosition - actual.position) > positionDriftThreshold) {
        setUiPosition(actual.position);
        changes = true;
      }
      
      if (changes) {
        setLastSyncTime(Date.now());
      }
      
      setNeedsSync(false);
      setIsSyncing(false);
      onSyncComplete?.();
    };
    
    const syncTimer = setTimeout(performSync, 50);
    return () => clearTimeout(syncTimer);
  }, [needsSync, isSyncing, uiPlaying, uiPosition, positionDriftThreshold, onSyncComplete]);
  
  // App foreground recovery
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App came to foreground - force sync with actual state
        const actual = lastKnownActualRef.current;
        
        setUiPlaying(actual.playing);
        setUiPosition(actual.position);
        setLastSyncTime(Date.now());
        setNeedsSync(false);
        setIsSyncing(false);
      }
    };
    
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, []);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC METHODS
  // ─────────────────────────────────────────────────────────────────────────────
  
  // Set playing state with optimistic UI update
  const setPlaying = useCallback((playing: boolean) => {
    // Cancel any pending sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    
    // Clear needs sync flag
    setNeedsSync(false);
    
    // Update UI immediately (optimistic)
    setUiPlaying(playing);
    lastUiActionRef.current = {
      playing,
      position: uiPosition,
      timestamp: Date.now(),
    };
    
    // Store pending action
    pendingActionRef.current = { type: playing ? 'play' : 'pause' };
    
    // Execute actual playback control - parent provides the correct single source
    if (playing) {
      onPlay();
    } else {
      onPause();
    }
    
    // Schedule sync verification
    syncTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      
      const actual = lastKnownActualRef.current;
      
      // Check if UI still mismatches actual state
      if (uiPlaying !== actual.playing) {
        setUiPlaying(actual.playing);
        setNeedsSync(false);
        onSyncNeeded?.();
      } else {
        // Sync successful
        setLastSyncTime(Date.now());
      }
      
      pendingActionRef.current = null;
      syncTimeoutRef.current = null;
    }, syncDelayMs);
  }, [onPlay, onPause, uiPosition, syncDelayMs, onSyncNeeded]);
  
  // Set position (for scrubbing) with optimistic UI update
  const setPosition = useCallback((position: number) => {
    const clampedPosition = Math.max(0, Math.min(position, actualDuration));
    
    // Cancel any pending sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    
    // Clear needs sync flag
    setNeedsSync(false);
    
    // Update UI immediately (optimistic)
    setUiPosition(clampedPosition);
    lastUiActionRef.current = {
      playing: uiPlaying,
      position: clampedPosition,
      timestamp: Date.now(),
    };
    
    // Store pending action
    pendingActionRef.current = { type: 'seek', position: clampedPosition };
    
    // Schedule sync verification
    syncTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      
      const actual = lastKnownActualRef.current;
      const drift = Math.abs(uiPosition - actual.position);
      
      if (drift > positionDriftThreshold) {
        setUiPosition(actual.position);
        setNeedsSync(false);
        onDriftDetected?.(drift);
      } else {
        setLastSyncTime(Date.now());
      }
      
      pendingActionRef.current = null;
      syncTimeoutRef.current = null;
    }, syncDelayMs);
  }, [actualDuration, uiPlaying, uiPosition, syncDelayMs, positionDriftThreshold, onDriftDetected]);
  
  // Seek to position (triggers actual seek + optimistic update)
  const seekTo = useCallback((position: number) => {
    const clampedPosition = Math.max(0, Math.min(position, actualDuration));
    
    // Cancel any pending sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    
    // Clear needs sync flag
    setNeedsSync(false);
    
    // Update UI immediately (optimistic)
    setUiPosition(clampedPosition);
    lastUiActionRef.current = {
      playing: uiPlaying,
      position: clampedPosition,
      timestamp: Date.now(),
    };
    
    // Execute actual seek
    onSeek(clampedPosition);
    
    // Store pending action
    pendingActionRef.current = { type: 'seek', position: clampedPosition };
    
    // Schedule sync verification
    syncTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      
      const actual = lastKnownActualRef.current;
      const drift = Math.abs(uiPosition - actual.position);
      
      if (drift > positionDriftThreshold) {
        setUiPosition(actual.position);
        setNeedsSync(false);
        onDriftDetected?.(drift);
      } else {
        setLastSyncTime(Date.now());
      }
      
      pendingActionRef.current = null;
      syncTimeoutRef.current = null;
    }, syncDelayMs);
  }, [actualDuration, uiPlaying, uiPosition, onSeek, syncDelayMs, positionDriftThreshold, onDriftDetected]);
  
  // Force immediate sync with actual state
  const forceSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    
    const actual = lastKnownActualRef.current;
    
    setUiPlaying(actual.playing);
    setUiPosition(actual.position);
    setNeedsSync(false);
    setIsSyncing(false);
    setLastSyncTime(Date.now());
    
    pendingActionRef.current = null;
    
    onSyncComplete?.();
  }, [onSyncComplete]);
  
  // Reset sync state (useful for track changes)
  const resetSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    
    setNeedsSync(false);
    setIsSyncing(false);
    setLastSyncTime(Date.now());
    setPositionDrift(0);
    pendingActionRef.current = null;
    
    // Reset UI to actual state
    const actual = lastKnownActualRef.current;
    setUiPlaying(actual.playing);
    setUiPosition(actual.position);
  }, []);
  
  // Return public interface
  return {
    uiPlaying,
    uiPosition,
    uiDuration,
    uiBuffering,
    isSyncing,
    needsSync,
    lastSyncTime,
    positionDrift,
    setPlaying,
    setPosition,
    seekTo,
    forceSync,
    resetSync,
  };
}

export default useResponsivePlayback;