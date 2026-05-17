/**
 * useLogTrackPlayerState
 *
 * Safe TrackPlayer logging hook — dev-only, version-safe (v3 + v4).
 *
 * FIX: useTrackPlayerEvents was called INSIDE an `if (safeEvents.length > 0)`
 * block — a direct Rules of Hooks violation. React requires hooks to be called
 * unconditionally on every render. Conditional hook calls cause subtle state
 * desync crashes and are caught by the exhaustive-deps / react-hooks ESLint rules.
 *
 * Fix: useTrackPlayerEvents is always called. We pass it the filtered event
 * list (which may be empty). An empty array is a valid no-op for the hook —
 * it simply won't fire any callbacks, which is exactly the desired behaviour
 * when none of the Event.* constants are defined on the current RNTP version.
 */

import { useEffect } from "react";
import {
  Event,
  useTrackPlayerEvents,
  usePlaybackState,
} from "react-native-track-player";

export const useLogTrackPlayerState = () => {
  // Build the event list at module scope (outside any condition).
  // .filter(Boolean) removes undefined entries that appear when an Event
  // constant doesn't exist in the installed RNTP version (e.g. v3 vs v4).
  const safeEvents = [
    Event?.PlaybackState,
    Event?.PlaybackError,
    Event?.PlaybackTrackChanged,
    Event?.PlaybackActiveTrackChanged, // v4+ only — undefined in v3, filtered out
    Event?.PlaybackQueueEnded,
    Event?.PlaybackMetadataReceived,
  ].filter(Boolean) as Event[];

  // ── Playback state logging ─────────────────────────────────────────────────
  const playbackState = usePlaybackState();

  useEffect(() => {
    if (!__DEV__) return;
    console.log("[TrackPlayer] Playback state:", playbackState);
  }, [playbackState]);

  // ── Event logging ──────────────────────────────────────────────────────────
  // ALWAYS called unconditionally — satisfies Rules of Hooks.
  // Passing an empty array is safe: the hook simply registers no listeners.
  useTrackPlayerEvents(safeEvents, async (event) => {
    if (!__DEV__) return;

    switch (event.type) {
      case Event?.PlaybackError:
        console.warn("[TrackPlayer] Error:", event);
        break;

      case Event?.PlaybackState:
        console.log("[TrackPlayer] State changed:", event.state);
        break;

      case Event?.PlaybackTrackChanged:
        console.log(
          "[TrackPlayer] Track changed:",
          event.prevTrack,
          "→",
          event.nextTrack,
        );
        break;

      case Event?.PlaybackActiveTrackChanged:
        console.log("[TrackPlayer] Active track changed:", event.track);
        break;

      case Event?.PlaybackQueueEnded:
        console.log("[TrackPlayer] Queue ended");
        break;

      case Event?.PlaybackMetadataReceived:
        console.log("[TrackPlayer] Metadata received:", event.metadata);
        break;
    }
  });
};
