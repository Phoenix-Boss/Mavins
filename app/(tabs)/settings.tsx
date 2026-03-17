/**
 * SettingsScreen — Mavin Music Platform
 *
 * Professional streaming-platform settings page.
 * Sections: Account · Playback · Audio · Notifications · Privacy · About
 *
 * Design language: dark luxury — black base, gold accents, Meriva display font.
 * No library management. No external links. No header nav bar.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Divider } from "react-native-paper";
import * as Application from "expo-application";
import { triggerHaptic } from "@/helpers/haptics";

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:            "#000000",
  surface:       "#0D0D0D",
  surfaceRaised: "#141414",
  border:        "rgba(255,255,255,0.07)",
  borderGold:    "rgba(212,175,55,0.25)",
  gold:          "#D4AF37",
  goldShimmer:   "#E6C16A",
  goldDim:       "rgba(212,175,55,0.45)",
  text:          "#FFFFFF",
  textSub:       "#888888",
  textMuted:     "#555555",
  danger:        "#EF4444",
  success:       "#22C55E",
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type RowProps =
  | { kind: "nav";    label: string; sub?: string; icon: string; iconLib?: "ion" | "mci"; onPress: () => void; danger?: boolean }
  | { kind: "toggle"; label: string; sub?: string; icon: string; iconLib?: "ion" | "mci"; value: boolean; onToggle: (v: boolean) => void }
  | { kind: "value";  label: string; sub?: string; icon: string; iconLib?: "ion" | "mci"; value: string };

// ─────────────────────────────────────────────────────────────────────────────
// Icon helper
// ─────────────────────────────────────────────────────────────────────────────

function RowIcon({ name, lib = "ion", color }: { name: string; lib?: "ion" | "mci"; color: string }) {
  const sz = moderateScale(20);
  if (lib === "mci") {
    return <MaterialCommunityIcons name={name as any} size={sz} color={color} />;
  }
  return <Ionicons name={name as any} size={sz} color={color} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingRow
// ─────────────────────────────────────────────────────────────────────────────

function SettingRow(props: RowProps) {
  const iconColor = props.kind === "nav" && props.danger ? C.danger : C.goldShimmer;

  const left = (
    <View style={styles.rowLeft}>
      <View style={[styles.iconBox, props.kind === "nav" && props.danger && styles.iconBoxDanger]}>
        <RowIcon name={props.icon} lib={props.iconLib} color={iconColor} />
      </View>
      <View style={styles.rowTextBlock}>
        <Text style={[
          styles.rowLabel,
          props.kind === "nav" && props.danger && { color: C.danger },
        ]}>
          {props.label}
        </Text>
        {props.sub ? <Text style={styles.rowSub}>{props.sub}</Text> : null}
      </View>
    </View>
  );

  if (props.kind === "toggle") {
    return (
      <View style={styles.row}>
        {left}
        <Switch
          value={props.value}
          onValueChange={(v) => { triggerHaptic(); props.onToggle(v); }}
          trackColor={{ false: "#2A2A2A", true: C.goldDim }}
          thumbColor={props.value ? C.gold : "#555"}
          ios_backgroundColor="#2A2A2A"
        />
      </View>
    );
  }

  if (props.kind === "value") {
    return (
      <View style={styles.row}>
        {left}
        <Text style={styles.rowValue}>{props.value}</Text>
      </View>
    );
  }

  // nav
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => { triggerHaptic(); props.onPress(); }}
      activeOpacity={0.65}
    >
      {left}
      <Ionicons name="chevron-forward" size={moderateScale(16)} color={C.textMuted} />
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>
        {React.Children.map(children, (child, i) => (
          <>
            {child}
            {i < React.Children.count(children) - 1 && (
              <View style={styles.rowDivider} />
            )}
          </>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingsScreen
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { top, bottom } = useSafeAreaInsets();

  // ── Playback toggles ──────────────────────────────────────────────────────
  const [autoplay,       setAutoplay]       = useState(true);
  const [crossfade,      setCrossfade]      = useState(false);
  const [gapless,        setGapless]        = useState(true);
  const [normalize,      setNormalize]      = useState(true);

  // ── Audio toggles ─────────────────────────────────────────────────────────
  const [highQuality,    setHighQuality]    = useState(true);
  const [downloadWifi,   setDownloadWifi]   = useState(true);

  // ── Notifications toggles ─────────────────────────────────────────────────
  const [newReleases,    setNewReleases]    = useState(true);
  const [recommendations,setRecommendations]= useState(true);
  const [playlistUpdates,setPlaylistUpdates]= useState(false);

  // ── Privacy toggles ───────────────────────────────────────────────────────
  const [listenHistory,  setListenHistory]  = useState(true);
  const [analytics,      setAnalytics]      = useState(false);

  return (
    <View style={[styles.container, { paddingTop: top }]}>

      {/* ── Page title — no back button (this IS a root tab) ────────────── */}
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Settings</Text>
        <Text style={styles.pageSubtitle}>Mavin v{Application.nativeApplicationVersion}</Text>
      </View>

      <Divider style={styles.headerDivider} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Account ─────────────────────────────────────────────────────── */}
        <Section title="Account">
          <SettingRow
            kind="nav" icon="person-circle-outline"
            label="Profile"
            sub="Manage your display name and avatar"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="key-outline"
            label="Change Password"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="shield-checkmark-outline"
            label="Two-Factor Authentication"
            sub="Add an extra layer of security"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="card-outline"
            label="Subscription"
            sub="Mavin Premium · Active"
            onPress={() => {}}
          />
        </Section>

        {/* ── Playback ─────────────────────────────────────────────────────── */}
        <Section title="Playback">
          <SettingRow
            kind="toggle" icon="play-circle-outline"
            label="Autoplay"
            sub="Continue playing similar tracks when queue ends"
            value={autoplay}
            onToggle={setAutoplay}
          />
          <SettingRow
            kind="toggle" icon="git-merge-outline"
            label="Crossfade"
            sub="Smooth transition between tracks"
            value={crossfade}
            onToggle={setCrossfade}
          />
          <SettingRow
            kind="toggle" icon="infinite-outline"
            label="Gapless Playback"
            sub="Remove silence between consecutive tracks"
            value={gapless}
            onToggle={setGapless}
          />
          <SettingRow
            kind="toggle" icon="stats-chart-outline"
            label="Volume Normalisation"
            sub="Keep all tracks at a consistent loudness"
            value={normalize}
            onToggle={setNormalize}
          />
          <SettingRow
            kind="nav" icon="repeat-outline"
            label="Default Repeat Mode"
            sub="Off"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="speedometer-outline" iconLib="mci"
            label="Playback Speed"
            sub="1×"
            onPress={() => {}}
          />
        </Section>

        {/* ── Audio Quality ─────────────────────────────────────────────────── */}
        <Section title="Audio Quality">
          <SettingRow
            kind="toggle" icon="musical-notes-outline"
            label="High Quality Streaming"
            sub="320 kbps · Uses more data"
            value={highQuality}
            onToggle={setHighQuality}
          />
          <SettingRow
            kind="nav" icon="wifi-outline"
            label="Streaming Quality"
            sub="Automatic"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="save-outline"
            label="Download Quality"
            sub="High · 256 kbps"
            onPress={() => {}}
          />
          <SettingRow
            kind="toggle" icon="cloud-download-outline"
            label="Download on Wi-Fi Only"
            sub="Prevent mobile data usage for downloads"
            value={downloadWifi}
            onToggle={setDownloadWifi}
          />
          <SettingRow
            kind="nav" icon="equalizer-outline" iconLib="mci"
            label="Equalizer"
            sub="Customise your sound profile"
            onPress={() => {}}
          />
        </Section>

        {/* ── Notifications ─────────────────────────────────────────────────── */}
        <Section title="Notifications">
          <SettingRow
            kind="toggle" icon="notifications-outline"
            label="New Releases"
            sub="Artists and labels you follow"
            value={newReleases}
            onToggle={setNewReleases}
          />
          <SettingRow
            kind="toggle" icon="radio-outline"
            label="Recommendations"
            sub="Personalised picks based on your taste"
            value={recommendations}
            onToggle={setRecommendations}
          />
          <SettingRow
            kind="toggle" icon="list-outline"
            label="Playlist Updates"
            sub="When collaborative playlists change"
            value={playlistUpdates}
            onToggle={setPlaylistUpdates}
          />
        </Section>

        {/* ── Privacy ───────────────────────────────────────────────────────── */}
        <Section title="Privacy">
          <SettingRow
            kind="toggle" icon="time-outline"
            label="Listening History"
            sub="Used to power your recommendations"
            value={listenHistory}
            onToggle={setListenHistory}
          />
          <SettingRow
            kind="toggle" icon="bar-chart-outline"
            label="Usage Analytics"
            sub="Help improve Mavin by sharing anonymous data"
            value={analytics}
            onToggle={setAnalytics}
          />
          <SettingRow
            kind="nav" icon="document-text-outline"
            label="Privacy Policy"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="reader-outline"
            label="Terms of Service"
            onPress={() => {}}
          />
        </Section>

        {/* ── Appearance ────────────────────────────────────────────────────── */}
        <Section title="Appearance">
          <SettingRow
            kind="nav" icon="color-palette-outline"
            label="Theme"
            sub="Dark"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="language-outline"
            label="Language"
            sub="English"
            onPress={() => {}}
          />
        </Section>

        {/* ── Storage ───────────────────────────────────────────────────────── */}
        <Section title="Storage">
          <SettingRow
            kind="nav" icon="folder-outline"
            label="Downloads"
            sub="Manage offline tracks and storage"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="trash-outline"
            label="Clear Cache"
            sub="Free up temporary files"
            onPress={() => {}}
          />
        </Section>

        {/* ── About ─────────────────────────────────────────────────────────── */}
        <Section title="About">
          <SettingRow
            kind="value" icon="information-circle-outline"
            label="Version"
            value={`${Application.nativeApplicationVersion} (${Application.nativeBuildVersion})`}
          />
          <SettingRow
            kind="nav" icon="star-outline"
            label="Rate Mavin"
            sub="Enjoying the app? Leave us a review"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="help-circle-outline"
            label="Help & Support"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="chatbubble-ellipses-outline"
            label="Send Feedback"
            onPress={() => {}}
          />
        </Section>

        {/* ── Danger zone ───────────────────────────────────────────────────── */}
        <Section title="Account Actions">
          <SettingRow
            kind="nav" icon="log-out-outline"
            label="Sign Out"
            onPress={() => {}}
          />
          <SettingRow
            kind="nav" icon="person-remove-outline"
            label="Delete Account"
            sub="Permanently remove your account and all data"
            onPress={() => {}}
            danger
          />
        </Section>

      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = ScaledSheet.create({
  container: {
    flex:            1,
    backgroundColor: C.bg,
  },

  // ── Page header ────────────────────────────────────────────────────────
  pageHeader: {
    paddingHorizontal: "20@s",
    paddingTop:        "8@vs",
    paddingBottom:     "14@vs",
    flexDirection:     "row",
    alignItems:        "baseline",
    justifyContent:    "space-between",
  },
  pageTitle: {
    fontSize:   "28@ms",
    fontFamily: "Meriva",
    color:      C.text,
    letterSpacing: 0.5,
  },
  pageSubtitle: {
    fontSize:  "12@ms",
    color:     C.textMuted,
    letterSpacing: 0.4,
  },
  headerDivider: {
    backgroundColor: C.borderGold,
    height:          0.5,
    marginHorizontal: "20@s",
    marginBottom:    "6@vs",
  },

  // ── Scroll ────────────────────────────────────────────────────────────
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: "16@s",
    paddingTop:        "8@vs",
  },

  // ── Section ───────────────────────────────────────────────────────────
  section: {
    marginBottom: "24@vs",
  },
  sectionTitle: {
    fontSize:      "11@ms",
    fontWeight:    "700",
    color:         C.gold,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom:  "10@vs",
    marginLeft:    "4@s",
  },
  sectionCard: {
    backgroundColor: C.surface,
    borderRadius:    "14@ms",
    borderWidth:     0.5,
    borderColor:     C.border,
    overflow:        "hidden",
  },

  // ── Row ───────────────────────────────────────────────────────────────
  row: {
    flexDirection:  "row",
    alignItems:     "center",
    paddingVertical:   "13@vs",
    paddingHorizontal: "14@s",
    minHeight:         "52@vs",
  },
  rowDivider: {
    height:          0.5,
    backgroundColor: C.border,
    marginLeft:      "52@s",
  },
  rowLeft: {
    flex:        1,
    flexDirection: "row",
    alignItems:    "center",
  },
  iconBox: {
    width:           "34@ms",
    height:          "34@ms",
    borderRadius:    "9@ms",
    backgroundColor: "rgba(212,175,55,0.1)",
    alignItems:      "center",
    justifyContent:  "center",
    marginRight:     "12@s",
  },
  iconBoxDanger: {
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  rowTextBlock: {
    flex: 1,
  },
  rowLabel: {
    fontSize:  "15@ms",
    color:     C.text,
    fontWeight: "500",
  },
  rowSub: {
    fontSize:  "12@ms",
    color:     C.textSub,
    marginTop: "2@vs",
    lineHeight: "16@ms",
  },
  rowValue: {
    fontSize:      "13@ms",
    color:         C.textSub,
    letterSpacing: 0.2,
  },
});