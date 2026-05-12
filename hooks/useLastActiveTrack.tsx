/**
 * useLastActiveTrack.tsx
 *
 * FIXED: No longer uses react-native-track-player.
 * Uses PlayerEngineContext to track the last active track.
 *
 * This hook keeps track of the last active track in the music player.
 * Useful for scenarios where you need to reference the previously
 * playing track even after the player has stopped.
 *
 * FIX: Changed artwork to thumbnail (unified field name)
 */

import { useEffect, useState } from "react";
import { usePlayerEngine } from "@/libs/playerSetup";

export interface LastActiveTrack {
  id: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  url?: string;
  duration?: number;
  videoId?: string;
}

/**
 * A custom hook that returns the last track that was active in the player.
 * It listens for changes in the active track and stores the last valid track object.
 * @returns The last active track object, or undefined if no track has been active yet.
 */
export const useLastActiveTrack = (): LastActiveTrack | undefined => {
  const engine = usePlayerEngine();
  const currentTrack = engine.currentTrack;
  
  const [lastActiveTrack, setLastActiveTrack] = useState<LastActiveTrack | undefined>(undefined);

  useEffect(() => {
    if (currentTrack) {
      setLastActiveTrack({
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        thumbnail: currentTrack.thumbnail,
        url: currentTrack.url,
        duration: currentTrack.duration,
        videoId: currentTrack.videoId,
      });
    }
  }, [currentTrack]);

  return lastActiveTrack;
};