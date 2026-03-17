/**
 * (modals)/premium.tsx — Mavin Premium upsell sheet
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/helpers/haptics";

const C = {
  bg: "#0D0D0D",
  surface: "#161616",
  border: "rgba(255,255,255,0.07)",
  borderGold: "rgba(212,175,55,0.22)",
  gold: "#D4AF37",
  goldShimmer: "#E6C16A",
  goldFill: "rgba(212,175,55,0.1)",
  text: "#FFFFFF",
  textSub: "#888888",
  textMuted: "#4A4A4A",
};

const FEATURES = [
  { icon: "infinite-outline",       label: "Unlimited skips" },
  { icon: "cloud-download-outline", label: "Offline downloads" },
  { icon: "ban-outline",            label: "Ad-free listening" },
  { icon: "headset-outline",        label: "High-quality audio (320 kbps)" },
  { icon: "musical-notes-outline",  label: "Full lyrics & karaoke mode" },
  { icon: "people-outline",         label: "Share playlists with friends" },
];

const PLANS = [
  { id: "monthly", label: "Monthly", price: "₦1,500", period: "/mo", highlight: false },
  { id: "annual",  label: "Annual",  price: "₦12,000", period: "/yr", highlight: true, badge: "Save 33%" },
];

export default function PremiumModal() {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();

  const [selected, setSelected] = React.useState("annual");

  const handleSubscribe = () => {
    triggerHaptic();
    // TODO: initiate payment flow (Paystack, RevenueCat, etc.)
    router.back();
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom + 16 }]}>
      {/* Handle */}
      <View style={styles.handle} />

      {/* Close */}
      <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} hitSlop={10}>
        <Ionicons name="close" size={18} color={C.textSub} />
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Crown icon */}
        <View style={styles.crownWrap}>
          <Ionicons name="diamond-outline" size={36} color={C.gold} />
        </View>

        <Text style={styles.headline}>Mavin Premium</Text>
        <Text style={styles.tagline}>Unlock the full music experience</Text>

        <View style={styles.divider} />

        {/* Feature list */}
        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.icon} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon as any} size={16} color={C.gold} />
              </View>
              <Text style={styles.featureLabel}>{f.label}</Text>
            </View>
          ))}
        </View>

        {/* Plan selector */}
        <View style={styles.plans}>
          {PLANS.map((plan) => (
            <TouchableOpacity
              key={plan.id}
              style={[styles.planCard, selected === plan.id && styles.planCardActive]}
              onPress={() => { triggerHaptic(); setSelected(plan.id); }}
              activeOpacity={0.8}
            >
              {plan.badge && (
                <View style={styles.planBadge}>
                  <Text style={styles.planBadgeText}>{plan.badge}</Text>
                </View>
              )}
              <Text style={[styles.planLabel, selected === plan.id && styles.planLabelActive]}>
                {plan.label}
              </Text>
              <Text style={[styles.planPrice, selected === plan.id && styles.planPriceActive]}>
                {plan.price}
              </Text>
              <Text style={styles.planPeriod}>{plan.period}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity style={styles.cta} onPress={handleSubscribe} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Start Premium</Text>
        </TouchableOpacity>

        <Text style={styles.legal}>
          Auto-renews. Cancel anytime. By subscribing you agree to our Terms of Service.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: {
    alignSelf: "center", width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)", marginTop: 10, marginBottom: 8,
  },
  closeBtn: {
    position: "absolute", top: 14, right: 16,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.surface, alignItems: "center", justifyContent: "center",
    zIndex: 10,
  },
  scroll: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, alignItems: "center" },
  crownWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.goldFill, borderWidth: 1, borderColor: C.borderGold,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  headline: { fontSize: 24, fontWeight: "700", color: C.text, marginBottom: 6 },
  tagline: { fontSize: 14, color: C.textSub, marginBottom: 20 },
  divider: { height: 0.5, backgroundColor: C.borderGold, width: "100%", marginBottom: 20 },
  featureList: { width: "100%", marginBottom: 24 },
  featureRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  featureIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: C.goldFill, borderWidth: 0.5, borderColor: C.borderGold,
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  featureLabel: { fontSize: 14, color: C.text, fontWeight: "500" },
  plans: { flexDirection: "row", gap: 12, width: "100%", marginBottom: 24 },
  planCard: {
    flex: 1, alignItems: "center", paddingVertical: 16,
    borderRadius: 14, backgroundColor: C.surface,
    borderWidth: 0.5, borderColor: C.border,
  },
  planCardActive: { borderColor: C.gold, backgroundColor: C.goldFill },
  planBadge: {
    backgroundColor: C.gold, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, marginBottom: 6,
  },
  planBadgeText: { fontSize: 10, color: "#000", fontWeight: "700" },
  planLabel: { fontSize: 13, fontWeight: "600", color: C.textSub, marginBottom: 4 },
  planLabelActive: { color: C.text },
  planPrice: { fontSize: 20, fontWeight: "700", color: C.textSub },
  planPriceActive: { color: C.gold },
  planPeriod: { fontSize: 11, color: C.textMuted },
  cta: {
    width: "100%", paddingVertical: 16, borderRadius: 28,
    backgroundColor: C.gold, alignItems: "center",
    shadowColor: C.gold, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 12, elevation: 8,
    marginBottom: 16,
  },
  ctaText: { fontSize: 16, fontWeight: "700", color: "#000" },
  legal: { fontSize: 11, color: C.textMuted, textAlign: "center", lineHeight: 16 },
});