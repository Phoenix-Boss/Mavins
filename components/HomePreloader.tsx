// components/sections/QuickPicksSection.tsx
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { CampaignCard } from '@/store/home';
import { useTheme } from '@/contexts/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 32;
const CARD_HEIGHT = 120;

interface QuickPicksSectionProps {
  data: CampaignCard[];
  onCardPress: (card: CampaignCard) => void;
}

export function QuickPicksSection({ data, onCardPress }: QuickPicksSectionProps) {
  const { colors } = useTheme();
  const scrollX = useRef(new Animated.Value(0)).current;

  if (!data.length) return null;

  const formatPlayCount = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const AnimatedNumber = ({ value }: { value: number }) => {
    const animatedValue = useRef(new Animated.Value(0)).current;
    const [displayValue, setDisplayValue] = React.useState(0);

    useEffect(() => {
      Animated.timing(animatedValue, {
        toValue: value,
        duration: 1000,
        useNativeDriver: false,
      }).start();

      const listener = animatedValue.addListener(({ value: v }) => {
        setDisplayValue(Math.floor(v));
      });

      return () => animatedValue.removeListener(listener);
    }, [value]);

    return <Text style={[styles.playCount, { color: colors.gold }]}>{formatPlayCount(displayValue)}</Text>;
  };

  const renderCard = (card: CampaignCard, index: number) => {
    const inputRange = [
      (index - 1) * CARD_WIDTH,
      index * CARD_WIDTH,
      (index + 1) * CARD_WIDTH,
    ];
    const scale = scrollX.interpolate({
      inputRange,
      outputRange: [0.9, 1, 0.9],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View
        key={card.id}
        style={[
          styles.cardContainer,
          {
            transform: [{ scale }],
            width: CARD_WIDTH - 16,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.surfaceRaised }]}
          onPress={() => onCardPress(card)}
          activeOpacity={0.9}
        >
          {/* Badge Container */}
          <View style={styles.badgeContainer}>
            {card.promoted && (
              <View style={[styles.badge, styles.promotedBadge]}>
                <Ionicons name="flame" size={10} color="#fff" />
                <Text style={styles.badgeText}>Promoted</Text>
              </View>
            )}
            {card.mavinSpecial && (
              <View style={[styles.badge, styles.mavinBadge]}>
                <Ionicons name="musical-notes" size={10} color="#D4AF37" />
                <Text style={[styles.badgeText, styles.mavinBadgeText]}>Mavin Special</Text>
              </View>
            )}
          </View>

          {/* Thumbnail */}
          <Image
            source={{ uri: card.thumbnail }}
            style={styles.thumbnail}
            contentFit="cover"
          />

          {/* Content */}
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {card.title}
            </Text>
            {card.description && (
              <Text style={[styles.description, { color: colors.textSub }]} numberOfLines={1}>
                {card.description}
              </Text>
            )}
          </View>

          {/* Play Count with Animation */}
          <View style={styles.playCountContainer}>
            <Ionicons name="play-circle" size={14} color={colors.gold} />
            <AnimatedNumber value={card.playCount} />
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="star" size={20} color={colors.gold} />
          <Text style={[styles.titleText, { color: colors.text }]}>Quick Picks</Text>
        </View>
        <Text style={[styles.subtitle, { color: colors.textSub }]}>Handpicked for you</Text>
      </View>

      <Animated.FlatList
        data={data}
        renderItem={({ item, index }) => renderCard(item, index)}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH - 16}
        decelerationRate="fast"
        contentContainerStyle={styles.listContent}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleText: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  cardContainer: {
    height: CARD_HEIGHT,
    marginRight: 12,
  },
  card: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
    position: 'relative',
  },
  badgeContainer: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 10,
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  promotedBadge: {
    backgroundColor: '#FF6B35',
  },
  mavinBadge: {
    backgroundColor: '#1A1A2E',
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
  },
  mavinBadgeText: {
    color: '#D4AF37',
  },
  thumbnail: {
    width: CARD_HEIGHT,
    height: CARD_HEIGHT,
  },
  content: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  description: {
    fontSize: 11,
  },
  playCountContainer: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  playCount: {
    fontSize: 11,
    fontWeight: '600',
  },
});