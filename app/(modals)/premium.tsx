/**
 * (modals)/premium.tsx — Mavin Premium upsell sheet
 */

import React, { useState } from "react";
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
import { useTheme } from "@/contexts/ThemeContext";

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
  const { colors } = useTheme();
  const [selected, setSelected] = useState("annual");

  const handleSubscribe = () => {
    triggerHaptic();
    router.back();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: bottom + 16 }]}>
      <View style={[styles.handle, { backgroundColor: colors.textMuted }]} />

      <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.surface }]} onPress={() => router.back()} hitSlop={10}>
        <Ionicons name="close" size={18} color={colors.textSub} />
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.crownWrap, { backgroundColor: `${colors.gold}15`, borderColor: `${colors.gold}40` }]}>
          <Ionicons name="diamond-outline" size={36} color={colors.gold} />
        </View>

        <Text style={[styles.headline, { color: colors.text }]}>Mavin <Text style={{ color: colors.gold }}>Premium</Text></Text>
        <Text style={[styles.tagline, { color: colors.textSub }]}>Unlock the full music experience</Text>

        <View style={[styles.divider, { backgroundColor: colors.borderGold }]} />

        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.icon} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: `${colors.gold}15`, borderColor: `${colors.gold}40` }]}>
                <Ionicons name={f.icon as any} size={16} color={colors.gold} />
              </View>
              <Text style={[styles.featureLabel, { color: colors.text }]}>{f.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.plans}>
          {PLANS.map((plan) => (
            <TouchableOpacity
              key={plan.id}
              style={[styles.planCard, { backgroundColor: colors.surface, borderColor: colors.border }, selected === plan.id && { borderColor: colors.gold, backgroundColor: `${colors.gold}15` }]}
              onPress={() => { triggerHaptic(); setSelected(plan.id); }}
              activeOpacity={0.8}
            >
              {plan.badge && (
                <View style={[styles.planBadge, { backgroundColor: colors.gold }]}>
                  <Text style={styles.planBadgeText}>{plan.badge}</Text>
                </View>
              )}
              <Text style={[styles.planLabel, { color: colors.textSub }, selected === plan.id && { color: colors.text }]}>
                {plan.label}
              </Text>
              <Text style={[styles.planPrice, { color: colors.textSub }, selected === plan.id && { color: colors.gold }]}>
                {plan.price}
              </Text>
              <Text style={[styles.planPeriod, { color: colors.textMuted }]}>{plan.period}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={[styles.cta, { backgroundColor: colors.gold, shadowColor: colors.gold }]} onPress={handleSubscribe} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Start Premium</Text>
        </TouchableOpacity>

        <Text style={[styles.legal, { color: colors.textMuted }]}>
          Auto-renews. Cancel anytime. By subscribing you agree to our Terms of Service.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 10, marginBottom: 8 },
  closeBtn: { position: "absolute", top: 14, right: 16, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", zIndex: 10 },
  scroll: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, alignItems: "center" },
  crownWrap: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  headline: { fontSize: 24, fontWeight: "700", marginBottom: 6 },
  tagline: { fontSize: 14, marginBottom: 20 },
  divider: { height: 0.5, width: "100%", marginBottom: 20 },
  featureList: { width: "100%", marginBottom: 24 },
  featureRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  featureIcon: { width: 32, height: 32, borderRadius: 8, borderWidth: 0.5, alignItems: "center", justifyContent: "center", marginRight: 12 },
  featureLabel: { fontSize: 14, fontWeight: "500" },
  plans: { flexDirection: "row", gap: 12, width: "100%", marginBottom: 24 },
  planCard: { flex: 1, alignItems: "center", paddingVertical: 16, borderRadius: 14, borderWidth: 0.5 },
  planBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 6 },
  planBadgeText: { fontSize: 10, color: "#000", fontWeight: "700" },
  planLabel: { fontSize: 13, fontWeight: "600", marginBottom: 4 },
  planPrice: { fontSize: 20, fontWeight: "700" },
  planPeriod: { fontSize: 11 },
  cta: { width: "100%", paddingVertical: 16, borderRadius: 28, alignItems: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.45, shadowRadius: 12, elevation: 8, marginBottom: 16 },
  ctaText: { fontSize: 16, fontWeight: "700", color: "#000" },
  legal: { fontSize: 11, textAlign: "center", lineHeight: 16 },
});
