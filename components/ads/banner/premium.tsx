/**
 * components/ads/banner/premium.tsx
 *
 * A full-screen luxury modal shown on app init (once per session).
 * Tap the banner → routes to /(modals)/premium.
 * Tap "Maybe Later" or outside → dismisses.
 *
 * Design language: black obsidian + gold dust — matches Mavin's dark luxury palette.
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
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/helpers/haptics";

const { width: W, height: H } = Dimensions.get("window");

// ─── Palette ────────────────────────────────────────────────────────────────

const C = {
  bg: "#000000",
  gold: "#D4AF37",
  goldShimmer: "#F0D060",
  goldDeep: "#A07820",
  goldFill: "rgba(212,175,55,0.12)",
  goldBorder: "rgba(212,175,55,0.35)",
  goldGlow: "rgba(212,175,55,0.08)",
  text: "#FFFFFF",
  textSub: "#AAAAAA",
  textMuted: "#555555",
};

// ─── Feature rows ────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: "ban-outline",            label: "Zero ads, ever" },
  { icon: "cloud-download-outline", label: "Unlimited offline downloads" },
  { icon: "infinite-outline",       label: "Unlimited skips" },
  { icon: "headset-outline",        label: "320 kbps lossless audio" },
  { icon: "musical-notes-outline",  label: "Full lyrics & karaoke" },
];

// ─── Animated orb ────────────────────────────────────────────────────────────

function GoldOrb({ delay = 0, size = 120, style }: { delay?: number; size?: number; style?: any }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.8);

  useEffect(() => {
    opacity.value = withDelay(delay, withRepeat(
      withSequence(
        withTiming(0.6, { duration: 2200, easing: Easing.inOut(Easing.sine) }),
        withTiming(0.15, { duration: 2200, easing: Easing.inOut(Easing.sine) }),
      ),
      -1,
      true
    ));
    scale.value = withDelay(delay, withRepeat(
      withSequence(
        withTiming(1.1, { duration: 2200, easing: Easing.inOut(Easing.sine) }),
        withTiming(0.9, { duration: 2200, easing: Easing.inOut(Easing.sine) }),
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
          backgroundColor: C.gold,
          // Blur effect via box shadow approximation
          shadowColor: C.gold,
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

function ShimmerLine({ delay = 0 }: { delay?: number }) {
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
          top: 0, bottom: 0,
          width: 60,
          backgroundColor: "rgba(255,255,255,0.04)",
          transform: [{ skewX: "-20deg" }],
        },
        animStyle,
      ]}
    />
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface PremiumBannerProps {
  visible: boolean;
  onDismiss: () => void;
}

export default function PremiumBanner({ visible, onDismiss }: PremiumBannerProps) {
  const router = useRouter();

  // Entrance animations
  const backdropOpacity = useSharedValue(0);
  const cardTranslateY = useSharedValue(80);
  const cardOpacity = useSharedValue(0);
  const crownScale = useSharedValue(0.4);
  const crownRotate = useSharedValue(-15);

  // Feature stagger
  const featureOpacities = FEATURES.map(() => useSharedValue(0));
  const featureTranslates = FEATURES.map(() => useSharedValue(12));

  useEffect(() => {
    if (visible) {
      // Backdrop
      backdropOpacity.value = withTiming(1, { duration: 350 });
      // Card
      cardTranslateY.value = withDelay(100, withSpring(0, { damping: 18, stiffness: 200 }));
      cardOpacity.value = withDelay(100, withTiming(1, { duration: 300 }));
      // Crown pop
      crownScale.value = withDelay(350, withSpring(1, { damping: 10, stiffness: 260 }));
      crownRotate.value = withDelay(350, withSpring(0, { damping: 12, stiffness: 200 }));
      // Feature rows stagger
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
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.72)" }]} />
        </Pressable>
      </Animated.View>

      {/* Card container */}
      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View style={[styles.card, cardStyle]}>

          {/* Background orbs (decorative glow) */}
          <GoldOrb size={180} delay={0}  style={{ top: -60,  left: -40,  opacity: 0.18 }} />
          <GoldOrb size={120} delay={700} style={{ bottom: 20, right: -30, opacity: 0.12 }} />

          {/* Shimmer sweep */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none" overflow="hidden">
            <ShimmerLine delay={800} />
            <ShimmerLine delay={1600} />
          </View>

          {/* Top gold hairline */}
          <LinearGradient
            colors={["transparent", C.gold, C.goldShimmer, C.gold, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topLine}
          />

          {/* Close button */}
          <TouchableOpacity style={styles.closeBtn} onPress={handleDismiss} hitSlop={12}>
            <Ionicons name="close" size={16} color={C.textMuted} />
          </TouchableOpacity>

          {/* Crown icon */}
          <Animated.View style={[styles.crownWrap, crownStyle]}>
            <LinearGradient
              colors={[C.goldShimmer, C.gold, C.goldDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.crownGradient}
            >
              <Ionicons name="diamond" size={28} color="#000" />
            </LinearGradient>
            {/* Outer glow ring */}
            <View style={styles.crownRing1} />
            <View style={styles.crownRing2} />
          </Animated.View>

          {/* Headline */}
          <Text style={styles.headline}>Mavin{" "}
            <Text style={styles.headlineGold}>Premium</Text>
          </Text>
          <Text style={styles.tagline}>
            Your music. No limits. No ads.{"\n"}Everywhere you go.
          </Text>

          {/* Divider */}
          <LinearGradient
            colors={["transparent", "rgba(212,175,55,0.3)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.divider}
          />

          {/* Feature list */}
          <View style={styles.featureList}>
            {FEATURES.map((f, i) => {
              const animStyle = useAnimatedStyle(() => ({
                opacity: featureOpacities[i].value,
                transform: [{ translateY: featureTranslates[i].value }],
              }));
              return (
                <Animated.View key={f.icon} style={[styles.featureRow, animStyle]}>
                  <View style={styles.featureIconWrap}>
                    <Ionicons name={f.icon as any} size={14} color={C.gold} />
                  </View>
                  <Text style={styles.featureLabel}>{f.label}</Text>
                  <Ionicons name="checkmark-circle" size={14} color={C.gold} style={{ opacity: 0.7 }} />
                </Animated.View>
              );
            })}
          </View>

          {/* Price badge */}
          <View style={styles.priceBadge}>
            <Text style={styles.priceLabel}>From</Text>
            <Text style={styles.price}>₦1,500</Text>
            <Text style={styles.pricePeriod}>/month</Text>
          </View>

          {/* CTA button */}
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={handleUpgrade}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={[C.goldShimmer, C.gold, C.goldDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaGradient}
            >
              <Ionicons name="diamond-outline" size={16} color="#000" style={{ marginRight: 8 }} />
              <Text style={styles.ctaText}>Unlock Premium</Text>
              <Ionicons name="arrow-forward" size={14} color="#000" style={{ marginLeft: 6 }} />
            </LinearGradient>
          </TouchableOpacity>

          {/* Dismiss */}
          <TouchableOpacity onPress={handleDismiss} hitSlop={10} style={{ marginTop: 14 }}>
            <Text style={styles.laterText}>Maybe Later</Text>
          </TouchableOpacity>

          {/* Bottom gold hairline */}
          <LinearGradient
            colors={["transparent", C.gold, "transparent"]}
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
    backgroundColor: "#0A0A0A",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.25)",
    overflow: "hidden",
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 28,
    alignItems: "center",
    // Elevation
    shadowColor: C.gold,
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
    backgroundColor: "rgba(255,255,255,0.06)",
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
    borderColor: "rgba(212,175,55,0.25)",
  },
  crownRing2: {
    position: "absolute",
    width: 102,
    height: 102,
    borderRadius: 51,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.1)",
  },
  headline: {
    fontSize: 26,
    fontFamily: "Meriva",
    color: C.text,
    letterSpacing: 0.5,
    marginBottom: 8,
    textAlign: "center",
  },
  headlineGold: {
    color: C.gold,
  },
  tagline: {
    fontSize: 13,
    color: C.textSub,
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
    backgroundColor: "rgba(212,175,55,0.04)",
    marginBottom: 4,
  },
  featureIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(212,175,55,0.1)",
    borderWidth: 0.5,
    borderColor: "rgba(212,175,55,0.25)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  featureLabel: {
    flex: 1,
    fontSize: 13,
    color: C.text,
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
    backgroundColor: "rgba(212,175,55,0.08)",
    borderWidth: 0.5,
    borderColor: "rgba(212,175,55,0.2)",
  },
  priceLabel: {
    fontSize: 12,
    color: C.textSub,
  },
  price: {
    fontSize: 22,
    fontWeight: "700",
    color: C.gold,
    letterSpacing: -0.5,
  },
  pricePeriod: {
    fontSize: 12,
    color: C.textSub,
  },
  ctaBtn: {
    width: "100%",
    borderRadius: 28,
    overflow: "hidden",
    shadowColor: C.gold,
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
    color: "#000",
    letterSpacing: 0.3,
  },
  laterText: {
    fontSize: 13,
    color: C.textMuted,
    textDecorationLine: "underline",
    textDecorationColor: C.textMuted,
  },
  bottomLine: {
    height: 1,
    width: "60%",
    marginTop: 20,
  },
});