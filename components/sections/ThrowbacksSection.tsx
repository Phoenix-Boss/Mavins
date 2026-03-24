// Updated: components/sections/ThrowbacksSection.tsx
/**
 * ThrowbacksSection — Store-First Version
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { SectionHeader } from "../common/SectionHeader";
import type { EditorPick } from "@/store/home";

const { width } = Dimensions.get("window");
const PARENT_PADDING  = 16;
const SIDE_GAP        = 8;
const CARD_VIS_WIDTH  = width - SIDE_GAP * 2;
const CARD_HEIGHT     = CARD_VIS_WIDTH * 0.68;

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
};

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

const DISPLAY_DURATION_MS = 12_000;

interface ThrowbacksSectionProps {
  data: EditorPick[];
}

export const ThrowbacksSection = ({ data }: ThrowbacksSectionProps) => {
  const router = useRouter();
  const [shuffledItems, setShuffledItems] = useState<EditorPick[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  const itemCountRef = useRef(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Shuffle when data changes
  useEffect(() => {
    if (data?.length > 0) {
      const shuffled = shuffleArray(data);
      setShuffledItems(shuffled);
      itemCountRef.current = shuffled.length;
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      fadeAnim.setValue(1);
    }
  }, [data]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

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

  // Auto-advance interval
  useEffect(() => {
    if (shuffledItems.length <= 1) return;

    const timer = setInterval(() => {
      const next = (currentIndexRef.current + 1) % itemCountRef.current;
      advanceTo(next);
    }, DISPLAY_DURATION_MS);

    return () => clearInterval(timer);
  }, [shuffledItems.length, advanceTo]);

  const handleSkip = useCallback(() => {
    triggerHaptic();
    const next = (currentIndexRef.current + 1) % itemCountRef.current;
    advanceTo(next);
  }, [advanceTo]);

  const featured = shuffledItems[currentIndex] ?? null;

  const handlePlay = () => { 
    triggerHaptic(); 
    if (featured) router.navigate(`/track/${featured.id}`); 
  };
  const handleBookmark = () => triggerHaptic();

  // Empty state
  if (!featured) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Throwbacks" showPlayAll />
        <View style={styles.emptyContainer} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Throwbacks" showPlayAll />

      <Animated.View style={[styles.card, { opacity: fadeAnim }]}>
        <Image
          source={{ uri: featured.thumbnail }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />

        <View style={styles.scrim} />

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

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{featured.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{featured.artist}</Text>
          {featured.views > 0 && (
            <Text style={styles.plays}>{formatViews(featured.views)}</Text>
          )}
        </View>

        <TouchableOpacity style={styles.playBtn} onPress={handlePlay} activeOpacity={0.85}>
          <Ionicons name="play" size={22} color={COLORS.background} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

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
  emptyContainer: {
    marginHorizontal: -(PARENT_PADDING - SIDE_GAP),
    height: CARD_HEIGHT,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceLight,
  },
});