/**
 * ThrowbacksSection
 *
 * Full-width card identical to MavinsBestSection.
 * Cycles through all cached throwback items — shows each one for exactly
 * 12 seconds before fading to the next. Manual skip via top-right button.
 *
 * Interval stability: currentIndex is tracked in a ref so the setInterval
 * callback never becomes stale and the timer never resets mid-cycle.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { useCoverSongs, CoverItem } from "../../hooks/useCoverSongs";
import { SectionHeader } from "../common/SectionHeader";

// ─── Layout (mirrors MavinsBestSection exactly) ───────────────────────────────

const { width } = Dimensions.get("window");
const PARENT_PADDING  = 16;
const SIDE_GAP        = 8;
const CARD_VIS_WIDTH  = width - SIDE_GAP * 2;
const CARD_HEIGHT     = CARD_VIS_WIDTH * 0.68;

// ─── Colors ───────────────────────────────────────────────────────────────────

const COLORS = {
  background:    "#000000",
  surface:       "#121212",
  surfaceLight:  "#1F1F1F",
  goldPrimary:   "#D4AF37",
  goldShiny:     "#FFD700",
  goldShimmer:   "#E6C16A",
  text:          "#FFFFFF",
  textSecondary: "#B3B3B3",
  textTertiary:  "#808080",
  danger:        "#EF4444",
};

/** Each card is shown for exactly this long before auto-advancing. */
const DISPLAY_DURATION_MS = 12_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatViews(n: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M plays`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K plays`;
  return `${n} plays`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ─── YouTubeThumbnail ─────────────────────────────────────────────────────────

interface ThumbnailProps {
  primary:   string;
  secondary: string;
  style:     any;
}

const YouTubeThumbnail = ({ primary, secondary, style }: ThumbnailProps) => {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { setAttempt(0); }, [primary]);

  if (attempt >= 2) {
    return <View style={[style, { backgroundColor: COLORS.surfaceLight }]} />;
  }

  return (
    <Image
      source={{ uri: attempt === 0 ? primary : secondary }}
      style={style}
      resizeMode="cover"
      onError={() => setAttempt(prev => Math.min(prev + 1, 2))}
    />
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

export const ThrowbacksSection = () => {
  const { data, loading, error, refetch } = useCoverSongs();
  const router = useRouter();

  const [shuffledItems, setShuffledItems] = useState<CoverItem[]>([]);
  const [currentIndex,  setCurrentIndex]  = useState(0);

  /**
   * Keep currentIndex in a ref so the interval callback always reads
   * the latest value without needing to be recreated on every index change.
   * This is the key fix — the interval is created ONCE and never resets.
   */
  const currentIndexRef = useRef(0);
  const itemCountRef    = useRef(0);
  const fadeAnim        = useRef(new Animated.Value(1)).current;

  // Sync ref whenever state changes
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  // Shuffle once when data lands
  useEffect(() => {
    if (data.length > 0) {
      const shuffled = shuffleArray(data);
      setShuffledItems(shuffled);
      itemCountRef.current = shuffled.length;
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      fadeAnim.setValue(1);
    }
  }, [data]);

  /** Fade out → swap → fade in. Uses refs so it's always stable. */
  const advanceTo = useCallback((nextIndex: number) => {
    Animated.timing(fadeAnim, {
      toValue:  0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setCurrentIndex(nextIndex);
      currentIndexRef.current = nextIndex;
      Animated.timing(fadeAnim, {
        toValue:  1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    });
  }, [fadeAnim]);

  /**
   * Stable interval — created once when shuffledItems first arrives,
   * never recreated on index changes because it reads from currentIndexRef.
   */
  useEffect(() => {
    if (shuffledItems.length <= 1) return;

    const timer = setInterval(() => {
      const next = (currentIndexRef.current + 1) % itemCountRef.current;
      advanceTo(next);
    }, DISPLAY_DURATION_MS);

    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffledItems.length]); // only recreate if list size changes

  /** Manual skip — advances immediately, interval continues from new position. */
  const handleSkip = useCallback(() => {
    triggerHaptic();
    const next = (currentIndexRef.current + 1) % itemCountRef.current;
    advanceTo(next);
  }, [advanceTo]);

  const featured = shuffledItems[currentIndex] ?? null;

  const handlePlay     = () => { triggerHaptic(); if (featured) router.navigate(`/track/${featured.id}`); };
  const handleBookmark = () => triggerHaptic();

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Throwbacks" showPlayAll />
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={COLORS.goldPrimary} />
          <Text style={styles.subtleText}>Loading throwbacks…</Text>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Throwbacks" showPlayAll />
        <View style={styles.placeholder}>
          <Ionicons name="alert-circle-outline" size={28} color={COLORS.danger} />
          <Text style={styles.errorText}>Could not load throwbacks</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={refetch}>
            <Ionicons name="refresh" size={13} color={COLORS.goldPrimary} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (!featured) return null;

  // ── Success ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.section}>
      <SectionHeader title="Throwbacks" showPlayAll />

      <Animated.View style={[styles.card, { opacity: fadeAnim }]}>

        {/* Cover art with cascading fallback */}
        <YouTubeThumbnail
          primary={featured.thumbnail}
          secondary={featured.thumbnailFallback}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Scrim */}
        <View style={styles.scrim} />

        {/* Actions — top right */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleBookmark} hitSlop={10}>
            <Ionicons name="bookmark-outline" size={20} color={COLORS.goldShimmer} />
          </TouchableOpacity>
          {shuffledItems.length > 1 && (
            <TouchableOpacity style={styles.actionBtn} onPress={handleSkip} hitSlop={10}>
              <Ionicons name="play-skip-forward-outline" size={20} color={COLORS.goldShimmer} />
            </TouchableOpacity>
          )}
        </View>

        {/* Info — bottom left */}
        <View style={styles.info}>
          <Text style={styles.title}  numberOfLines={1}>{featured.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{featured.artist}</Text>
          {featured.views > 0 && (
            <Text style={styles.plays}>{formatViews(featured.views)}</Text>
          )}
        </View>

        {/* Play — bottom right */}
        <TouchableOpacity style={styles.playBtn} onPress={handlePlay} activeOpacity={0.85}>
          <Ionicons name="play" size={22} color={COLORS.background} />
        </TouchableOpacity>

      </Animated.View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  card: {
    marginHorizontal: -(PARENT_PADDING - SIDE_GAP),
    height: CARD_HEIGHT,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
  },
  scrim: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    top: "45%",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  actions: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.50)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.35)",
  },
  info: {
    position: "absolute",
    bottom: 16,
    left: 14,
    right: 72,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 2,
  },
  artist: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.goldShimmer,
    marginBottom: 2,
  },
  plays: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  playBtn: {
    position: "absolute",
    bottom: 14,
    right: 14,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.goldPrimary,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: COLORS.goldShiny,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 6,
  },
  placeholder: {
    marginHorizontal: -(PARENT_PADDING - SIDE_GAP),
    height: CARD_HEIGHT,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  subtleText: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: "600",
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: COLORS.goldPrimary + "20",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
    marginTop: 4,
  },
  retryText: {
    color: COLORS.goldPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
});