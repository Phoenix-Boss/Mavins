/**
 * EarningsConsentGate.tsx
 *
 * Four-tab consent modal for Pawns SDK bandwidth sharing.
 * Themed to match Mavin's ThemeContext — gold accents on dark (white text + gold),
 * gold accents on light (black text + gold).
 *
 * Tabs (in order):
 *   1. General         — Mavin earnings feature only; NO Pawns branding
 *   2. Privacy         — Mavin privacy policy links + Pawns policy links; no age checkbox
 *   3. Data Protection — how Mavin encrypts and protects user info & stored data
 *   4. Data Sharing    — ALL Pawns SDK disclosures (Section 3.6.5 a–e); Pawns-only
 *
 * Footer (always rendered, beneath tab content):
 *   [ ] Don't show this message again
 *   [ ] By checking this box you confirm you have read and agree to the above terms,
 *       Mavin's Privacy Policy and Terms of Service, the Pawns Privacy Policy and
 *       Acceptable Use Policy, and that you are at least 18 years of age and the
 *       primary account holder on the internet connection used by this device.
 *   ⚠  age warning shown while unchecked
 *   [        Accept        ]   ← always rendered; opacity-dimmed until age box ticked
 *      No thanks, decline
 *
 * Accept flow:
 *   initialize() → optIn() → start()   (all from @/modules/honeygain)
 *   stores 'accepted' in AsyncStorage
 *   if "Don't show again" is ticked → sets permanent suppression flag
 *
 * Decline flow:
 *   stores 'rejected' permanently — user must re-enable via
 *   Settings → Privacy → Security → Enable Bandwidth Sharing
 *
 * ✕ (header close):
 *   soft dismiss — no decision stored — modal re-appears next session
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, type ThemeColors } from '@/contexts/ThemeContext';
import { initialize, optIn, start } from '@/modules/honeygain';

// ─── Storage keys ─────────────────────────────────────────────────────────────

export const CONSENT_STORAGE_KEY  = '@mavin_pawns_consent_decision';
export const CONSENT_SUPPRESS_KEY = '@mavin_pawns_suppress_modal';
const CONSENT_DECISION_ACCEPTED   = 'accepted';
const CONSENT_DECISION_REJECTED   = 'rejected';

// ─── External URLs ────────────────────────────────────────────────────────────

const URLS = {
  pawnsPrivacyPolicy: 'https://pawns.app/privacy-policy',
  pawnsAcceptableUse: 'https://pawns.app/acceptable-use-policy',
  appPrivacyPolicy:   'https://mavinapp.com/privacy',
  appTerms:           'https://mavinapp.com/terms',
  appLegalNotice:     'https://mavinapp.com/legal',
} as const;

// ─── Tab definitions ──────────────────────────────────────────────────────────
// Order: General → Privacy → Data Protection → Data Sharing

const TABS = ['General', 'Privacy', 'Data Protection', 'Data Sharing'] as const;
type Tab = typeof TABS[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function openUrl(url: string) {
  Linking.openURL(url).catch(() => {});
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ThemedProps {
  colors: ThemeColors;
}

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
          {
            borderColor:     colors.borderGold,
            backgroundColor: colors.surface,
          },
          checked && {
            backgroundColor: colors.gold,
            borderColor:     colors.gold,
          },
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

interface LinkTextProps {
  children: React.ReactNode;
  url:      string;
  colors:   ThemeColors;
}

function LinkText({ children, url, colors }: LinkTextProps) {
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
// Mavin-only. No Pawns branding. Describes the earnings feature in the context
// of the music app.

function GeneralTab({ colors }: ThemedProps) {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Earn While You Listen</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin gives you the opportunity to passively earn rewards simply by having the app
        running. When your device is idle and connected to Wi-Fi, you can opt in to let Mavin's
        earnings feature run quietly in the background alongside your music — no interaction
        needed.
      </Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        This feature is entirely separate from your music experience. Enabling it has no effect
        on playback, streaming quality, downloads, playlists, or any other part of Mavin.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>How It Works</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Once you opt in, a lightweight background service starts when your device has idle
        capacity to spare. The service uses a small portion of your unused internet bandwidth
        to generate rewards. When you actively use your device or stream music, it steps back
        automatically so your experience is never affected.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>What You Earn</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Rewards accumulate passively while the feature is active. You can track your balance
        and redeem earnings directly from within the Mavin app. Reward rates may vary based
        on your region and connection quality.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Always Your Choice</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        This feature only starts after you give explicit consent below. You can disable it and
        withdraw your consent at any time from{' '}
        <Text style={[styles.emphasis, { color: colors.text }]}>
          Settings → Privacy → Security → Disable Bandwidth Sharing
        </Text>
        . The service stops immediately when you disable it.
      </Text>
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

// ─── Tab 2 — Privacy ─────────────────────────────────────────────────────────
// Mavin privacy policy links + Pawns policy links. No age checkbox here —
// age confirmation is in the footer.

function PrivacyTab({ colors }: ThemedProps) {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Mavin Privacy</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin is committed to protecting your personal data. By enabling this feature you
        confirm you have read and agree to Mavin's legal documentation:
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        •{'  '}
        <LinkText url={URLS.appPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        •{'  '}
        <LinkText url={URLS.appTerms} colors={colors}>Terms & Conditions</LinkText>
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        •{'  '}
        <LinkText url={URLS.appLegalNotice} colors={colors}>Legal Notice</LinkText>
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Third-Party SDK Privacy</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        The bandwidth sharing feature uses a third-party SDK with its own independent privacy
        policies. Enabling this feature also means you agree to those policies. You can read
        the full technical disclosures about what the SDK does on the{' '}
        <Text style={[styles.emphasis, { color: colors.text }]}>Data Sharing</Text> tab.
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        •{'  '}
        <LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Pawns Privacy Policy</LinkText>
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        •{'  '}
        <LinkText url={URLS.pawnsAcceptableUse} colors={colors}>Pawns Acceptable Use Policy</LinkText>
      </Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        The SDK may collect device identifiers, IP addresses, and bandwidth usage statistics
        as described in the Pawns Privacy Policy. Mavin does not receive or store this data.
      </Text>
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

// ─── Tab 3 — Data Protection ─────────────────────────────────────────────────
// How Mavin uses encryption to protect user info and data. No Pawns content.

function DataProtectionTab({ colors }: ThemedProps) {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Encryption in Transit</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        All traffic passing through your device while the earnings feature is active is fully
        encrypted using industry-standard TLS protocols. Mavin never has access to the contents
        of this traffic — and neither does anyone on your local network.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>On-Device Data Security</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Your consent decision and its timestamp are stored securely on your device using
        Android's SharedPreferences and React Native's AsyncStorage. This data never leaves
        your device and is never transmitted to Mavin's servers or any third party.
      </Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Consent records are retained on-device for 24 months from each event date. This
        retention supports legal compliance and lets you audit your own consent history at
        any time from within the app.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>No Personal Data Sold</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin does not sell, rent, or share your personal information with advertisers or
        data brokers. Your account data, listening history, and device identifiers held by
        Mavin are kept strictly separate from the bandwidth sharing feature.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Rights</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Depending on your jurisdiction, you may have the right to:
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Access the personal data Mavin holds about you</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Request correction of inaccurate data</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Request erasure of your data</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Object to or restrict processing</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Withdraw consent at any time without penalty</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        To exercise any of these rights in relation to Mavin's data, use the contact details
        in our{' '}
        <LinkText url={URLS.appPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>.
        For rights regarding data held by Pawns, contact Pawns directly via their{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Data Protection Contact</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        For any data protection enquiry relating to Mavin, please use the contact details
        found in our{' '}
        <LinkText url={URLS.appPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>.
      </Text>
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

// ─── Tab 4 — Data Sharing ────────────────────────────────────────────────────
// ALL Pawns SDK disclosures (Section 3.6.5 a–e). This is the ONLY tab that
// references Pawns directly. Every item here is about the Pawns SDK and app.

function DataSharingTab({ colors }: ThemedProps) {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Powered by Pawns</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin's bandwidth sharing feature is powered entirely by the Pawns SDK. Pawns is a
        third-party platform that connects devices sharing idle bandwidth with businesses
        that need distributed network infrastructure. The disclosures below are required by
        the Pawns SDK Terms of Service, Section 3.6.5, and must be acknowledged before you
        enable this feature.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Required Disclosures (Pawns SDK §3.6.5)</Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>a) Internet Traffic Routing</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        When enabled, your device acts as a network node in the Pawns network. Internet
        traffic from Pawns' third-party customers is routed through your device and your
        internet connection. This routing is the mechanism by which rewards are generated.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>b) Resource Consumption</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        The Pawns sharing service consumes device resources including internet bandwidth,
        battery, and processing capacity. The service is designed to operate at low priority
        to minimise impact, but some resource usage will occur while it is active.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>c) IP Address Visibility</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Your device's IP address will be visible to the Pawns network during sharing sessions.
        This is an inherent property of acting as a network node. How Pawns handles this
        information is governed by the{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Pawns Privacy Policy</LinkText>.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>d) Eligibility Requirements</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        To use the Pawns SDK you must be the primary user of this device and the primary
        account holder of the internet connection used. You must be at least 18 years of age.
        You should also review your internet service provider's terms to confirm participation
        is permitted under your plan.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>e) How to Disable</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        You may stop sharing and withdraw your Pawns consent at any time by navigating to{' '}
        <Text style={[styles.emphasis, { color: colors.text }]}>
          Settings → Privacy → Security → Disable Bandwidth Sharing
        </Text>
        . This stops the Pawns background service immediately and revokes consent.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Pawns Policies</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        By enabling this feature you also agree directly to the following Pawns documents:
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        •{'  '}
        <LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Pawns Privacy Policy</LinkText>
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>
        •{'  '}
        <LinkText url={URLS.pawnsAcceptableUse} colors={colors}>Pawns Acceptable Use Policy</LinkText>
      </Text>
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

// ─── Check helpers (call from app init) ──────────────────────────────────────

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

export async function clearConsentRejection(): Promise<void> {
  await AsyncStorage.multiRemove([CONSENT_STORAGE_KEY, CONSENT_SUPPRESS_KEY]);
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface EarningsConsentGateProps {
  visible:   boolean;
  onDismiss: () => void;
}

export function EarningsConsentGate({ visible, onDismiss }: EarningsConsentGateProps) {
  const { colors, isDark } = useTheme();

  const [activeTab,     setActiveTab]     = useState<Tab>('General');
  const [ageConfirmed,  setAgeConfirmed]  = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [isLoading,     setIsLoading]     = useState(false);

  // Reset each time the modal opens
  useEffect(() => {
    if (visible) {
      setActiveTab('General');
      setAgeConfirmed(false);
      setDontShowAgain(false);
      setIsLoading(false);
    }
  }, [visible]);

  // ✕ — soft close, no decision stored
  const handleDismiss = useCallback(() => {
    if (!isLoading) onDismiss();
  }, [isLoading, onDismiss]);

  const handleAccept = useCallback(async () => {
    if (!ageConfirmed || isLoading) return;
    setIsLoading(true);
    try {
      // ── Honeygain SDK integration ─────────────────────────────────────────
      await initialize();
      await optIn();
      await start();
      // ─────────────────────────────────────────────────────────────────────
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

  const handleDecline = useCallback(async () => {
    if (isLoading) return;
    try {
      await AsyncStorage.setItem(CONSENT_STORAGE_KEY, CONSENT_DECISION_REJECTED);
    } catch (err) {
      console.error('[EarningsConsentGate] Decline storage failed:', err);
    }
    onDismiss();
  }, [isLoading, onDismiss]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'General':         return <GeneralTab colors={colors} />;
      case 'Privacy':         return <PrivacyTab colors={colors} />;
      case 'Data Protection': return <DataProtectionTab colors={colors} />;
      case 'Data Sharing':    return <DataSharingTab colors={colors} />;
    }
  };

  // ── Consent checkbox label — full legal text ──────────────────────────────
  const consentLabel = (
    <Text style={[styles.checkboxLabel, { color: colors.text }]}>
      By checking this box you confirm that you have read and agree to Mavin's{' '}
      <Text
        style={[styles.link, { color: colors.gold }]}
        onPress={() => openUrl(URLS.appPrivacyPolicy)}
      >
        Privacy Policy
      </Text>
      {' '}and{' '}
      <Text
        style={[styles.link, { color: colors.gold }]}
        onPress={() => openUrl(URLS.appTerms)}
      >
        Terms of Service
      </Text>
      , the{' '}
      <Text
        style={[styles.link, { color: colors.gold }]}
        onPress={() => openUrl(URLS.pawnsPrivacyPolicy)}
      >
        Pawns Privacy Policy
      </Text>
      {' '}and{' '}
      <Text
        style={[styles.link, { color: colors.gold }]}
        onPress={() => openUrl(URLS.pawnsAcceptableUse)}
      >
        Acceptable Use Policy
      </Text>
      , and that you are at least 18 years of age and the primary account holder on the
      internet connection used by this device.
    </Text>
  );

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
            },
          ]}
        >

          {/* ── Header ───────────────────────────────────────────────────── */}
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
                  Bandwidth Sharing
                </Text>
                <Text style={[styles.headerSubtitle, { color: colors.textSub }]}>
                  Review all tabs before enabling this feature
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: colors.surfaceHigh }]}
              onPress={handleDismiss}
              accessibilityRole="button"
              accessibilityLabel="Close"
              disabled={isLoading}
              activeOpacity={0.7}
            >
              <Text style={[styles.closeBtnText, { color: colors.textSub }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* ── Tab bar ──────────────────────────────────────────────────── */}
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

          {/* ── Tab content ──────────────────────────────────────────────── */}
          <View style={styles.contentArea}>
            {renderTabContent()}
          </View>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <View
            style={[
              styles.footer,
              {
                backgroundColor: colors.surfaceRaised,
                borderTopColor:  colors.borderGold,
              },
            ]}
          >
            {/* Don't show again */}
            <Checkbox
              checked={dontShowAgain}
              onPress={() => setDontShowAgain(v => !v)}
              label="Don't show this message again"
              testID="dont-show-again-checkbox"
              colors={colors}
            />

            {/* Age + full consent checkbox */}
            <View style={styles.consentCheckboxWrap}>
              <Checkbox
                checked={ageConfirmed}
                onPress={() => setAgeConfirmed(v => !v)}
                label={consentLabel}
                testID="age-confirmation-checkbox"
                colors={colors}
              />
            </View>

            {/* Warning shown while consent not ticked */}
            {!ageConfirmed && (
              <Text style={[styles.ageWarning, { color: colors.warning ?? colors.gold }]}>
                ⚠ You must agree to the above terms to enable Accept
              </Text>
            )}

            {/* Accept — always rendered; disabled until consent ticked */}
            <TouchableOpacity
              style={[
                styles.acceptButton,
                { backgroundColor: colors.gold },
                (!ageConfirmed || isLoading) && {
                  backgroundColor: isDark
                    ? `${colors.gold}55`   // dark mode: dim gold
                    : `${colors.gold}66`,  // light mode: dim gold
                },
              ]}
              onPress={handleAccept}
              accessibilityRole="button"
              accessibilityLabel="Accept bandwidth sharing"
              accessibilityState={{ disabled: !ageConfirmed || isLoading }}
              disabled={!ageConfirmed || isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.textInverse} size="small" />
              ) : (
                <Text
                  style={[
                    styles.acceptText,
                    {
                      color: ageConfirmed
                        ? colors.textInverse
                        : colors.textMuted,
                    },
                  ]}
                >
                  Accept
                </Text>
              )}
            </TouchableOpacity>

            {/* Decline */}
            <TouchableOpacity
              style={styles.declineRow}
              onPress={handleDecline}
              accessibilityRole="button"
              accessibilityLabel="Decline bandwidth sharing"
              disabled={isLoading}
              activeOpacity={0.6}
            >
              <Text style={[styles.declineText, { color: colors.textMuted }]}>
                No thanks, decline
              </Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Layout only — all colours injected at render time via ThemeContext.

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_MAX_WIDTH  = Math.min(SCREEN_WIDTH - 32, 480);
// FIXED: Increased max height to 95% of screen height to ensure footer visibility
const CARD_MAX_HEIGHT = SCREEN_HEIGHT * 0.92;

const styles = StyleSheet.create({
  // ── Overlay
  overlay: {
    flex:              1,
    backgroundColor:   'rgba(0,0,0,0.72)',
    justifyContent:    'center',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   8,  // Added vertical padding for better spacing on small screens
  },

  // ── Card
  card: {
    width:         CARD_MAX_WIDTH,
    maxHeight:     CARD_MAX_HEIGHT,
    borderRadius:  20,  // Slightly larger radius
    borderWidth:   1,
    overflow:      'hidden',
    elevation:     16,
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius:  24,
  },

  // ── Header
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   16,   // Increased from 14
    paddingHorizontal: 20,   // Increased from 16
    borderBottomWidth: 1,
  },
  headerLeft: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  accentBar: {
    width:        4,         // Increased from 3
    height:       40,        // Increased from 34
    borderRadius: 2,
  },
  headerTextBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize:      16,       // Increased from 15
    fontWeight:    '700',
    letterSpacing: 0.2,
    marginBottom:  2,
  },
  headerSubtitle: {
    fontSize:   12,
    lineHeight: 16,
  },

  // ── Close btn
  closeBtn: {
    width:          32,
    height:         32,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     8,
  },
  closeBtnText: {
    fontSize:   16,       // Increased from 14
    fontWeight: '600',
    lineHeight: 17,
  },

  // ── Tab bar
  tabBar: {
    flexDirection:     'row',
    borderBottomWidth: 1,
  },
  tabItem: {
    flex:              1,
    paddingVertical:   12,     // Increased from 10
    paddingHorizontal: 6,      // Increased from 4
    alignItems:        'center',
    justifyContent:    'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize:  12,              // Increased from 11
    fontWeight: '600',          // Increased weight for better visibility
    textAlign:  'center',
  },

  // ── Content area
  contentArea: {
    flex:      1,
    minHeight: 200,
    // FIXED: Dynamic max height to leave enough room for footer
    maxHeight: SCREEN_HEIGHT * 0.55,  // 55% of screen for tabs, rest for footer
  },
  tabContent: {
    flex:              1,
    paddingHorizontal: 20,
    paddingTop:        16,
  },
  tabSpacer: {
    height: 24,
  },

  // ── Typography
  sectionTitle: {
    fontSize:      15,       // Increased from 14
    fontWeight:    '700',
    letterSpacing: 0.3,
    marginTop:     16,
    marginBottom:  8,        // Increased from 6
  },
  bodyText: {
    fontSize:     13,
    lineHeight:   20,
    marginBottom: 10,        // Increased from 8
  },
  disclosureLabel: {
    fontSize:     13,
    fontWeight:   '700',
    marginTop:    12,
    marginBottom: 4,
  },
  bulletItem: {
    fontSize:     13,
    lineHeight:   20,
    marginBottom: 4,
    paddingLeft:  4,
  },
  emphasis: {
    fontWeight: '600',
  },
  link: {
    textDecorationLine: 'underline',
  },

  // ── Footer
  footer: {
    borderTopWidth:    1,
    paddingHorizontal: 20,
    paddingTop:        16,      // Increased from 14
    paddingBottom:     24,      // Increased from 20
  },
  consentCheckboxWrap: {
    marginTop: 8,
  },
  ageWarning: {
    fontSize:     12,           // Increased from 11
    marginTop:    8,            // Increased from 6
    marginBottom: 6,            // Increased from 4
  },

  // Accept button — always rendered
  acceptButton: {
    width:           '100%',
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 16,        // Increased from 14
    borderRadius:    12,        // Increased from 10
    marginTop:       16,        // Increased from 12
  },
  acceptText: {
    fontSize:      16,          // Increased from 15
    fontWeight:    '700',
    letterSpacing: 0.4,
  },

  // Decline link
  declineRow: {
    alignItems:    'center',
    paddingTop:    16,          // Increased from 12
    paddingBottom: 4,           // Increased from 2
  },
  declineText: {
    fontSize:   14,             // Increased from 13
    fontWeight: '500',
  },

  // ── Checkbox
  checkboxRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    marginVertical: 6,          // Increased from 4
    gap:            12,         // Increased from 10
  },
  checkboxBox: {
    width:          22,         // Increased from 20
    height:         22,         // Increased from 20
    borderRadius:   6,          // Increased from 5
    borderWidth:    1.5,
    alignItems:     'center',
    justifyContent: 'center',
    marginTop:      1,
    flexShrink:     0,
  },
  checkboxTick: {
    fontSize:   13,             // Increased from 12
    fontWeight: '700',
    lineHeight: 15,             // Increased from 14
  },
  checkboxLabel: {
    flex:       1,
    fontSize:   13,
    lineHeight: 20,             // Increased from 18
  },
  checkboxLabelWrap: {
    flex: 1,
  },
});

export default EarningsConsentGate;