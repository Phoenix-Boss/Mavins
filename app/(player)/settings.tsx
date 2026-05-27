// app/(player)/settings/index.tsx
//
// SettingsScreen — Mavin Music Platform
//
// Professional streaming-platform settings page.
// Sections: Account · Playback · Audio Quality · Notifications · Privacy · Appearance · Storage · About · Account Actions
//
// Privacy section contains accordion dropdowns (all closed by default):
//   - Privacy Settings (listening history, analytics, policy links)
//   - Security (two-factor auth, change password)
//   - Data Protection (encryption, data rights)
//   - Data Sharing (bandwidth sharing toggle only - ON by default in UI)
//
// Design language: dark luxury — black base, gold accents, Meriva display font.
// Supports light/dark mode via ThemeContext.

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScaledSheet, moderateScale } from "react-native-size-matters/extend";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Divider } from "react-native-paper";
import * as Application from "expo-application";
import { triggerHaptic } from "@/helpers/haptics";
import { useTheme } from "@/contexts/ThemeContext";
import { useAlert } from "@/contexts/AlertContext";
import { cache } from "@/libs/cache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { optOut, getStatus, initialize, optIn, start } from "@/modules/pawns";
import { CONSENT_STORAGE_KEY, CONSENT_SUPPRESS_KEY } from "@/components/EarningsConsentGate";

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type RowProps =
  | { kind: "nav";    label: string; sub?: string; icon: string; iconLib?: "ion" | "mci"; onPress: () => void; danger?: boolean }
  | { kind: "toggle"; label: string; sub?: string; icon: string; iconLib?: "ion" | "mci"; value: boolean; onToggle: (v: boolean) => void }
  | { kind: "value";  label: string; sub?: string; icon: string; iconLib?: "ion" | "mci"; value: string };

// Accordion Section Props
interface AccordionSectionProps {
  title: string;
  icon: string;
  iconLib?: "ion" | "mci";
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  colors: any;
}

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
// Accordion Section Component
// ─────────────────────────────────────────────────────────────────────────────

function AccordionSection({ title, icon, iconLib = "ion", expanded, onToggle, children, colors }: AccordionSectionProps) {
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [expanded]);

  return (
    <View style={[styles.accordionSection, { borderBottomColor: colors.border }]}>
      <TouchableOpacity
        style={styles.accordionHeader}
        onPress={() => { triggerHaptic(); onToggle(); }}
        activeOpacity={0.7}
      >
        <View style={styles.accordionHeaderLeft}>
          <View style={[styles.iconBox, { backgroundColor: `${colors.gold}15` }]}>
            <RowIcon name={icon} lib={iconLib} color={colors.gold} />
          </View>
          <Text style={[styles.accordionTitle, { color: colors.text }]}>{title}</Text>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={moderateScale(20)}
          color={colors.textMuted}
        />
      </TouchableOpacity>
      {expanded && (
        <View style={styles.accordionContent}>
          {children}
        </View>
      )}
    </View>
  );
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
        styles.iconBoxSmall,
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
      <View style={styles.rowInner}>
        {left}
        <Switch
          value={props.value}
          onValueChange={(v) => { triggerHaptic(); props.onToggle(v); }}
          trackColor={{ false: colors.surfaceHigh, true: `${colors.gold}66` }}
          thumbColor={props.value ? colors.gold : colors.textMuted}
        />
      </View>
    );
  }

  if (props.kind === "value") {
    return (
      <View style={styles.rowInner}>
        {left}
        <Text style={[styles.rowValue, { color: colors.textSub }]}>{props.value}</Text>
      </View>
    );
  }

  // nav
  return (
    <TouchableOpacity
      style={styles.rowInner}
      onPress={() => { triggerHaptic(); props.onPress(); }}
      activeOpacity={0.65}
    >
      {left}
      <Ionicons name="chevron-forward" size={moderateScale(16)} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Regular Section (non-accordion)
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
  const params = useLocalSearchParams<{ scrollTo?: string }>();
  const { mode, setMode, colors, isDark } = useTheme();
  const { showAlert, showDestructiveAlert } = useAlert();
  const scrollViewRef = useRef<ScrollView>(null);
  const privacyMainSectionRef = useRef<View>(null);

  // ── Accordion expanded states - ALL CLOSED by default ──────────────────────
  const [privacySettingsExpanded, setPrivacySettingsExpanded] = useState(false);
  const [securityExpanded, setSecurityExpanded] = useState(false);
  const [dataProtectionExpanded, setDataProtectionExpanded] = useState(false);
  const [dataSharingExpanded, setDataSharingExpanded] = useState(false);

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

  // ── Bandwidth sharing state - UI toggle starts ON by default ──────────────
  const [uiToggleOn, setUiToggleOn] = useState(true);
  const [isToggling, setIsToggling] = useState(false);

  // Check actual consent status on mount
  useEffect(() => {
    const checkConsentStatus = async () => {
      try {
        const consentGiven = await AsyncStorage.getItem(CONSENT_STORAGE_KEY);
        if (consentGiven === 'accepted') {
          const status = await getStatus();
          setUiToggleOn(status.isRunning && status.isConsentGiven);
        } else {
          setUiToggleOn(true);
        }
      } catch (err) {
        console.warn('[Settings] Failed to check consent status:', err);
        setUiToggleOn(true);
      }
    };
    
    checkConsentStatus();
  }, []);

  // Scroll to Data Sharing accordion when coming from consent modal
  useEffect(() => {
    if (params.scrollTo === 'privacy') {
      setDataSharingExpanded(true);
      setTimeout(() => {
        privacyMainSectionRef.current?.measureLayout(
          scrollViewRef.current as any,
          (x, y) => {
            scrollViewRef.current?.scrollTo({ y: y - 80, animated: true });
          },
          () => {}
        );
      }, 300);
    }
  }, [params.scrollTo]);

  // ─── Bandwidth sharing toggle handler ─────────────────────────────────────
  // FIXED: ALWAYS show destructive alert when turning OFF, regardless of consent status
  const handleBandwidthSharingToggle = useCallback(async (value: boolean) => {
    triggerHaptic();
    
    if (value) {
      // Turning ON - activate immediately
      if (isToggling) return;
      setIsToggling(true);
      
      try {
        await initialize();
        await optIn();
        await start();
        await AsyncStorage.setItem(CONSENT_STORAGE_KEY, 'accepted');
        setUiToggleOn(true);
        showAlert(
          "Bandwidth Sharing Enabled",
          "Your device is now sharing idle bandwidth. You will earn rewards based on your contribution. You can disable this at any time.",
          [{ text: "OK" }]
        );
      } catch (err) {
        console.error('[Settings] Enable sharing failed:', err);
        showAlert(
          "Error",
          "Failed to enable bandwidth sharing. Please try again later.",
          [{ text: "OK" }]
        );
        setUiToggleOn(false);
      } finally {
        setIsToggling(false);
      }
    } else {
      // Turning OFF - ALWAYS show destructive alert with warning
      showDestructiveAlert(
        "withdraw Concent ?",
        "⚠️ IMPORTANT NOTICE\n\n" +
        "If you turn off this feature:\n\n" +
        "• Some SDK functions in Mavin Player will stop working\n" +
        "• The background service will stop immediately\n\n" +
        "You can re-enable this feature at any time from this screen.",
        [
          { text: "Cancel", style: "cancel", onPress: () => setUiToggleOn(true) },
          { 
            text: "Turn Off", 
            style: "destructive",
            onPress: async () => {
              if (isToggling) return;
              setIsToggling(true);
              
              try {
                await optOut();
                await AsyncStorage.multiRemove([CONSENT_STORAGE_KEY, CONSENT_SUPPRESS_KEY]);
                setUiToggleOn(false);
                showAlert(
                  "Bandwidth Sharing Disabled",
                  "The service has been stopped and your consent has been withdrawn.",
                  [{ text: "OK" }]
                );
              } catch (err) {
                console.error('[Settings] Disable sharing failed:', err);
                showAlert(
                  "Error",
                  "Failed to disable bandwidth sharing. Please try again.",
                  [{ text: "OK" }]
                );
                setUiToggleOn(true);
              } finally {
                setIsToggling(false);
              }
            }
          },
        ]
      );
    }
  }, [isToggling, showAlert, showDestructiveAlert]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const getThemeDisplayName = (): string => {
    if (mode === 'light') return 'Light';
    if (mode === 'dark')  return 'Dark';
    return 'System';
  };

  const handleClearCache = async () => {
    triggerHaptic();
    showDestructiveAlert(
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
              showAlert("Success", "Cache cleared successfully.", [{ text: "OK" }]);
            } catch {
              showAlert("Error", "Failed to clear cache.", [{ text: "OK" }]);
            }
          }
        },
      ]
    );
  };

  const handleSignOut = () => {
    triggerHaptic();
    showDestructiveAlert(
      "Sign Out",
      "Are you sure you want to sign out? You will need to log in again to access your account.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Sign Out", 
          style: "destructive",
          onPress: () => {
            showAlert("Signed Out", "You have been signed out.", [{ text: "OK" }]);
          }
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    triggerHaptic();
    showDestructiveAlert(
      "Delete Account",
      "⚠️ PERMANENT ACTION\n\nThis action is permanent and cannot be undone. All your data, playlists, and library will be lost forever.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: () => {
            showAlert("Account Deleted", "Your account has been scheduled for deletion.", [{ text: "OK" }]);
          }
        },
      ]
    );
  };

  const handleThemePress = () => {
    triggerHaptic();
    showAlert(
      "Theme",
      "Choose your preferred appearance",
      [
        { text: "Light", onPress: () => setMode("light") },
        { text: "Dark", onPress: () => setMode("dark") },
        { text: "System", onPress: () => setMode("system") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handleLanguagePress = () => {
    triggerHaptic();
    showAlert(
      "Language",
      "Choose your preferred language",
      [
        { text: "English", onPress: () => {} },
        { text: "French", onPress: () => {} },
        { text: "Spanish", onPress: () => {} },
        { text: "Cancel", style: "cancel" },
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
    showAlert("Rate Mavin", "Thank you for your feedback!", [{ text: "OK" }]);
  };

  const handleHelpPress = () => {
    triggerHaptic();
    router.push('/(modals)/help');
  };

  const handleFeedbackPress = () => {
    triggerHaptic();
    router.push('/(modals)/feedback');
  };

  const handlePrivacyPolicyPress = () => {
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
    showAlert(
      "Default Repeat Mode",
      "Choose your default repeat behavior",
      [
        { text: "Off", onPress: () => {} },
        { text: "All", onPress: () => {} },
        { text: "One", onPress: () => {} },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handlePlaybackSpeedPress = () => {
    triggerHaptic();
    showAlert(
      "Playback Speed",
      "Choose your default playback speed",
      [
        { text: "0.5×", onPress: () => {} },
        { text: "0.75×", onPress: () => {} },
        { text: "1×", onPress: () => {} },
        { text: "1.25×", onPress: () => {} },
        { text: "1.5×", onPress: () => {} },
        { text: "2×", onPress: () => {} },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handleStreamingQualityPress = () => {
    triggerHaptic();
    showAlert(
      "Streaming Quality",
      "Choose your preferred streaming quality",
      [
        { text: "Low (96 kbps)", onPress: () => {} },
        { text: "Medium (160 kbps)", onPress: () => {} },
        { text: "High (320 kbps)", onPress: () => {} },
        { text: "Very High (lossless)", onPress: () => {} },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handleDownloadQualityPress = () => {
    triggerHaptic();
    showAlert(
      "Download Quality",
      "Choose download quality for offline listening",
      [
        { text: "Low (96 kbps)", onPress: () => {} },
        { text: "Medium (160 kbps)", onPress: () => {} },
        { text: "High (320 kbps)", onPress: () => {} },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handleDataRightsPress = () => {
    triggerHaptic();
    showAlert(
      "Your Data Rights",
      "Depending on your location, you may have the right to access, correct, or delete your personal data. Contact support for assistance.",
      [{ text: "OK" }]
    );
  };

  const handleEncryptionPress = () => {
    triggerHaptic();
    showAlert(
      "Data Protection",
      "All data is encrypted in transit using TLS 1.3. Mavin Player does not sell your personal information. Full details are available in our Privacy Policy.",
      [
        { text: "View Policy", onPress: handlePrivacyPolicyPress },
        { text: "OK", style: "cancel" },
      ]
    );
  };

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
        ref={scrollViewRef}
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
            kind="nav" icon="speedometer" iconLib="mci"
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
            kind="nav" icon="equalizer" iconLib="mci"
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

        {/* ── PRIVACY SECTION with Accordions (ALL CLOSED by default) ───────── */}
        <View ref={privacyMainSectionRef}>
          <Text style={[styles.sectionTitle, { color: colors.gold, marginBottom: 10 }]}>Privacy & Security</Text>
          
          <View style={[styles.privacyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            
            {/* Privacy Settings Accordion - CLOSED by default */}
            <AccordionSection
              title="Privacy Settings"
              icon="lock-closed-outline"
              expanded={privacySettingsExpanded}
              onToggle={() => setPrivacySettingsExpanded(!privacySettingsExpanded)}
              colors={colors}
            >
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
                onPress={handlePrivacyPolicyPress}
              />
              <SettingRow
                kind="nav" icon="reader-outline"
                label="Terms of Service"
                onPress={handleTermsPress}
              />
            </AccordionSection>

            {/* Security Accordion - CLOSED by default */}
            <AccordionSection
              title="Security"
              icon="shield-checkmark-outline"
              expanded={securityExpanded}
              onToggle={() => setSecurityExpanded(!securityExpanded)}
              colors={colors}
            >
              <SettingRow
                kind="nav" icon="shield-checkmark-outline"
                label="Two-Factor Authentication"
                sub="Add an extra layer of security to your account"
                onPress={handleTwoFactorPress}
              />
              <SettingRow
                kind="nav" icon="key-outline"
                label="Change Password"
                onPress={handleChangePassword}
              />
            </AccordionSection>

            {/* Data Protection Accordion - CLOSED by default */}
            <AccordionSection
              title="Data Protection"
              icon="shield-outline"
              expanded={dataProtectionExpanded}
              onToggle={() => setDataProtectionExpanded(!dataProtectionExpanded)}
              colors={colors}
            >
              <SettingRow
                kind="nav" icon="shield-checkmark-outline"
                label="Encryption & Security"
                sub="Learn how your data is protected"
                onPress={handleEncryptionPress}
              />
              <SettingRow
                kind="nav" icon="document-text-outline"
                label="Your Data Rights"
                sub="Access, correct, or delete your data"
                onPress={handleDataRightsPress}
              />
            </AccordionSection>

            {/* Data Sharing Accordion - CLOSED by default, contains bandwidth sharing toggle */}
            <AccordionSection
              title="Data Sharing"
              icon="swap-horizontal-outline"
              expanded={dataSharingExpanded}
              onToggle={() => setDataSharingExpanded(!dataSharingExpanded)}
              colors={colors}
            >
              <SettingRow
                kind="toggle"
                icon="wifi-outline"
                iconLib="ion"
                label={uiToggleOn ? "Bandwidth Sharing (ON)" : "Bandwidth Sharing (OFF)"}
                sub={uiToggleOn 
                  ? "Tap to disable bandwidth sharing"
                  : "Tap to enable bandwidth sharing and earn rewards"}
                value={uiToggleOn}
                onToggle={handleBandwidthSharingToggle}
              />
            </AccordionSection>

          </View>
        </View>

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

  // ── Privacy Card (contains accordions)
  privacyCard: {
    borderRadius: "14@ms",
    borderWidth:  0.5,
    overflow:     "hidden",
    marginBottom: "24@vs",
  },

  // ── Accordion Styles
  accordionSection: {
    borderBottomWidth: 0.5,
  },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: "14@vs",
    paddingHorizontal: "14@s",
  },
  accordionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: "12@s",
  },
  accordionTitle: {
    fontSize: "15@ms",
    fontWeight: "600",
  },
  accordionContent: {
    paddingLeft: "46@s",
    paddingRight: "14@s",
    paddingBottom: "8@vs",
  },

  // ── Row Styles
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: "12@vs",
    minHeight: "48@vs",
  },
  rowDivider: {
    height: 0.5,
    marginLeft: "46@s",
  },
  rowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  iconBox: {
    width: "34@ms",
    height: "34@ms",
    borderRadius: "9@ms",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBoxSmall: {
    width: "30@ms",
    height: "30@ms",
    borderRadius: "8@ms",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTextBlock: {
    flex: 1,
  },
  rowLabel: {
    fontSize: "14@ms",
    fontWeight: "500",
  },
  rowSub: {
    fontSize: "11@ms",
    marginTop: "2@vs",
    lineHeight: "15@ms",
  },
  rowValue: {
    fontSize: "13@ms",
    letterSpacing: 0.2,
  },
});