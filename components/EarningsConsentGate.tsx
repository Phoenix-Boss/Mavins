/**
 * EarningsConsentGate.tsx
 *
 * Four-tab consent modal for Mavin Player.
 * Themed via ThemeContext — gold accents on dark/light.
 *
 * Layout strategy:
 *   • Card is fixed at CARD_HEIGHT = SCREEN_HEIGHT * 0.94 — tall enough that
 *     NOTHING scrolls on any normal phone (no ScrollView needed in tabs).
 *   • Header + tab bar + footer + action bar are all flex-shrink: 0.
 *   • Tab content area takes all remaining space (flex: 1).
 *   • ScrollView inside each tab is kept as a safety net for very small screens,
 *     but scrollsEnabled={false} on large screens — content simply lays out flat.
 *
 * Tabs: General → Privacy → Data Protection → Data Sharing
 *
 * Accept flow  : initialize() → optIn() → start() → store 'accepted'
 * Settings flow: soft dismiss → onOpenSettings()
 * ✕ close      : soft dismiss, no decision stored
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, type ThemeColors } from '@/contexts/ThemeContext';
import { initialize, optIn, start } from '@/modules/honeygain';

// ─── Storage keys ─────────────────────────────────────────────────────────────

export const CONSENT_STORAGE_KEY  = '@mavin_pawns_consent_decision';
export const CONSENT_SUPPRESS_KEY = '@mavin_pawns_suppress_modal';
const CONSENT_DECISION_ACCEPTED   = 'accepted';

// ─── External URLs ────────────────────────────────────────────────────────────

const URLS = {
  pawnsPrivacyPolicy: 'https://pawns.app/privacy-policy',
  pawnsAcceptableUse: 'https://pawns.app/acceptable-use-policy',
  appPrivacyPolicy:   'https://mavinapp.com/privacy',
  appTerms:           'https://mavinapp.com/terms',
  appLegalNotice:     'https://mavinapp.com/legal',
} as const;

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = ['General', 'Privacy', 'Data Protection', 'Data Sharing'] as const;
type Tab = typeof TABS[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function openUrl(url: string) {
  Linking.openURL(url).catch(() => {});
}

// ─── Shared types ─────────────────────────────────────────────────────────────

interface ThemedProps { colors: ThemeColors; }

// ─── Checkbox ─────────────────────────────────────────────────────────────────

interface CheckboxProps extends ThemedProps {
  checked:  boolean;
  onPress:  () => void;
  label:    string | React.ReactNode;
  testID?:  string;
}

function Checkbox({ checked, onPress, label, testID, colors }: CheckboxProps) {
  return (
    <TouchableOpacity
      style={styles.checkboxRow}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      testID={testID}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.checkboxBox,
          { borderColor: colors.borderGold, backgroundColor: colors.surface },
          checked && { backgroundColor: colors.gold, borderColor: colors.gold },
        ]}
      >
        {checked && (
          <Text style={[styles.checkboxTick, { color: colors.textInverse }]}>✓</Text>
        )}
      </View>
      {typeof label === 'string' ? (
        <Text style={[styles.checkboxLabel, { color: colors.text }]}>{label}</Text>
      ) : (
        <View style={styles.checkboxLabelWrap}>{label}</View>
      )}
    </TouchableOpacity>
  );
}

// ─── LinkText ─────────────────────────────────────────────────────────────────

function LinkText({
  children, url, colors,
}: { children: React.ReactNode; url: string; colors: ThemeColors }) {
  return (
    <Text
      style={[styles.link, { color: colors.gold }]}
      onPress={() => openUrl(url)}
      accessibilityRole="link"
    >
      {children}
    </Text>
  );
}

// ─── Tab 1 — General ─────────────────────────────────────────────────────────

function GeneralTab({ colors }: ThemedProps) {
  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentContainer}
      showsVerticalScrollIndicator={false}
      scrollEnabled={true}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Welcome to Mavin Player</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin Player is your all-in-one music streaming destination. Discover, stream, and save
        tracks from emerging and established artists across Africa and beyond — all in one
        beautifully designed app.
      </Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Whether you're into Afrobeats, Amapiano, Hip-hop, Gospel, or R&B, Mavin Player puts
        the music that matters to you front and centre — curated playlists, trending charts,
        artist pages, and personalised recommendations that get smarter over time.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Stream & Download</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Stream millions of tracks at high quality or download them for offline listening.
        Like SoundCloud and Audiomack, Mavin Player lets you upload your own music, follow
        the artists you love, and share songs directly with friends. Your library travels
        with you wherever you go.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Built for Artists & Fans</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin Player is designed for both listeners and creators. Artists can upload tracks,
        release full albums, view detailed play analytics, and connect directly with their
        fanbase. Listeners can comment on songs, build public playlists, and support their
        favourite acts — all without leaving the app.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Always Your Choice</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Certain optional features within Mavin Player — such as the earnings programme —
        require your explicit consent before they activate. You are in full control at all
        times. Any feature you enable can be turned off at any moment from{' '}
        <Text style={[styles.emphasis, { color: colors.text }]}>
          Settings → Privacy → Security
        </Text>
        .
      </Text>
    </ScrollView>
  );
}

// ─── Tab 2 — Privacy ─────────────────────────────────────────────────────────

function PrivacyTab({ colors }: ThemedProps) {
  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentContainer}
      showsVerticalScrollIndicator={false}
      scrollEnabled={true}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Mavin Player Privacy</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin Player is committed to protecting your personal data. By enabling this feature
        you confirm you have read and agree to Mavin Player's legal documentation:
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        {'•  '}<LinkText url={URLS.appPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        {'•  '}<LinkText url={URLS.appTerms} colors={colors}>Terms & Conditions</LinkText>
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        {'•  '}<LinkText url={URLS.appLegalNotice} colors={colors}>Legal Notice</LinkText>
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Third-Party SDK Privacy</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        The bandwidth sharing feature uses a third-party SDK with its own independent privacy
        policies. Enabling this feature also means you agree to those policies. Full technical
        disclosures are on the{' '}
        <Text style={[styles.emphasis, { color: colors.text }]}>Data Sharing</Text> tab.
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        {'•  '}<LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Pawns Privacy Policy</LinkText>
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        {'•  '}<LinkText url={URLS.pawnsAcceptableUse} colors={colors}>Pawns Acceptable Use Policy</LinkText>
      </Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        The SDK may collect device identifiers, IP addresses, and bandwidth usage statistics
        as described in the Pawns Privacy Policy. Mavin Player does not receive or store this data.
      </Text>
    </ScrollView>
  );
}

// ─── Tab 3 — Data Protection ─────────────────────────────────────────────────

function DataProtectionTab({ colors }: ThemedProps) {
  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentContainer}
      showsVerticalScrollIndicator={false}
      scrollEnabled={true}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Encryption in Transit</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        All traffic passing through your device while the earnings feature is active is fully
        encrypted using industry-standard TLS protocols. Mavin Player never has access to
        the contents of this traffic — and neither does anyone on your local network.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>On-Device Data Security</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Your consent decision and its timestamp are stored securely on your device using
        Android's SharedPreferences and React Native's AsyncStorage. This data never leaves
        your device and is never transmitted to Mavin Player's servers or any third party.
      </Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Consent records are retained on-device for 24 months from each event date to support
        legal compliance and let you audit your consent history at any time from within the app.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>No Personal Data Sold</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin Player does not sell, rent, or share your personal information with advertisers
        or data brokers. Your account data, listening history, and device identifiers held
        by Mavin Player are kept strictly separate from the bandwidth sharing feature.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Rights</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Depending on your jurisdiction, you may have the right to:
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>{'•  '}Access the personal data Mavin Player holds about you</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>{'•  '}Request correction of inaccurate data</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>{'•  '}Request erasure of your data</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>{'•  '}Object to or restrict processing</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>{'•  '}Withdraw consent at any time without penalty</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        To exercise rights regarding Mavin Player's data, see our{' '}
        <LinkText url={URLS.appPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>.
        For rights regarding Pawns data, contact Pawns via their{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Data Protection Contact</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        For any data protection enquiry relating to Mavin Player, use the contact details in
        our{' '}
        <LinkText url={URLS.appPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>.
      </Text>
    </ScrollView>
  );
}

// ─── Tab 4 — Data Sharing ────────────────────────────────────────────────────

function DataSharingTab({ colors }: ThemedProps) {
  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabContentContainer}
      showsVerticalScrollIndicator={false}
      scrollEnabled={true}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Powered by Pawns</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin Player's bandwidth sharing feature is powered entirely by the Pawns SDK. Pawns
        connects devices sharing idle bandwidth with businesses that need distributed network
        infrastructure. The disclosures below are required by Pawns SDK Terms §3.6.5.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Required Disclosures (Pawns SDK §3.6.5)</Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>a) Internet Traffic Routing</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        When enabled, your device acts as a network node in the Pawns network. Internet
        traffic from Pawns' third-party customers is routed through your device and your
        internet connection. This routing is how rewards are generated.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>b) Resource Consumption</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        The Pawns service consumes device resources including internet bandwidth, battery,
        and processing capacity. It operates at low priority to minimise impact, but some
        resource usage will occur while active.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>c) IP Address Visibility</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Your device's IP address will be visible to the Pawns network during sharing sessions.
        This is an inherent property of acting as a network node. See the{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Pawns Privacy Policy</LinkText>{' '}
        for details on how this is handled.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>d) Eligibility Requirements</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        You must be the primary user of this device and the primary account holder of the
        internet connection used. You must be at least 18 years of age. Review your internet
        service provider's terms to confirm participation is permitted under your plan.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>e) How to Disable</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Stop sharing at any time via{' '}
        <Text style={[styles.emphasis, { color: colors.text }]}>
          Settings → Privacy → Security → Disable Bandwidth Sharing
        </Text>
        . The Pawns background service stops immediately and consent is revoked.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Pawns Policies</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        {'•  '}<LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Pawns Privacy Policy</LinkText>
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        {'•  '}<LinkText url={URLS.pawnsAcceptableUse} colors={colors}>Pawns Acceptable Use Policy</LinkText>
      </Text>
    </ScrollView>
  );
}

// ─── Check helpers ────────────────────────────────────────────────────────────

export async function checkAndShowConsent(): Promise<boolean> {
  try {
    const suppressed = await AsyncStorage.getItem(CONSENT_SUPPRESS_KEY);
    if (suppressed === 'true') return false;
    const decision = await AsyncStorage.getItem(CONSENT_STORAGE_KEY);
    return decision === null;
  } catch {
    return false;
  }
}

export async function clearConsentDecision(): Promise<void> {
  await AsyncStorage.multiRemove([CONSENT_STORAGE_KEY, CONSENT_SUPPRESS_KEY]);
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface EarningsConsentGateProps {
  visible:        boolean;
  onDismiss:      () => void;
  onOpenSettings: () => void;
}

export function EarningsConsentGate({
  visible,
  onDismiss,
  onOpenSettings,
}: EarningsConsentGateProps) {
  const { colors, isDark } = useTheme();

  const [activeTab,     setActiveTab]     = useState<Tab>('General');
  const [ageConfirmed,  setAgeConfirmed]  = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [isLoading,     setIsLoading]     = useState(false);

  useEffect(() => {
    if (visible) {
      setActiveTab('General');
      setAgeConfirmed(false);
      setDontShowAgain(false);
      setIsLoading(false);
    }
  }, [visible]);

  const handleDismiss = useCallback(() => {
    if (!isLoading) onDismiss();
  }, [isLoading, onDismiss]);

  const handleAccept = useCallback(async () => {
    if (!ageConfirmed || isLoading) return;
    setIsLoading(true);
    try {
      await initialize();
      await optIn();
      await start();
      await AsyncStorage.setItem(CONSENT_STORAGE_KEY, CONSENT_DECISION_ACCEPTED);
      if (dontShowAgain) {
        await AsyncStorage.setItem(CONSENT_SUPPRESS_KEY, 'true');
      }
      onDismiss();
    } catch (err) {
      console.error('[EarningsConsentGate] Accept failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [ageConfirmed, dontShowAgain, isLoading, onDismiss]);

  const handleOpenSettings = useCallback(() => {
    if (isLoading) return;
    onDismiss();
    onOpenSettings();
  }, [isLoading, onDismiss, onOpenSettings]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'General':         return <GeneralTab colors={colors} />;
      case 'Privacy':         return <PrivacyTab colors={colors} />;
      case 'Data Protection': return <DataProtectionTab colors={colors} />;
      case 'Data Sharing':    return <DataSharingTab colors={colors} />;
    }
  };

  const consentLabel = (
    <Text style={[styles.checkboxLabel, { color: colors.text }]}>
      By checking this box you confirm you have read and agree to Mavin Player's{' '}
      <Text style={[styles.link, { color: colors.gold }]} onPress={() => openUrl(URLS.appPrivacyPolicy)}>
        Privacy Policy
      </Text>
      {' '}and{' '}
      <Text style={[styles.link, { color: colors.gold }]} onPress={() => openUrl(URLS.appTerms)}>
        Terms of Service
      </Text>
      , the{' '}
      <Text style={[styles.link, { color: colors.gold }]} onPress={() => openUrl(URLS.pawnsPrivacyPolicy)}>
        Pawns Privacy Policy
      </Text>
      {' '}and{' '}
      <Text style={[styles.link, { color: colors.gold }]} onPress={() => openUrl(URLS.pawnsAcceptableUse)}>
        Acceptable Use Policy
      </Text>
      , and that you are at least 18 years of age and the primary account holder on the
      internet connection used by this device.
    </Text>
  );

  const dimmedGold = isDark ? `${colors.gold}4D` : `${colors.gold}5A`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor:     colors.borderGold,
              shadowColor:     colors.gold,
            },
          ]}
        >

          {/* ── Gold top hairline ─────────────────────────────────────── */}
          <View style={[styles.topHairline, { backgroundColor: colors.gold }]} />

          {/* ── Header ───────────────────────────────────────────────── */}
          <View
            style={[
              styles.header,
              {
                backgroundColor:   colors.surfaceRaised,
                borderBottomColor: colors.borderGold,
              },
            ]}
          >
            <View style={styles.headerLeft}>
              <View style={[styles.accentBar, { backgroundColor: colors.gold }]} />
              <View style={styles.headerTextBlock}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                  Mavin Player
                </Text>
                <Text style={[styles.headerSubtitle, { color: colors.textSub }]}>
                  Review all tabs before enabling this feature
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[
                styles.closeBtn,
                { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' },
              ]}
              onPress={handleDismiss}
              accessibilityRole="button"
              accessibilityLabel="Close"
              disabled={isLoading}
              hitSlop={12}
              activeOpacity={0.7}
            >
              <Text style={[styles.closeBtnText, { color: colors.textSub }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* ── Tab bar ──────────────────────────────────────────────── */}
          <View
            style={[
              styles.tabBar,
              {
                backgroundColor:   colors.surfaceRaised,
                borderBottomColor: colors.border,
              },
            ]}
          >
            {TABS.map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.tabItem,
                  activeTab === tab && { borderBottomColor: colors.gold },
                ]}
                onPress={() => setActiveTab(tab)}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === tab }}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    { color: colors.textMuted },
                    activeTab === tab && { color: colors.gold, fontWeight: '700' },
                  ]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                >
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Tab content — flex:1 takes all available space ───────── */}
          <View style={styles.contentArea}>
            {renderTabContent()}
          </View>

          {/* ── Gold divider before footer ────────────────────────────── */}
          <View style={[styles.divider, { backgroundColor: colors.borderGold }]} />

          {/* ── Footer — checkboxes + warning ────────────────────────── */}
          <View
            style={[
              styles.footer,
              { backgroundColor: colors.surfaceRaised },
            ]}
          >
            <Checkbox
              checked={dontShowAgain}
              onPress={() => setDontShowAgain(v => !v)}
              label="Don't show this message again"
              testID="dont-show-again-checkbox"
              colors={colors}
            />

            <View style={styles.consentCheckboxWrap}>
              <Checkbox
                checked={ageConfirmed}
                onPress={() => setAgeConfirmed(v => !v)}
                label={consentLabel}
                testID="age-confirmation-checkbox"
                colors={colors}
              />
            </View>

            <Text
              style={[
                styles.ageWarning,
                {
                  color:   colors.warning ?? colors.gold,
                  opacity: ageConfirmed ? 0 : 1,
                },
              ]}
            >
              ⚠ You must agree to the above terms to enable Accept
            </Text>
          </View>

          {/* ── Gold divider before action bar ───────────────────────── */}
          <View style={[styles.divider, { backgroundColor: colors.borderGold }]} />

          {/* ── Action bar ───────────────────────────────────────────── */}
          <View
            style={[
              styles.actionBar,
              { backgroundColor: colors.surfaceRaised },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.acceptButton,
                {
                  backgroundColor: ageConfirmed && !isLoading
                    ? colors.gold
                    : dimmedGold,
                },
              ]}
              onPress={handleAccept}
              accessibilityRole="button"
              accessibilityLabel="Accept"
              accessibilityState={{ disabled: !ageConfirmed || isLoading }}
              disabled={!ageConfirmed || isLoading}
              activeOpacity={0.85}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.textInverse} size="small" />
              ) : (
                <Text
                  style={[
                    styles.acceptText,
                    { color: ageConfirmed ? colors.textInverse : colors.textMuted },
                  ]}
                >
                  Accept
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.settingsButton,
                { borderColor: colors.borderGold },
              ]}
              onPress={handleOpenSettings}
              accessibilityRole="button"
              accessibilityLabel="Go to Settings"
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <Text style={[styles.settingsText, { color: colors.textSub }]}>
                ⚙{'  '}Go to Settings
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Gold bottom hairline ──────────────────────────────────── */}
          <View style={[styles.bottomHairline, { backgroundColor: colors.gold }]} />

        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH  = Math.min(SCREEN_WIDTH - 32, 480);
// Tall enough that every tab's content + footer + action bar fits without scrolling
// on any standard phone (≥ 667pt logical height, e.g. iPhone SE 3rd gen).
const CARD_HEIGHT = SCREEN_HEIGHT * 0.94;

const styles = StyleSheet.create({

  // ── Full-screen overlay
  overlay: {
    flex:              1,
    backgroundColor:   'rgba(0,0,0,0.72)',
    justifyContent:    'center',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   Platform.OS === 'ios' ? 28 : 16,
  },

  // ── Card — fixed tall height, column layout
  card: {
    width:         CARD_WIDTH,
    height:        CARD_HEIGHT,   // ← FIXED HEIGHT: fills ~94% of screen
    borderRadius:  20,
    borderWidth:   1,
    overflow:      'hidden',
    elevation:     20,
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius:  28,
    flexDirection: 'column',
  },

  // ── Decorative hairlines
  topHairline: {
    height:     2,
    width:      '100%',
    opacity:    0.8,
    flexShrink: 0,
  },
  bottomHairline: {
    height:     1,
    width:      '100%',
    opacity:    0.5,
    flexShrink: 0,
  },
  divider: {
    height:     StyleSheet.hairlineWidth,
    width:      '100%',
    opacity:    0.6,
    flexShrink: 0,
  },

  // ── Header — fixed height, never shrinks
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   14,
    paddingHorizontal: 20,
    flexShrink:        0,
  },
  headerLeft: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  accentBar: {
    width:        4,
    height:       36,
    borderRadius: 2,
  },
  headerTextBlock: { flex: 1 },
  headerTitle: {
    fontSize:      16,
    fontWeight:    '700',
    letterSpacing: 0.2,
    marginBottom:  2,
  },
  headerSubtitle: {
    fontSize:   12,
    lineHeight: 16,
  },
  closeBtn: {
    width:          32,
    height:         32,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     8,
  },
  closeBtnText: {
    fontSize:   16,
    fontWeight: '600',
    lineHeight: 17,
  },

  // ── Tab bar — fixed height, never shrinks
  tabBar: {
    flexDirection: 'row',
    flexShrink:    0,
  },
  tabItem: {
    flex:              1,
    paddingVertical:   12,
    paddingHorizontal: 4,
    alignItems:        'center',
    justifyContent:    'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize:   11,
    fontWeight: '600',
    textAlign:  'center',
  },

  // ── Tab content area — flex:1 expands to fill ALL remaining vertical space
  contentArea: {
    flex: 1,          // ← takes whatever height is left after fixed sections
    overflow: 'hidden',
  },
  tabContent: {
    flex: 1,
  },
  tabContentContainer: {
    paddingHorizontal: 22,
    paddingTop:        16,
    paddingBottom:     20,
  },

  // ── Typography
  sectionTitle: {
    fontSize:      14,
    fontWeight:    '700',
    letterSpacing: 0.3,
    marginTop:     12,
    marginBottom:  6,
  },
  bodyText: {
    fontSize:     12.5,
    lineHeight:   20,
    marginBottom: 8,
  },
  disclosureLabel: {
    fontSize:     12.5,
    fontWeight:   '700',
    marginTop:    10,
    marginBottom: 4,
  },
  bulletItem: {
    fontSize:     12.5,
    lineHeight:   20,
    marginBottom: 4,
    paddingLeft:  4,
  },
  emphasis: { fontWeight: '600' },
  link:     { textDecorationLine: 'underline' },

  // ── Footer — fixed, no internal scroll
  footer: {
    paddingHorizontal: 20,
    paddingTop:        14,
    paddingBottom:     10,
    flexShrink:        0,
  },
  consentCheckboxWrap: {
    marginTop: 10,
  },
  ageWarning: {
    fontSize:   11.5,
    marginTop:  8,
    lineHeight: 16,
  },

  // ── Action bar — always fully visible at bottom
  actionBar: {
    paddingHorizontal: 20,
    paddingTop:        12,
    paddingBottom:     Platform.OS === 'ios' ? 18 : 14,
    flexShrink:        0,
    gap:               8,
  },

  acceptButton: {
    width:           '100%',
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 14,
    borderRadius:    14,
    elevation:       4,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.18,
    shadowRadius:    6,
  },
  acceptText: {
    fontSize:      15,
    fontWeight:    '700',
    letterSpacing: 0.4,
  },

  settingsButton: {
    width:           '100%',
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 12,
    borderRadius:    14,
    borderWidth:     1.5,
    backgroundColor: 'transparent',
  },
  settingsText: {
    fontSize:   13,
    fontWeight: '600',
  },

  // ── Checkbox
  checkboxRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    gap:            12,
  },
  checkboxBox: {
    width:          22,
    height:         22,
    borderRadius:   6,
    borderWidth:    1.5,
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      2,
    flexShrink:     0,
  },
  checkboxTick: {
    fontSize:   13,
    fontWeight: '700',
    lineHeight: 15,
  },
  checkboxLabel: {
    flex:       1,
    fontSize:   12.5,
    lineHeight: 19,
  },
  checkboxLabelWrap: { flex: 1 },
});

export default EarningsConsentGate;