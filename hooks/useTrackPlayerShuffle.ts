/**
 * useTrackPlayerShuffle
 *
 * Manages shuffle state with real TrackPlayer queue manipulation.
 *
 * Shuffle modes:
 *   "off"  – playback follows original queue order
 *   "on"   – queue is shuffled; original order is preserved so we can
 *            restore it when shuffle is toggled back off
 *
 * Implementation strategy:
 *   • When shuffle is toggled ON  → snapshot the full queue, then rebuild it
 *     so the active track is at index 0 followed by all remaining tracks in
 *     a Fisher-Yates random order. Playback continues without interruption.
 *   • When shuffle is toggled OFF → restore the original snapshot, seeking
 *     back to where the active track sits in the original list.
 *
 * Usage:
 *   const { shuffleMode, toggleShuffle, getDotCount } = useTrackPlayerShuffle();
 */

import { useState, useRef, useCallback } from "react";
import TrackPlayer, { useActiveTrack } from "react-native-track-player";

export type ShuffleMode = "off" | "on";

export interface UseTrackPlayerShuffleReturn {
  shuffleMode: ShuffleMode;
  toggleShuffle: () => Promise<void>;
  /** Number of indicator dots to show beneath the shuffle button (0 or 1) */
  getDotCount: () => number;
}

/** Fisher-Yates in-place shuffle */
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useTrackPlayerShuffle(): UseTrackPlayerShuffleReturn {
  const [shuffleMode, setShuffleMode] = useState<ShuffleMode>("off");
  const activeTrack = useActiveTrack();

  // Snapshot of the queue BEFORE shuffle was applied
  const originalQueueRef = useRef<any[]>([]);

  const toggleShuffle = useCallback(async () => {
    try {
      const queue       = await TrackPlayer.getQueue();
      const activeIndex = (await TrackPlayer.getActiveTrackIndex()) ?? 0;

      if (shuffleMode === "off") {
        // ── Turn shuffle ON ───────────────────────────────────────────────
        if (!queue[activeIndex]) return;

        // Snapshot original order before touching anything
        originalQueueRef.current = queue;

        // Build shuffled remainder (everything except the active track)
        const rest     = queue.filter((_, i) => i !== activeIndex);
        const shuffled = shuffleArray(rest);

        // Rebuild queue without stopping playback:
        // 1. Drop everything after the current track
        await TrackPlayer.removeUpcomingTracks();
        // 2. Drop everything before the current track
        if (activeIndex > 0) {
          const beforeIndices = Array.from({ length: activeIndex }, (_, i) => i);
          await TrackPlayer.remove(beforeIndices);
        }
        // 3. Append the shuffled remainder after the current track
        await TrackPlayer.add(shuffled);

        setShuffleMode("on");
      } else {
        // ── Turn shuffle OFF ──────────────────────────────────────────────
        const original = originalQueueRef.current;

        if (!original || original.length === 0) {
          setShuffleMode("off");
          return;
        }

        // Find where the currently playing track sits in the original list
        const activeId      = activeTrack?.id;
        const originalIndex = activeId
          ? original.findIndex((t) => t.id === activeId)
          : 0;
        const targetIndex = originalIndex >= 0 ? originalIndex : 0;

        // Restore the original queue order without stopping playback:
        // 1. Remove everything after current
        await TrackPlayer.removeUpcomingTracks();
        // 2. Remove everything before current
        const currentIdx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
        if (currentIdx > 0) {
          const beforeIndices = Array.from({ length: currentIdx }, (_, i) => i);
          await TrackPlayer.remove(beforeIndices);
        }
        // Queue is now just [activeTrack].
        // 3. Add tracks that come AFTER it in the original order
        const tracksAfter = original.slice(targetIndex + 1);
        if (tracksAfter.length > 0) {
          await TrackPlayer.add(tracksAfter);
        }
        // 4. Add tracks that come BEFORE it at the front (insertBeforeIndex = 0)
        if (targetIndex > 0) {
          const tracksBefore = original.slice(0, targetIndex);
          await TrackPlayer.add(tracksBefore, 0);
        }
        // 5. Skip to the correct position so we land on the right track
        await TrackPlayer.skip(targetIndex);

        originalQueueRef.current = [];
        setShuffleMode("off");
      }
    } catch (err) {
      console.warn("[useTrackPlayerShuffle] toggleShuffle error:", err);
    }
  }, [shuffleMode, activeTrack?.id]);

  const getDotCount = useCallback((): number => {
    return shuffleMode === "on" ? 1 : 0;
  }, [shuffleMode]);

  return { shuffleMode, toggleShuffle, getDotCount };
}