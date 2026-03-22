/**
 * FloatingPlayer — v3
 *
 * Changes from v2:
 *
 * 1. EQ screen exception — the equalizer is a modal (/(modals)/equalizer)
 *    but we WANT the player to be visible there. Previously it was hidden
 *    on all /(modals)/ routes. Now it only hides on non-EQ modals.
 *    The EQ screen positions it in a fixed "bar" slot via the `eqBarMode`
 *    prop — no tab-bar floating, no absolute positioning. It renders as a
 *    plain inline bar matching NowPlayingBar's slot, so NowPlayingBar is
 *    no longer needed and has been removed from the EQ screen.
 *
 * 2. `eqBarMode` prop — when true:
 *    - Renders as a 64px high View (not Animated.View with absolute position)
 *    - No bottom / left / right absolute styles
 *    - Matches exactly where NowPlayingBar sat in the EQ scroll content
 *    - onPress opens the player overlay (expandPlayer)
 *
 * 3. All previous fixes preserved (pending track, singleton guard, expo-image).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { triggerHaptic } from '@/helpers/haptics';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useActiveTrack, usePlaybackState, State } from 'react-native-track-player';
import TrackPlayer from 'react-native-track-player';
import { useMusicPlayer } from '@/components/MusicPlayerContext';
import {
  getPendingTrack,
  clearPendingTrack,
  subscribePendingTrack,
  type PendingTrackInfo,
} from '@/helpers/pendingTrack';
import { usePlayerOverlay } from '@/components/player/playerProvider';

// ─── Singleton guard ──────────────────────────────────────────────────────────
// Prevents the floating variant from rendering twice if FloatingPlayer is
// mounted in multiple places. The EQ bar variant (eqBarMode=true) bypasses
// this guard — it's a different render path.
let _floatingPlayerMountCount = 0;

// ─── Props ────────────────────────────────────────────────────────────────────

interface FloatingPlayerProps {
  tabHeight?: number;
  /** When true: renders as an inline bar (for the EQ screen) instead of
   *  a floating pill above the tab bar. No absolute positioning. */
  eqBarMode?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

const FloatingPlayer: React.FC<FloatingPlayerProps> = ({
  tabHeight = 56,
  eqBarMode = false,
}) => {
  const pathname      = usePathname();
  const activeTrack   = useActiveTrack();
  const playbackState = usePlaybackState();
  const { togglePlayPause, isLoading } = useMusicPlayer();
  const { expandPlayer } = usePlayerOverlay();

  // ── Pending track signal ───────────────────────────────────────────────────
  const [pendingTrack, setPendingTrackState] = useState<PendingTrackInfo | null>(
    getPendingTrack,
  );

  useEffect(() => {
    setPendingTrackState(getPendingTrack());
    return subscribePendingTrack((t) => setPendingTrackState(t));
  }, []);

  useEffect(() => {
    if (activeTrack) clearPendingTrack();
  }, [activeTrack?.id]);

  // ── Singleton guard — only applies to floating variant ────────────────────
  const isOwnerRef = useRef(false);
  useEffect(() => {
    if (eqBarMode) return; // EQ bar doesn't need singleton protection
    _floatingPlayerMountCount += 1;
    isOwnerRef.current = _floatingPlayerMountCount === 1;
    return () => {
      if (isOwnerRef.current) _floatingPlayerMountCount = 0;
      else _floatingPlayerMountCount -= 1;
    };
  }, [eqBarMode]);

  // ── Route guard ────────────────────────────────────────────────────────────
  // Hide the FLOATING pill on ALL modal screens — lyrics, queue, EQ, playlists,
  // everything. Each modal decides for itself whether to show a player bar.
  // The EQ screen uses <FloatingPlayer eqBarMode /> as an inline bar — that is
  // a separate render path (eqBarMode=true) that bypasses this guard entirely.
  const isAnyModal =
    pathname.includes('/(modals)') ||
    pathname.includes('/modals/');

  // ── Playback state ─────────────────────────────────────────────────────────
  const currentState: State = (() => {
    if (!playbackState) return State.None;
    if (typeof playbackState === 'object' && 'state' in playbackState) {
      return (playbackState as { state: State }).state ?? State.None;
    }
    return playbackState as unknown as State;
  })();

  const isPlaying =
    currentState === State.Playing ||
    currentState === State.Buffering;

  // ── Decide what to display ─────────────────────────────────────────────────
  const displayTrack = activeTrack
    ? {
        title:   activeTrack.title   ?? 'Unknown Title',
        artist:  activeTrack.artist  ?? 'Unknown Artist',
        artwork: typeof activeTrack.artwork === 'string' ? activeTrack.artwork : null,
        isReal:  true,
      }
    : pendingTrack
    ? {
        title:   pendingTrack.title,
        artist:  pendingTrack.artist,
        artwork: pendingTrack.artwork || null,
        isReal:  false,
      }
    : null;

  // ── Animated bottom position (floating mode only) ─────────────────────────
  const floatingBottom = tabHeight + 4;
  const animatedStyle = useAnimatedStyle(
    () => ({ bottom: withTiming(floatingBottom, { duration: 300 }) }),
    [floatingBottom],
  );

  // ── Guards ─────────────────────────────────────────────────────────────────
  // EQ bar mode: show whenever there's something to display
  if (eqBarMode) {
    if (!displayTrack) return null;
  } else {
    // Floating mode: hide on any modal route. The EQ screen's eqBarMode instance
    // is a completely separate render (eqBarMode=true branch above), not this one.
    if (!displayTrack || isAnyModal || !isOwnerRef.current) return null;
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openPlayer = () => {
    if (!activeTrack) return;
    triggerHaptic();
    expandPlayer();
  };

  const handleTogglePlay = async (e: any) => {
    e.stopPropagation();
    if (!activeTrack) return;
    triggerHaptic();
    await togglePlayPause();
  };

  const handleSkipNext = async (e: any) => {
    e.stopPropagation();
    if (!activeTrack) return;
    triggerHaptic();
    try { await TrackPlayer.skipToNext(); } catch {}
  };

  const handleSkipPrev = async (e: any) => {
    e.stopPropagation();
    if (!activeTrack) return;
    triggerHaptic();
    try { await TrackPlayer.skipToPrevious(); } catch {}
  };

  // ── Shared card content ──────────────────────────────────────────────────
  const isPending = !displayTrack.isReal;

  const cardContent = (
    <TouchableOpacity
      style={styles.content}
      onPress={openPlayer}
      activeOpacity={isPending ? 1 : 0.88}
    >
      {/* Artwork */}
      <View style={styles.artWrap}>
        {displayTrack.artwork ? (
          <Image
            source={{ uri: displayTrack.artwork }}
            style={eqBarMode ? styles.artBar : styles.art}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[
            eqBarMode ? styles.artBar : styles.art,
            styles.artPlaceholder,
            isPending && styles.artPending,
          ]}>
            <Ionicons
              name={isPending ? 'hourglass-outline' : 'musical-notes'}
              size={eqBarMode ? 18 : 20}
              color="rgba(255,255,255,0.5)"
            />
          </View>
        )}
        {/* Playing indicator dot */}
        {isPlaying && !isPending && (
          <View style={styles.playingDot}>
            <View style={styles.playingDotInner} />
          </View>
        )}
      </View>

      {/* Track info */}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{displayTrack.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>
          {isPending ? 'Loading…' : displayTrack.artist}
        </Text>
      </View>

      {/* Controls */}
      <View style={[styles.controls, isPending && styles.controlsPending]}>
        {/* In EQ bar mode show prev + next; in floating show only next */}
        {eqBarMode && (
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={handleSkipPrev}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={isPending}
          >
            <Ionicons
              name="play-skip-back"
              size={18}
              color={isPending ? 'rgba(255,255,255,0.25)' : '#fff'}
            />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.controlBtn, styles.playBtn, isPending && styles.playBtnPending]}
          onPress={handleTogglePlay}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={isLoading || isPending}
        >
          <Ionicons
            name={isPending || isLoading ? 'hourglass-outline' : isPlaying ? 'pause' : 'play'}
            size={eqBarMode ? 20 : 22}
            color={isPending ? 'rgba(255,255,255,0.35)' : '#fff'}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlBtn}
          onPress={handleSkipNext}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={isPending}
        >
          <Ionicons
            name="play-skip-forward"
            size={18}
            color={isPending ? 'rgba(255,255,255,0.25)' : '#fff'}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  // ── EQ bar mode — inline, no absolute positioning ─────────────────────────
  if (eqBarMode) {
    return (
      <View style={[styles.barContainer, isPending && styles.cardLoading]}>
        <View style={styles.glassBase} />
        {cardContent}
      </View>
    );
  }

  // ── Floating pill mode ───────────────────────────────────────────────────
  return (
    <Animated.View style={[styles.wrapper, { left: 8, right: 8 }, animatedStyle]}>
      <View style={styles.glassBase} />
      <View style={[styles.card, isPending && styles.cardLoading]}>
        {cardContent}
      </View>
    </Animated.View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Floating pill ────────────────────────────────────────────────────────
  wrapper: {
    position: 'absolute',
    zIndex: 999,
  },
  card: {
    height: 64,
    borderRadius: 16,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  cardLoading: {
    borderColor: 'rgba(255,255,255,0.06)',
  },
  glassBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Platform.select({
      ios:     'rgba(20,20,25,0.85)',
      android: 'rgba(18,18,23,0.95)',
      default: 'rgba(18,18,23,0.9)',
    }),
    borderRadius: 16,
  },

  // ── EQ bar mode ───────────────────────────────────────────────────────────
  barContainer: {
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(139,115,85,0.25)',
    marginVertical: 6,
    position: 'relative',
  },

  // ── Shared content ────────────────────────────────────────────────────────
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    zIndex: 1,
  },
  artWrap: {
    marginRight: 12,
    position: 'relative',
  },
  art: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  artBar: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  artPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  artPending: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  playingDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  playingDotInner: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(139,115,85,1)',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  artist: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  controlsPending: {
    opacity: 0.35,
  },
  controlBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  playBtn: {
    backgroundColor: 'rgba(139,115,85,0.8)',
    borderColor: 'rgba(255,255,255,0.25)',
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  playBtnPending: {
    backgroundColor: 'rgba(139,115,85,0.3)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
});

export default FloatingPlayer;