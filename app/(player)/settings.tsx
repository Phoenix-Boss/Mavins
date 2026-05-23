/**
 * SettingsScreen — Mavin Music Platform
 *
 * Professional streaming-platform settings page.
 * Sections: Account · Playback · Audio Quality · Notifications · Privacy · Appearance · Storage · About · Account Actions
 *
 * Privacy section contains two subsections rendered as separate Section cards:
 *   Privacy          — listening history, analytics, policy links
 *   Security         — two-factor auth, change password, bandwidth sharing opt-out
 *
 * Design language: dark luxury — black base, gold accents, Meriva display font.
 * Supports light/dark mode via ThemeContext.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Divider } from "react-native-paper";
import * as Application from "expo-application";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { useTheme, type ThemeMode } from "@/contexts/ThemeContext";
import { cache } from "@/libs/cache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { optOut, getStatus } from "@/modules/pawns";
import { CONSENT_STORAGE_KEY, CONSENT_SUPPRESS_KEY } from "@/components/EarningsConsentGate";

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
  const { colors } = useTheme();
  const iconColor = props.kind === "nav" && props.danger ? colors.error : colors.gold;

  const left = (
    <View style={[styles.rowLeft, { gap: moderateScale(12) }]}>
      <View style={[
        styles.iconBox,
        { backgroundColor: `${colors.gold}15` },
        props.kind === "nav" && props.danger && { backgroundColor: `${colors.error}20` }
      ]}>
        <RowIcon name={props.icon} lib={props.iconLib} color={iconColor} />
      </View>
      <View style={styles.rowTextBlock}>
        <Text style={[
          styles.rowLabel,
          { color: colors.text },
          props.kind === "nav" && props.danger && { color: colors.error },
        ]}>
          {props.label}
        </Text>
        {props.sub ? <Text style={[styles.rowSub, { color: colors.textSub }]}>{props.sub}</Text> : null}
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
          trackColor={{ false: colors.surfaceHigh, true: colors.goldDim }}
          thumbColor={props.value ? colors.gold : colors.textMuted}
        />
      </View>
    );
  }

  if (props.kind === "value") {
    return (
      <View style={styles.row}>
        {left}
        <Text style={[styles.rowValue, { color: colors.textSub }]}>{props.value}</Text>
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
      <Ionicons name="chevron-forward" size={moderateScale(16)} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.gold }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {React.Children.map(children, (child, i) => (
          <React.Fragment key={i}>
            {child}
            {i < React.Children.count(children) - 1 && (
              <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />
            )}
          </React.Fragment>
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
  const router = useRouter();
  const { mode, setMode, colors, isDark } = useTheme();

  // ── Playback toggles ──────────────────────────────────────────────────────
  const [autoplay,        setAutoplay]        = useState(true);
  const [crossfade,       setCrossfade]       = useState(false);
  const [gapless,         setGapless]         = useState(true);
  const [normalize,       setNormalize]       = useState(true);

  // ── Audio toggles ─────────────────────────────────────────────────────────
  const [highQuality,     setHighQuality]     = useState(true);
  const [downloadWifi,    setDownloadWifi]    = useState(true);

  // ── Notifications toggles ─────────────────────────────────────────────────
  const [newReleases,     setNewReleases]     = useState(true);
  const [recommendations, setRecommendations] = useState(true);
  const [playlistUpdates, setPlaylistUpdates] = useState(false);

  // ── Privacy toggles ───────────────────────────────────────────────────────
  const [listenHistory,   setListenHistory]   = useState(true);
  const [analytics,       setAnalytics]       = useState(false);

  // ── Bandwidth sharing state ───────────────────────────────────────────────
  const [sharingActive,   setSharingActive]   = useState(false);

  // Reflect live SDK state on mount
  useEffect(() => {
    getStatus()
      .then(s => setSharingActive(s.isRunning && s.isConsentGiven))
      .catch(() => setSharingActive(false));
  }, []);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const getThemeDisplayName = (): string => {
    if (mode === 'light') return 'Light';
    if (mode === 'dark')  return 'Dark';
    return 'System';
  };

  const handleClearCache = async () => {
    triggerHaptic();
    Alert.alert(
      "Clear Cache",
      "This will remove temporary files and free up storage space. Your downloads and settings will not be affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            try {
              await cache.clear();
              Alert.alert("Success", "Cache cleared successfully.");
            } catch {
              Alert.alert("Error", "Failed to clear cache.");
            }
          },
        },
      ]
    );
  };

  const handleSignOut = () => {
    triggerHaptic();
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: () => {
            // TODO: Implement sign out logic
            Alert.alert("Signed Out", "You have been signed out.");
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    triggerHaptic();
    Alert.alert(
      "Delete Account",
      "This action is permanent and cannot be undone. All your data will be lost.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            // TODO: Implement account deletion
            Alert.alert("Account Deleted", "Your account has been scheduled for deletion.");
          },
        },
      ]
    );
  };

  const handleThemePress = () => {
    triggerHaptic();
    Alert.alert(
      "Theme",
      "Choose your preferred appearance",
      [
        { text: "Light",  onPress: () => setMode("light") },
        { text: "Dark",   onPress: () => setMode("dark") },
        { text: "System", onPress: () => setMode("system") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handleLanguagePress = () => {
    triggerHaptic();
    Alert.alert(
      "Language",
      "Choose your preferred language",
      [
        { text: "English", onPress: () => {} },
        { text: "French",  onPress: () => {} },
        { text: "Spanish", onPress: () => {} },
        { text: "Cancel",  style: "cancel" },
      ]
    );
  };

  const handleEqualizerPress = () => {
    triggerHaptic();
    router.push('/(modals)/equalizer');
  };

  const handleDownloadsPress = () => {
    triggerHaptic();
    router.push('/(player)/library/downloads');
  };

  const handleProfilePress = () => {
    triggerHaptic();
    router.push('/(player)/profile');
  };

  const handleSubscriptionPress = () => {
    triggerHaptic();
    router.push('/(modals)/subscription');
  };

  const handleRatePress = () => {
    triggerHaptic();
    Alert.alert("Rate Mavin", "Thank you for your feedback!");
  };

  const handleHelpPress = () => {
    triggerHaptic();
    router.push('/(modals)/help');
  };

  const handleFeedbackPress = () => {
    triggerHaptic();
    router.push('/(modals)/feedback');
  };

  const handlePrivacyPress = () => {
    triggerHaptic();
    router.push('/(modals)/privacy');
  };

  const handleTermsPress = () => {
    triggerHaptic();
    router.push('/(modals)/terms');
  };

  const handleChangePassword = () => {
    triggerHaptic();
    router.push('/(modals)/change-password');
  };

  const handleTwoFactorPress = () => {
    triggerHaptic();
    router.push('/(modals)/two-factor');
  };

  const handleDefaultRepeatPress = () => {
    triggerHaptic();
    Alert.alert(
      "Default Repeat Mode",
      "Choose your default repeat behavior",
      [
        { text: "Off",    onPress: () => {} },
        { text: "All",    onPress: () => {} },
        { text: "One",    onPress: () => {} },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handlePlaybackSpeedPress = () => {
    triggerHaptic();
    Alert.alert(
      "Playback Speed",
      "Choose your default playback speed",
      [
        { text: "0.5×",   onPress: () => {} },
        { text: "0.75×",  onPress: () => {} },
        { text: "1×",     onPress: () => {} },
        { text: "1.25×",  onPress: () => {} },
        { text: "1.5×",   onPress: () => {} },
        { text: "2×",     onPress: () => {} },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handleStreamingQualityPress = () => {
    triggerHaptic();
    Alert.alert(
      "Streaming Quality",
      "Choose your preferred streaming quality",
      [
        { text: "Low (96 kbps)",       onPress: () => {} },
        { text: "Medium (160 kbps)",   onPress: () => {} },
        { text: "High (320 kbps)",     onPress: () => {} },
        { text: "Very High (lossless)",onPress: () => {} },
        { text: "Cancel",              style: "cancel" },
      ]
    );
  };

  const handleDownloadQualityPress = () => {
    triggerHaptic();
    Alert.alert(
      "Download Quality",
      "Choose download quality for offline listening",
      [
        { text: "Low (96 kbps)",    onPress: () => {} },
        { text: "Medium (160 kbps)",onPress: () => {} },
        { text: "High (320 kbps)", onPress: () => {} },
        { text: "Cancel",           style: "cancel" },
      ]
    );
  };

  // ── Bandwidth sharing: disable & withdraw consent ─────────────────────────
  const handleDisableSharing = useCallback(() => {
    triggerHaptic();

    if (!sharingActive) {
      // Not currently active — offer to re-trigger the consent modal
      Alert.alert(
        "Bandwidth Sharing",
        "Bandwidth sharing is not currently enabled. Would you like to enable it?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Enable",
            onPress: () => router.push('/(modals)/earnings-consent'),
          },
        ]
      );
      return;
    }

    Alert.alert(
      "Disable Bandwidth Sharing",
      "This will stop the background sharing service immediately and withdraw your consent. " +
      "You can re-enable it at any time from this screen.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disable & Withdraw",
          style: "destructive",
          onPress: async () => {
            try {
              // Call optOut() from the pawns SDK — stops the service and revokes consent
              await optOut();
              // Clear stored consent so the modal can be triggered again later
              await AsyncStorage.multiRemove([CONSENT_STORAGE_KEY, CONSENT_SUPPRESS_KEY]);
              setSharingActive(false);
              Alert.alert(
                "Sharing Disabled",
                "Bandwidth sharing has been stopped and your consent has been withdrawn."
              );
            } catch (err) {
              console.error('[Settings] optOut failed:', err);
              Alert.alert("Error", "Failed to disable sharing. Please try again.");
            }
          },
        },
      ]
    );
  }, [sharingActive, router]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: top }]}>

      {/* ── Page title ──────────────────────────────────────────────────────── */}
      <View style={styles.pageHeader}>
        <Text style={[styles.pageTitle, { color: colors.text }]}>Settings</Text>
        <Text style={[styles.pageSubtitle, { color: colors.textMuted }]}>
          Mavin v{Application.nativeApplicationVersion}
        </Text>
      </View>

      <Divider style={[styles.headerDivider, { backgroundColor: colors.borderGold }]} />

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
            onPress={handleProfilePress}
          />
          <SettingRow
            kind="nav" icon="key-outline"
            label="Change Password"
            onPress={handleChangePassword}
          />
          <SettingRow
            kind="nav" icon="card-outline"
            label="Subscription"
            sub="Mavin Premium · Active"
            onPress={handleSubscriptionPress}
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
            onPress={handleDefaultRepeatPress}
          />
          <SettingRow
            kind="nav" icon="speedometer-outline" iconLib="mci"
            label="Playback Speed"
            sub="1×"
            onPress={handlePlaybackSpeedPress}
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
            onPress={handleStreamingQualityPress}
          />
          <SettingRow
            kind="nav" icon="save-outline"
            label="Download Quality"
            sub="High · 256 kbps"
            onPress={handleDownloadQualityPress}
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
            onPress={handleEqualizerPress}
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
            onPress={handlePrivacyPress}
          />
          <SettingRow
            kind="nav" icon="reader-outline"
            label="Terms of Service"
            onPress={handleTermsPress}
          />
        </Section>

        {/* ── Security (inside Privacy grouping) ───────────────────────────── */}
        <Section title="Security">
          <SettingRow
            kind="nav" icon="shield-checkmark-outline"
            label="Two-Factor Authentication"
            sub="Add an extra layer of security to your account"
            onPress={handleTwoFactorPress}
          />
          <SettingRow
            kind="nav"
            icon={sharingActive ? "wifi-outline" : "wifi-outline"}
            iconLib="ion"
            label={sharingActive ? "Disable Bandwidth Sharing" : "Enable Bandwidth Sharing"}
            sub={
              sharingActive
                ? "Sharing is active · tap to stop and withdraw consent"
                : "Bandwidth sharing is off · tap to enable"
            }
            onPress={handleDisableSharing}
            danger={sharingActive}
          />
        </Section>

        {/* ── Appearance ────────────────────────────────────────────────────── */}
        <Section title="Appearance">
          <SettingRow
            kind="nav" icon="color-palette-outline"
            label="Theme"
            sub={getThemeDisplayName()}
            onPress={handleThemePress}
          />
          <SettingRow
            kind="nav" icon="language-outline"
            label="Language"
            sub="English"
            onPress={handleLanguagePress}
          />
        </Section>

        {/* ── Storage ───────────────────────────────────────────────────────── */}
        <Section title="Storage">
          <SettingRow
            kind="nav" icon="folder-outline"
            label="Downloads"
            sub="Manage offline tracks and storage"
            onPress={handleDownloadsPress}
          />
          <SettingRow
            kind="nav" icon="trash-outline"
            label="Clear Cache"
            sub="Free up temporary files"
            onPress={handleClearCache}
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
            onPress={handleRatePress}
          />
          <SettingRow
            kind="nav" icon="help-circle-outline"
            label="Help & Support"
            onPress={handleHelpPress}
          />
          <SettingRow
            kind="nav" icon="chatbubble-ellipses-outline"
            label="Send Feedback"
            onPress={handleFeedbackPress}
          />
        </Section>

        {/* ── Account Actions ───────────────────────────────────────────────── */}
        <Section title="Account Actions">
          <SettingRow
            kind="nav" icon="log-out-outline"
            label="Sign Out"
            onPress={handleSignOut}
          />
          <SettingRow
            kind="nav" icon="person-remove-outline"
            label="Delete Account"
            sub="Permanently remove your account and all data"
            onPress={handleDeleteAccount}
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
    flex: 1,
  },

  // ── Page header
  pageHeader: {
    paddingHorizontal: "20@s",
    paddingTop:        "8@vs",
    paddingBottom:     "14@vs",
    flexDirection:     "row",
    alignItems:        "baseline",
    justifyContent:    "space-between",
  },
  pageTitle: {
    fontSize:      "28@ms",
    fontFamily:    "Meriva",
    letterSpacing: 0.5,
  },
  pageSubtitle: {
    fontSize:      "12@ms",
    letterSpacing: 0.4,
  },
  headerDivider: {
    height:           0.5,
    marginHorizontal: "20@s",
    marginBottom:     "6@vs",
  },

  // ── Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: "16@s",
    paddingTop:        "8@vs",
  },

  // ── Section
  section: {
    marginBottom: "24@vs",
  },
  sectionTitle: {
    fontSize:      "11@ms",
    fontWeight:    "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom:  "10@vs",
    marginLeft:    "4@s",
  },
  sectionCard: {
    borderRadius: "14@ms",
    borderWidth:  0.5,
    overflow:     "hidden",
  },

  // ── Row
  row: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    paddingVertical:   "13@vs",
    paddingHorizontal: "14@s",
    minHeight:         "52@vs",
  },
  rowDivider: {
    height:     0.5,
    marginLeft: "52@s",
  },
  rowLeft: {
    flex:          1,
    flexDirection: "row",
    alignItems:    "center",
  },
  iconBox: {
    width:          "34@ms",
    height:         "34@ms",
    borderRadius:   "9@ms",
    alignItems:     "center",
    justifyContent: "center",
  },
  rowTextBlock: {
    flex: 1,
  },
  rowLabel: {
    fontSize:   "15@ms",
    fontWeight: "500",
  },
  rowSub: {
    fontSize:   "12@ms",
    marginTop:  "2@vs",
    lineHeight: "16@ms",
  },
  rowValue: {
    fontSize:      "13@ms",
    letterSpacing: 0.2,
  },
});