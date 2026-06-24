// components/sections/QuickPicksSection.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
  useColorScheme,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import type { CampaignCard } from '@/store/home';

interface QuickPicksSectionProps {
  data: CampaignCard[];
  onCardPress: (card: CampaignCard) => void;
}

const CARD_HEIGHT = 130;

// ─── BADGE ───────────────────────────────────────────────────────────────────

const BADGE_SIZE = 46;
const BADGE_LIGHT = require('@/assets/images/badge.png');
const BADGE_DARK  = require('@/assets/images/badge2.png');

function BadgeImage({ isDark }: { isDark: boolean }) {
  return (
    <View style={styles.badgeContainer}>
      <Image
        source={isDark ? BADGE_DARK : BADGE_LIGHT}
        style={styles.badgeImage}
        contentFit="contain"
      />
    </View>
  );
}

// ─── PLAY COUNT COUNTER ───────────────────────────────────────────────────────

const COUNTER_DURATION = 1100;

function formatPlayCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000)     return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function AnimatedCounter({
  playCount,
  colors,
  isDark,
}: {
  playCount: number;
  colors: any;
  isDark: boolean;
}) {
  const animatedValue = useRef(new Animated.Value(0)).current;
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    animatedValue.setValue(0);
    const anim = Animated.timing(animatedValue, {
      toValue: playCount,
      duration: COUNTER_DURATION,
      useNativeDriver: false,
    });
    anim.start();
    const listener = animatedValue.addListener(({ value: v }) => {
      setDisplayValue(Math.floor(v));
    });
    return () => {
      animatedValue.removeListener(listener);
      anim.stop();
    };
  }, [playCount]);

  // Dark mode: number = white, "plays" = gold
  // Light mode: number = black, "plays" = orange
  const numberColor = isDark ? '#FFFFFF' : '#000000';
  const playsColor  = isDark ? colors.gold : '#E8460A';

  return (
    <View style={styles.counterWrapper}>
      <View style={[styles.counterBlob, { backgroundColor: colors.gold + '22' }]}>
        <Text style={[styles.counterText, { color: numberColor }]}>
          {formatPlayCount(displayValue)}
        </Text>
        <Text style={[styles.counterLabel, { color: playsColor }]}>
          plays
        </Text>
      </View>
    </View>
  );
}

// ─── ARTIST PILL ──────────────────────────────────────────────────────────────

function ArtistPill({ artist, colors }: { artist: string; colors: any }) {
  return (
    <View style={[styles.artistPill, { backgroundColor: colors.surface + 'CC' }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.artistScrollView}
        contentContainerStyle={styles.artistScrollContent}
      >
        <Text style={[styles.artistPillText, { color: colors.textSub }]}>
          {artist}
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export function QuickPicksSection({ data, onCardPress }: QuickPicksSectionProps) {
  const { colors }    = useTheme();
  const colorScheme   = useColorScheme();
  const isDark        = colorScheme === 'dark';

  const firstCard = data && data.length > 0 ? data[0] : null;
  if (!firstCard) return null;

  // Use the artist name from engine enrichment — clean and accurate
  const artistDisplay = firstCard.artistName || '';

  return (
    <View style={styles.container}>
      {/*
        cardWrapper: fixed height = CARD_HEIGHT so all absolute children
        (counter pill, badge) anchor to the card's coordinate space.
        No overflow set → defaults to visible, nothing gets clipped.
      */}
      <View style={styles.cardWrapper}>
        {/* ── Card ── */}
        <TouchableOpacity
          style={[styles.singleCard, { backgroundColor: colors.surfaceRaised }]}
          onPress={() => onCardPress(firstCard)}
          activeOpacity={0.88}
        >
          <Image
            source={{ uri: firstCard.thumbnail }}
            style={styles.thumbnail}
            contentFit="cover"
          />

          <View style={styles.content}>
            <Text style={[styles.songTitle, { color: colors.text }]} numberOfLines={2}>
              {firstCard.songTitle || firstCard.title}
            </Text>

            {/* Artist pill — scrolls horizontally if name overflows */}
            {artistDisplay ? (
              <ArtistPill artist={artistDisplay} colors={colors} />
            ) : null}
          </View>

          {/* Promoted flame badge — top-left, small, stays inside card */}
          {firstCard.promoted && (
            <View style={styles.promotedBadge}>
              <Ionicons name="flame" size={10} color="#fff" />
              <Text style={styles.promotedBadgeText}>Promoted</Text>
            </View>
          )}
        </TouchableOpacity>

        {/*
          Certified badge — OUTSIDE singleCard (not clipped), bottom-right,
          shifted right beyond card edge.
        */}
        {firstCard.promoted && <BadgeImage isDark={isDark} />}

        {/*
          Play count counter — OUTSIDE singleCard (not clipped by overflow:hidden).
          Anchored to bottom-right of cardWrapper using absolute positioning.
          The wrapper has explicit height=CARD_HEIGHT so `bottom` is reliable.
          Sits just inside the card's right edge so it overlaps the card visually
          while the 5° rotation lets it lean outward naturally.
        */}
        <View style={styles.counterOuterWrapper} pointerEvents="none">
          <AnimatedCounter
            playCount={firstCard.playCount}
            colors={colors}
            isDark={isDark}
          />
        </View>
      </View>
    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },

  // Fixed height so absolute children anchor correctly.
  // marginHorizontal provides screen gutters.
  cardWrapper: {
    marginHorizontal: 16,
    height: CARD_HEIGHT,   // ← critical: gives absolute children a reference frame
    position: 'relative',
    // overflow: visible (default) — badge and counter bleed freely
  },

  singleCard: {
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',    // clips thumbnail to rounded corners
    height: CARD_HEIGHT,
  },

  thumbnail: {
    width: CARD_HEIGHT,
    height: CARD_HEIGHT,
  },

  content: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    justifyContent: 'center',
  },

  songTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.5,
    lineHeight: 20,
    marginBottom: 6,
    fontFamily: 'Courier New',
    textTransform: 'uppercase',
  },

  artistPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    overflow: 'hidden',
  },

  artistScrollView: {
    flexGrow: 0,
  },

  artistScrollContent: {
    alignItems: 'center',
  },

  artistPillText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    fontFamily: 'Courier New',
  },

  // Anchored to bottom-right of cardWrapper, sitting over the card's content area.
  // bottom: 8  → 8px above the card's bottom edge (inside the card visually)
  // right: 8   → 8px from the card's right edge
  counterOuterWrapper: {
    position: 'absolute',
    bottom: 8,
    right: 150,
    zIndex: 20,
  },

  // 5° slant on the entire pill
  counterWrapper: {
    alignSelf: 'flex-start',
    transform: [{ rotate: '5deg' }],
  },

  counterBlob: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },

  counterText: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 18,
    transform: [{ skewX: '-4deg' }],
    includeFontPadding: false,
  },

  counterLabel: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },

  promotedBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
    backgroundColor: '#E8460A',
    zIndex: 10,
  },

  promotedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Certified badge — bottom-right, bleeds beyond card right edge
  badgeContainer: {
    position: 'absolute',
    bottom: -8,
    right: -14,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    zIndex: 10,
  },

  badgeImage: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
  },
});

export default QuickPicksSection;