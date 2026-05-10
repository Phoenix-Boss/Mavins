// hooks/useProgress.ts
/**
 * useProgress - expo-av replacement for react-native-track-player's useProgress
 * 
 * Returns the current playback progress (position, duration, buffered).
 * Updates at the specified interval.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useMusicPlayer } from '@/components/MusicPlayerContext';

export interface Progress {
  position: number;   // Current playback position in seconds
  duration: number;   // Total duration in seconds
  buffered: number;   // Buffered amount in seconds
}

export interface UseProgressOptions {
  updateInterval?: number;
  onProgress?: (progress: Progress) => void;
}

/**
 * Hook that returns playback progress with real-time updates.
 * 
 * @param updateInterval - Interval in milliseconds to update position (default: 250)
 * @returns Progress object with position, duration, and buffered
 * 
 * @example
 * const { position, duration, buffered } = useProgress(500);
 * const percent = (position / duration) * 100;
 */
export function useProgress(updateInterval: number = 250): Progress {
  const { position, duration } = useMusicPlayer();
  const [progress, setProgress] = useState<Progress>({
    position: 0,
    duration: 0,
    buffered: 0,
  });

  // Update progress when context values change
  useEffect(() => {
    setProgress(prev => ({
      position,
      duration,
      buffered: prev.buffered,
    }));
  }, [position, duration]);

  return progress;
}

/**
 * Hook that returns progress with high-frequency updates (for animations)
 * 
 * @param updateInterval - Interval in milliseconds (default: 100)
 * @returns Progress object
 */
export function useHighFrequencyProgress(updateInterval: number = 100): Progress {
  const { position, duration } = useMusicPlayer();
  const [progress, setProgress] = useState<Progress>({
    position: 0,
    duration: 0,
    buffered: 0,
  });
  
  const lastPositionRef = useRef(position);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const startTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    // Use requestAnimationFrame for smooth 60fps updates when playing
    const updatePosition = () => {
      if (isPlayingRef.current) {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const newPosition = Math.min(
          lastPositionRef.current + elapsed,
          duration
        );
        setProgress(prev => ({
          ...prev,
          position: newPosition,
        }));
      }
      rafRef.current = requestAnimationFrame(updatePosition);
    };
    
    rafRef.current = requestAnimationFrame(updatePosition);
    
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [duration]);

  // Sync with actual position when not playing
  useEffect(() => {
    setProgress(prev => ({
      ...prev,
      position,
      duration,
    }));
    lastPositionRef.current = position;
    startTimeRef.current = Date.now();
  }, [position, duration]);

  // Get playing state from parent context (we'll add a prop later)
  // For now, just update from interval
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => ({
        ...prev,
        position,
        duration,
      }));
    }, updateInterval);
    
    return () => clearInterval(interval);
  }, [position, duration, updateInterval]);

  return progress;
}

/**
 * Hook that returns formatted progress strings
 * 
 * @returns Object with elapsed, remaining, total strings and fraction
 */
export function useFormattedProgress(): {
  elapsed: string;
  remaining: string;
  total: string;
  fraction: number;
} {
  const { position, duration } = useMusicPlayer();
  const [formatted, setFormatted] = useState({
    elapsed: '0:00',
    remaining: '0:00',
    total: '0:00',
    fraction: 0,
  });

  const formatTime = useCallback((seconds: number): string => {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    setFormatted({
      elapsed: formatTime(position),
      remaining: formatTime(Math.max(0, duration - position)),
      total: formatTime(duration),
      fraction: duration > 0 ? position / duration : 0,
    });
  }, [position, duration, formatTime]);

  return formatted;
}

// Default export
export default useProgress;