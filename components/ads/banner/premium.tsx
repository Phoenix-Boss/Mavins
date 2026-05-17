/**
 * components/ads/banner/premium.tsx
 *
 * A full-screen luxury modal shown on app init (once per session).
 * Tap the banner → routes to /(modals)/premium.
 * Tap "Maybe Later" or outside → dismisses.
 *
 * Design language: adapts to light/dark mode with gold accents.
 */

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Dimensions,
  Pressable,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  withSequence,
  withRepeat,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/helpers/haptics";
import { useTheme } from "@/contexts/ThemeContext";

const { width: W, height: H } = Dimensions.get("window");

// ─── Feature rows ────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: "ban-outline",            label: "Zero ads, ever" },
  { icon: "cloud-download-outline", label: "Unlimited offline downloads" },
  { icon: "infinite-outline",       label: "Unlimited skips" },
  { icon: "headset-outline",        label: "320 kbps lossless audio" },
  { icon: "musical-notes-outline",  label: "Full lyrics & karaoke" },
];

// ─── Animated orb ────────────────────────────────────────────────────────────

function GoldOrb({ delay = 0, size = 120, style, goldColor }: { delay?: number; size?: number; style?: any; goldColor: string }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.8);

  useEffect(() => {
    opacity.value = withDelay(delay, withRepeat(
      withSequence(
        withTiming(0.6, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.15, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true
    ));
    scale.value = withDelay(delay, withRepeat(
      withSequence(
        withTiming(1.1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.9, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true
    ));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: goldColor,
          shadowColor: goldColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 1,
          shadowRadius: size * 0.5,
        },
        style,
        animStyle,
      ]}
    />
  );
}

// ─── Shimmer line ─────────────────────────────────────────────────────────────

function ShimmerLine({ delay = 0, goldColor }: { delay?: number; goldColor: string }) {
  const x = useSharedValue(-W);

  useEffect(() => {
    x.value = withDelay(
      delay,
      withRepeat(
        withTiming(W * 1.5, { duration: 2000, easing: Easing.linear }),
        -1,
        false
      )
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: 0,
          bottom: 0,
          width: 60,
          backgroundColor: `rgba(212,175,55,0.08)`,
          transform: [{ skewX: "-20deg" }],
        },
        animStyle,
      ]}
    />
  );
}

// ─── Feature row component ────────────────────────────────────────────────────

function FeatureRow({
  icon,
  label,
  opacity,
  translateY,
  goldColor,
  textColor,
  isDark,
}: {
  icon: string;
  label: string;
  opacity: any;
  translateY: any;
  goldColor: string;
  textColor: string;
  isDark: boolean;
}) {
  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View 
      style={[
        styles.featureRow, 
        animStyle, 
        { 
          backgroundColor: isDark ? `${goldColor}08` : `${goldColor}10`,
        }
      ]}
    >
      <View style={[styles.featureIconWrap, { borderColor: `${goldColor}40`, backgroundColor: `${goldColor}10` }]}>
        <Ionicons name={icon as any} size={14} color={goldColor} />
      </View>
      <Text style={[styles.featureLabel, { color: textColor }]}>{label}</Text>
      <Ionicons name="checkmark-circle" size={14} color={goldColor} style={{ opacity: 0.7 }} />
    </Animated.View>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface PremiumBannerProps {
  visible: boolean;
  onDismiss: () => void;
}

export default function PremiumBanner({ visible, onDismiss }: PremiumBannerProps) {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  // Theme-aware colors
  const gold = colors.gold;
  const goldShimmer = isDark ? "#F0D060" : "#E8B830";
  const goldDeep = isDark ? "#A07820" : "#B8860B";
  const bgCard = isDark ? "#0A0A0A" : "#FFFFFF";
  const textColor = colors.text;
  const textSubColor = colors.textSub;
  const textMuted = colors.textMuted;
  const iconColor = isDark ? "#000000" : "#FFFFFF";
  const backdropColor = isDark ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.5)";

  // Entrance animations
  const backdropOpacity = useSharedValue(0);
  const cardTranslateY = useSharedValue(80);
  const cardOpacity = useSharedValue(0);
  const crownScale = useSharedValue(0.4);
  const crownRotate = useSharedValue(-15);

  // Feature stagger animations
  const fo0 = useSharedValue(0); const ft0 = useSharedValue(12);
  const fo1 = useSharedValue(0); const ft1 = useSharedValue(12);
  const fo2 = useSharedValue(0); const ft2 = useSharedValue(12);
  const fo3 = useSharedValue(0); const ft3 = useSharedValue(12);
  const fo4 = useSharedValue(0); const ft4 = useSharedValue(12);
  const featureOpacities = [fo0, fo1, fo2, fo3, fo4];
  const featureTranslates = [ft0, ft1, ft2, ft3, ft4];

  useEffect(() => {
    if (visible) {
      // Animate in
      backdropOpacity.value = withTiming(1, { duration: 350 });
      cardTranslateY.value = withDelay(100, withSpring(0, { damping: 18, stiffness: 200 }));
      cardOpacity.value = withDelay(100, withTiming(1, { duration: 300 }));
      crownScale.value = withDelay(350, withSpring(1, { damping: 10, stiffness: 260 }));
      crownRotate.value = withDelay(350, withSpring(0, { damping: 12, stiffness: 200 }));
      
      // Stagger feature animations
      FEATURES.forEach((_, i) => {
        featureOpacities[i].value = withDelay(500 + i * 80, withTiming(1, { duration: 280 }));
        featureTranslates[i].value = withDelay(500 + i * 80, withSpring(0, { damping: 16, stiffness: 200 }));
      });
    } else {
      // Reset for next open
      backdropOpacity.value = withTiming(0, { duration: 200 });
      cardTranslateY.value = withTiming(60, { duration: 200 });
      cardOpacity.value = withTiming(0, { duration: 200 });
      crownScale.value = 0.4;
      crownRotate.value = -15;
      FEATURES.forEach((_, i) => {
        featureOpacities[i].value = 0;
        featureTranslates[i].value = 12;
      });
    }
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardTranslateY.value }],
  }));

  const crownStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: crownScale.value },
      { rotate: `${crownRotate.value}deg` },
    ],
  }));

  const handleUpgrade = () => {
    triggerHaptic();
    onDismiss();
    setTimeout(() => router.push("/(modals)/premium"), 200);
  };

  const handleDismiss = () => {
    triggerHaptic();
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      {/* Backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss}>
          <BlurView
            intensity={Platform.OS === "ios" ? 30 : 20}
            tint={isDark ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }]} />
        </Pressable>
      </Animated.View>

      {/* Card container */}
      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View 
          style={[
            styles.card, 
            cardStyle, 
            { 
              backgroundColor: bgCard, 
              borderColor: `${gold}40`,
              shadowColor: gold,
            }
          ]}
        >
          {/* Background orbs */}
          <GoldOrb size={180} delay={0} style={{ top: -60, left: -40, opacity: 0.18 }} goldColor={gold} />
          <GoldOrb size={120} delay={700} style={{ bottom: 20, right: -30, opacity: 0.12 }} goldColor={gold} />

          {/* Shimmer sweep */}
          <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]} pointerEvents="none">
            <ShimmerLine delay={800} goldColor={gold} />
            <ShimmerLine delay={1600} goldColor={gold} />
          </View>

          {/* Top gold hairline */}
          <LinearGradient
            colors={["transparent", gold, goldShimmer, gold, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topLine}
          />

          {/* Close button */}
          <TouchableOpacity 
            style={[
              styles.closeBtn, 
              { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }
            ]} 
            onPress={handleDismiss} 
            hitSlop={12}
          >
            <Ionicons name="close" size={16} color={textMuted} />
          </TouchableOpacity>

          {/* Crown icon */}
          <Animated.View style={[styles.crownWrap, crownStyle]}>
            <LinearGradient
              colors={[goldShimmer, gold, goldDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.crownGradient}
            >
              <Ionicons name="diamond" size={28} color={iconColor} />
            </LinearGradient>
            <View style={[styles.crownRing1, { borderColor: `${gold}40` }]} />
            <View style={[styles.crownRing2, { borderColor: `${gold}20` }]} />
          </Animated.View>

          {/* Headline */}
          <Text style={[styles.headline, { color: textColor }]}>
            Mavin <Text style={[styles.headlineGold, { color: gold }]}>Premium</Text>
          </Text>
          <Text style={[styles.tagline, { color: textSubColor }]}>
            Your music. No limits. No ads.{'\n'}Everywhere you go.
          </Text>

          {/* Divider */}
          <LinearGradient
            colors={["transparent", `${gold}50`, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.divider}
          />

          {/* Feature list */}
          <View style={styles.featureList}>
            {FEATURES.map((f, i) => (
              <FeatureRow
                key={f.icon}
                icon={f.icon}
                label={f.label}
                opacity={featureOpacities[i]}
                translateY={featureTranslates[i]}
                goldColor={gold}
                textColor={textColor}
                isDark={isDark}
              />
            ))}
          </View>

          {/* Price badge */}
          <View style={[styles.priceBadge, { backgroundColor: `${gold}08`, borderColor: `${gold}30` }]}>
            <Text style={[styles.priceLabel, { color: textSubColor }]}>From</Text>
            <Text style={[styles.price, { color: gold }]}>₦1,500</Text>
            <Text style={[styles.pricePeriod, { color: textSubColor }]}>/month</Text>
          </View>

          {/* CTA button */}
          <TouchableOpacity
            style={[styles.ctaBtn, { shadowColor: gold }]}
            onPress={handleUpgrade}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={[goldShimmer, gold, goldDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaGradient}
            >
              <Ionicons name="diamond-outline" size={16} color={iconColor} style={{ marginRight: 8 }} />
              <Text style={[styles.ctaText, { color: iconColor }]}>Unlock Premium</Text>
              <Ionicons name="arrow-forward" size={14} color={iconColor} style={{ marginLeft: 6 }} />
            </LinearGradient>
          </TouchableOpacity>

          {/* Dismiss button */}
          <TouchableOpacity onPress={handleDismiss} hitSlop={10} style={{ marginTop: 14 }}>
            <Text style={[styles.laterText, { color: textMuted, textDecorationColor: textMuted }]}>
              Maybe Later
            </Text>
          </TouchableOpacity>

          {/* Bottom gold hairline */}
          <LinearGradient
            colors={["transparent", gold, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.bottomLine}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centeredContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 28,
    alignItems: "center",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 32,
    elevation: 20,
  },
  topLine: {
    height: 1,
    width: "80%",
    alignSelf: "center",
    marginBottom: 24,
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  crownWrap: {
    marginBottom: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  crownGradient: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  crownRing1: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
  },
  crownRing2: {
    position: "absolute",
    width: 102,
    height: 102,
    borderRadius: 51,
    borderWidth: 1,
  },
  headline: {
    fontSize: 26,
    fontFamily: "Meriva",
    letterSpacing: 0.5,
    marginBottom: 8,
    textAlign: "center",
  },
  headlineGold: {},
  tagline: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  divider: {
    height: 1,
    width: "100%",
    marginBottom: 18,
  },
  featureList: {
    width: "100%",
    marginBottom: 20,
    gap: 2,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  featureIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  featureLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
  },
  priceBadge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    marginBottom: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 0.5,
  },
  priceLabel: {
    fontSize: 12,
  },
  price: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  pricePeriod: {
    fontSize: 12,
  },
  ctaBtn: {
    width: "100%",
    borderRadius: 28,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },
  ctaGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    paddingHorizontal: 24,
  },
  ctaText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  laterText: {
    fontSize: 13,
    textDecorationLine: "underline",
  },
  bottomLine: {
    height: 1,
    width: "60%",
    marginTop: 20,
  },
});
