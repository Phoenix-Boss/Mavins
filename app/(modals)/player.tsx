// components/player/PlayerScreen.tsx
//
// SPOTIFY-STYLE TRANSPARENT OVERLAY PLAYER
//
// Architecture:
//   (tabs) renders permanently behind this screen because the parent
//   Stack.Screen uses presentation: 'transparentModal'. This screen is
//   a pure transparent shell — zero background — so during swipe-down
//   the home screen is visible through the gap exactly like Spotify.
//
// What this screen owns:
//   1. Entrance animation  — spring up from off-screen bottom on mount
//   2. Swipe-to-dismiss    — pan gesture with velocity-aware fling
//   3. Scale-down effect   — player shrinks slightly as you drag (Spotify feel)
//   4. Background dim      — (tabs) dims as player slides up, brightens on dismiss
//   5. Hardware back       — Android back button triggers dismiss animation
//
// What this screen does NOT own:
//   - Play/pause, track data, progress — all inside PlayerContent
//   - Loading state — PlayerContent shows its own skeleton/spinner
//   - Route management — just calls router.back() on dismiss
//
// Gesture coordination:
//   GestureContext (from app/_layout.tsx) lets PlayerContent signal when the
//   slider or a button is being touched. The pan gesture checks this flag
//   on every update so it never fights with a slider drag.

import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  BackHandler,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

import { triggerHaptic } from '@/helpers/haptics';
import PlayerContent from '@/components/player/playerContent';
import { useGestureContext } from '@/app/_layout';
import { usePlayerOverlay } from '@/components/player/playerProvider';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Tuning constants ─────────────────────────────────────────────────────────

const SPRING_CONFIG = {
  OPEN:  { damping: 28, stiffness: 260, mass: 1, overshootClamping: true },
  SNAP:  { damping: 28, stiffness: 260, overshootClamping: true },
  FLING: { damping: 38, stiffness: 280, overshootClamping: true },
};

const DISMISS_THRESHOLD_RATIO = 0.18;
const DISMISS_VELOCITY        = 750;
const SCALE_DRAG_FACTOR       = 0.00008;

// ─────────────────────────────────────────────────────────────────────────────

export default function PlayerScreen() {
  const router       = useRouter();
  const insets       = useSafeAreaInsets();

  // GestureContext — gestureBlockedSV is a Reanimated shared value, safe to read
  // directly inside worklets on the UI thread. isGestureBlocked() is kept for any
  // JS-side checks but must NEVER be called from within a worklet.
  const { gestureBlockedSV } = useGestureContext();

  // PlayerOverlay — collapsePlayer marks player as closed in context BEFORE
  // we call router.back(), so FloatingPlayer visibility updates in the same frame.
  // playerReady comes from RootLayout startup via context — no local waiting needed.
  const { collapsePlayer, playerReady } = usePlayerOverlay();

  // ─── Shared values ────────────────────────────────────────────────────────
  const translateY   = useSharedValue(SCREEN_HEIGHT);
  const dragProgress = useSharedValue(0);
  const isAnimating  = useRef(false);
  const DISMISS_THRESHOLD = SCREEN_HEIGHT * DISMISS_THRESHOLD_RATIO;

  // ─── Entrance animation ───────────────────────────────────────────────────
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      translateY.value   = withSpring(0, SPRING_CONFIG.OPEN);
      dragProgress.value = withTiming(0, { duration: 350 });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Dismiss ──────────────────────────────────────────────────────────────
  // 1. collapsePlayer() — updates isPlayerVisible=false in context so
  //    FloatingPlayer re-appears in the same render cycle as navigation.
  // 2. router.back() — pops the (player) route.
  // Order matters: state update before navigation prevents the flash where
  // FloatingPlayer briefly shows on top of the sliding-down player card.
  const handleDismiss = useCallback(() => {
    if (isAnimating.current) return;
    isAnimating.current = true;

    triggerHaptic();
    collapsePlayer();   // ← state update first

    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }

    setTimeout(() => { isAnimating.current = false; }, 600);
  }, [router, collapsePlayer]);

  // ─── Android hardware back ────────────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isAnimating.current) return true;
      translateY.value = withSpring(
        SCREEN_HEIGHT,
        { ...SPRING_CONFIG.FLING, velocity: 600 },
        (finished) => { if (finished) runOnJS(handleDismiss)(); },
      );
      dragProgress.value = withTiming(1, { duration: 250 });
      return true;
    });
    return () => sub.remove();
  }, [handleDismiss, translateY, dragProgress]);

  // ─── Pan gesture ──────────────────────────────────────────────────────────
  // isGestureBlocked() is a plain JS function — cannot be called directly
  // inside a Reanimated worklet. We mirror it into gestureBlockedSV so the
  // worklet can read it safely on the UI thread.
  const panGesture = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetY(-5)
    .onBegin(() => {
      // gestureBlockedSV is a shared value — safe to read directly on the UI thread.
      // No runOnJS needed; the value is kept in sync by GestureContext setters.
    })
    .onUpdate((event) => {
      if (gestureBlockedSV.value) return;
      if (event.translationY <= 0) return;

      translateY.value   = event.translationY;
      dragProgress.value = Math.min(event.translationY / (SCREEN_HEIGHT * 0.5), 1);
    })
    .onEnd((event) => {
      if (gestureBlockedSV.value) {
        // Slider was active — snap back regardless
        translateY.value   = withSpring(0, SPRING_CONFIG.SNAP);
        dragProgress.value = withTiming(0, { duration: 200 });
        return;
      }

      const shouldDismiss =
        event.translationY > DISMISS_THRESHOLD ||
        (event.translationY > 50 && event.velocityY > DISMISS_VELOCITY);

      if (shouldDismiss) {
        dragProgress.value = withTiming(1, { duration: 200 });
        translateY.value   = withSpring(
          SCREEN_HEIGHT,
          { ...SPRING_CONFIG.FLING, velocity: event.velocityY },
          (finished) => { if (finished) runOnJS(handleDismiss)(); },
        );
      } else {
        translateY.value   = withSpring(0, SPRING_CONFIG.SNAP);
        dragProgress.value = withTiming(0, { duration: 200 });
      }
    });

  // ─── Animated styles ──────────────────────────────────────────────────────

  const playerAnimStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      translateY.value,
      [0, SCREEN_HEIGHT * 0.5],
      [1, 1 - SCREEN_WIDTH * SCALE_DRAG_FACTOR],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ translateY: translateY.value }, { scale }],
    };
  });

  // Dim overlay — 0 by default (pure Spotify: home is fully visible on swipe).
  // Change second outputRange value to e.g. 0.4 for a subtle scrim.
  const dimAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragProgress.value, [0, 1], [0, 0], Extrapolation.CLAMP),
  }));

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <Animated.View style={[styles.dimOverlay, dimAnimStyle]} pointerEvents="none" />
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.playerCard, playerAnimStyle]}>
          <PlayerContent
            onMinimize={handleDismiss}
            onClose={handleDismiss}
            isExpanded={true}
            playerReady={playerReady}
            topInset={insets.top}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Transparent root — (tabs) shows through completely.
  // flex:1 is required for GestureDetector to have a hit area.
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  // Scrim behind player card — transparent by default, see dimAnimStyle above.
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 0,
  },

  // The animated card — transparent background so LinearGradient inside
  // PlayerContent is the only fill. overflow:hidden clips the gradient
  // to the card bounds during the scale micro-animation.
  playerCard: {
    flex: 1,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    zIndex: 1,
    // Rounded top corners give the Spotify "card lifted from below" look.
    // Remove if you prefer edge-to-edge.
    borderTopLeftRadius: Platform.OS === 'ios' ? 14 : 10,
    borderTopRightRadius: Platform.OS === 'ios' ? 14 : 10,
  },
});