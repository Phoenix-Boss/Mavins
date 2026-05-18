/**
 * EarningsConsentGate.tsx
 *
 * Four-tab consent modal for Pawns SDK bandwidth sharing.
 * Themed to match Mavin's ThemeContext — gold accents, dark/light surfaces.
 *
 * Tabs:
 *   1. General       — information about the app feature (no Pawns branding)
 *   2. Data Sharing  — required Pawns SDK disclosures (Section 3.6.5 a–e)
 *   3. Privacy       — your privacy policy + Pawns policies + age confirmation
 *   4. Data Protection — data retention, security, user rights
 *
 * Buttons:
 *   ✕ (header)  — soft dismiss, no stored decision, modal can re-appear next launch
 *   Accept      — enabled only after age checkbox is checked
 *                 → stores 'accepted' in AsyncStorage
 *                 → if "Don't show again" is checked, sets permanent suppression flag
 *   Decline     — stores 'rejected' permanently (no auto re-prompt ever)
 *                 → user must go to settings and tap "Enable Sharing" to re-trigger
 *
 * Show logic (call checkAndShowConsent() from your app's init code):
 *   - No stored decision          → show modal
 *   - stored 'accepted'           → never auto-show
 *   - stored 'rejected'           → never auto-show (manual re-trigger via settings)
 *
 * Usage:
 *   import { EarningsConsentGate, checkAndShowConsent } from './EarningsConsentGate';
 *
 *   const [showConsent, setShowConsent] = useState(false);
 *   useEffect(() => {
 *     checkAndShowConsent().then(should => { if (should) setShowConsent(true); });
 *   }, []);
 *
 *   <EarningsConsentGate
 *     visible={showConsent}
 *     onDismiss={() => setShowConsent(false)}
 *   />
 *
 * To manually re-trigger from settings:
 *   await clearConsentRejection();
 *   setShowConsent(true);
 *
 * NOTE: Wire up handleAccept to your Pawns/Honeygain SDK calls once the SDK
 * is available. Placeholder comments mark the exact locations.
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

const TABS = ['General', 'Data Sharing', 'Privacy', 'Data Protection'] as const;
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
  label:    string;
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
      <Text style={[styles.checkboxLabel, { color: colors.text }]}>{label}</Text>
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

// ─── Tab content ──────────────────────────────────────────────────────────────

function GeneralTab({ colors }: ThemedProps) {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Earn While You Share</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin offers you the opportunity to passively earn rewards by allowing a portion of your
        unused internet bandwidth to be used when your device is idle.
      </Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        This feature is entirely optional and has no effect on your core Mavin experience. You
        can enable or disable it at any time from the Settings screen.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>How It Works</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        When the sharing feature is active, a lightweight background service runs on your device.
        This service uses a small portion of your internet connection to route encrypted traffic
        through your device. Your personal data is never accessed or shared.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>What You Earn</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Rewards accumulate passively while sharing is active. You can track your balance and
        redeem rewards from within the Mavin app. Reward rates may vary based on your region
        and connection quality.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Control</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        You are always in control. Sharing only starts after you give explicit consent on the
        next screens, and you can withdraw your consent at any time from Settings → Sharing.
      </Text>
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

function DataSharingTab({ colors }: ThemedProps) {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Important Disclosures</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        By enabling bandwidth sharing, you acknowledge and agree to the following (as required
        by the Pawns SDK Terms of Service, Section 3.6.5):
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>a) Internet Traffic Routing</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Your device will act as a network node. Internet traffic from third parties will be
        routed through your device and your internet connection. This is the mechanism by which
        rewards are generated.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>b) Resource Consumption</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        The sharing service consumes device resources including internet bandwidth, battery, and
        processing capacity. The service is designed to operate at low priority to minimise
        impact on your device's performance.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>c) IP Address Visibility</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Your device's IP address will be visible to the network during sharing sessions. This
        is an inherent property of acting as a network node. Pawns' policies govern how this
        information is handled — see the{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Pawns Privacy Policy</LinkText>.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>d) Eligibility Requirements</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        You must be the primary user of this device and the primary account holder of the
        internet connection used. You must be at least 18 years of age. You should review your
        internet service provider's terms to ensure participation is permitted.
      </Text>

      <Text style={[styles.disclosureLabel, { color: colors.gold }]}>e) How to Disable</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        You may stop sharing and withdraw your consent at any time by navigating to{' '}
        <Text style={[styles.emphasis, { color: colors.text }]}>
          Settings → Sharing → Disable & Withdraw Consent
        </Text>
        . Disabling will stop the background service immediately.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>SDK Policies</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Bandwidth sharing is powered by Pawns SDK. By enabling this feature you also agree to:
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

interface PrivacyTabProps extends ThemedProps {
  ageConfirmed: boolean;
  onToggleAge:  () => void;
}

function PrivacyTab({ ageConfirmed, onToggleAge, colors }: PrivacyTabProps) {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Privacy (Mavin)</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Mavin is committed to protecting your personal data. Our full legal documentation is
        available at the links below:
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

      <Text style={[styles.sectionTitle, { color: colors.text }]}>SDK Privacy (Pawns)</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        The bandwidth sharing feature is powered by Pawns SDK. Pawns' data handling is governed
        by their own policies, which are independent of Mavin's:
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
        Pawns may collect device identifiers, IP addresses, and bandwidth usage statistics as
        described in their Privacy Policy. Mavin does not receive or store this data.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Age Confirmation</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Participation in the bandwidth sharing programme requires you to be at least 18 years
        old (or the age of majority in your jurisdiction, if higher).
      </Text>
      <Checkbox
        checked={ageConfirmed}
        onPress={onToggleAge}
        label="I confirm that I am at least 18 years old"
        testID="age-confirmation-checkbox"
        colors={colors}
      />
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

function DataProtectionTab({ colors }: ThemedProps) {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Data Retention</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Consent records (the fact that you gave or withdrew consent, and the timestamp) are
        retained for 24 months from the date of each event. This is required for legal
        compliance and may be provided to Pawns upon request.
      </Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Bandwidth usage logs generated by the Pawns SDK are subject to Pawns' own retention
        schedule as described in their{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Security Measures</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        All traffic routed through your device by the Pawns SDK is encrypted. Mavin stores your
        consent decision securely on-device using Android's SharedPreferences and React Native's
        AsyncStorage. No consent data is transmitted to Mavin's servers.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Rights</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        Depending on your jurisdiction, you may have the right to:
      </Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Access the personal data we hold about you</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Request correction of inaccurate data</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Request erasure of your data</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Object to or restrict processing</Text>
      <Text style={[styles.bulletItem, { color: colors.textSub }]}>•{'  '}Withdraw consent at any time</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        To exercise these rights regarding Mavin's data, contact us via{' '}
        <LinkText url={URLS.appPrivacyPolicy} colors={colors}>our Privacy Policy</LinkText>. For
        rights regarding Pawns' data, contact Pawns directly via their{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>.
      </Text>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Data Protection Contact</Text>
      <Text style={[styles.bodyText, { color: colors.textSub }]}>
        For data protection enquiries relating to Mavin, please use the contact details in our{' '}
        <LinkText url={URLS.appPrivacyPolicy} colors={colors}>Privacy Policy</LinkText>.
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
  const { colors } = useTheme();

  const [activeTab,     setActiveTab]     = useState<Tab>('General');
  const [ageConfirmed,  setAgeConfirmed]  = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [isLoading,     setIsLoading]     = useState(false);

  // Reset state each time the modal opens
  useEffect(() => {
    if (visible) {
      setActiveTab('General');
      setAgeConfirmed(false);
      setDontShowAgain(false);
      setIsLoading(false);
    }
  }, [visible]);

  // ✕ — soft close with no stored decision; modal can re-appear next session
  const handleDismiss = useCallback(() => {
    if (!isLoading) onDismiss();
  }, [isLoading, onDismiss]);

  const handleAccept = useCallback(async () => {
    if (!ageConfirmed || isLoading) return;
    setIsLoading(true);
    try {
      // ── SDK integration point ─────────────────────────────────────────────
      // import Honeygain from '@/native/HoneygainSDK';  // your actual path
      // await Honeygain.optIn();
      // await Honeygain.start();
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
      case 'General':
        return <GeneralTab colors={colors} />;
      case 'Data Sharing':
        return <DataSharingTab colors={colors} />;
      case 'Privacy':
        return (
          <PrivacyTab
            ageConfirmed={ageConfirmed}
            onToggleAge={() => setAgeConfirmed(v => !v)}
            colors={colors}
          />
        );
      case 'Data Protection':
        return <DataProtectionTab colors={colors} />;
    }
  };

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
              borderColor:      colors.borderGold,
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
            {/* Gold accent bar + title */}
            <View style={styles.headerLeft}>
              <View style={[styles.accentBar, { backgroundColor: colors.gold }]} />
              <View style={styles.headerTextBlock}>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                  Bandwidth Sharing
                </Text>
                <Text style={[styles.headerSubtitle, { color: colors.textSub }]}>
                  Review before enabling this feature
                </Text>
              </View>
            </View>

            {/* ✕ dismiss */}
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
                backgroundColor: colors.surface,
                borderTopColor:  colors.border,
              },
            ]}
          >
            {/* "Don't show again" */}
            <Checkbox
              checked={dontShowAgain}
              onPress={() => setDontShowAgain(v => !v)}
              label="Don't show this message again"
              testID="dont-show-again-checkbox"
              colors={colors}
            />

            {/* Age reminder */}
            {!ageConfirmed && (
              <Text style={[styles.ageWarning, { color: colors.warning }]}>
                ⚠ Confirm your age on the Privacy tab to enable Accept
              </Text>
            )}

            {/* Full-width Accept */}
            <TouchableOpacity
              style={[
                styles.acceptButton,
                { backgroundColor: colors.gold },
                (!ageConfirmed || isLoading) && { backgroundColor: colors.goldDim },
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
                    { color: colors.textInverse },
                    !ageConfirmed && { color: colors.textMuted },
                  ]}
                >
                  Accept
                </Text>
              )}
            </TouchableOpacity>

            {/* Subtle decline link */}
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

// ─── Styles (layout only — all colours injected at render time via theme) ─────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_MAX_WIDTH  = Math.min(SCREEN_WIDTH - 32, 480);
const CARD_MAX_HEIGHT = SCREEN_HEIGHT * 0.88;

const styles = StyleSheet.create({
  // ── Overlay
  overlay: {
    flex:              1,
    backgroundColor:   'rgba(0,0,0,0.72)',
    justifyContent:    'center',
    alignItems:        'center',
    paddingHorizontal: 16,
  },

  // ── Card
  card: {
    width:         CARD_MAX_WIDTH,
    maxHeight:     CARD_MAX_HEIGHT,
    borderRadius:  16,
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
    paddingVertical:   14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  accentBar: {
    width:        3,
    height:       34,
    borderRadius: 2,
  },
  headerTextBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize:      15,
    fontWeight:    '700',
    letterSpacing: 0.2,
    marginBottom:  2,
  },
  headerSubtitle: {
    fontSize:   12,
    lineHeight: 16,
  },

  // ✕ close
  closeBtn: {
    width:          32,
    height:         32,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     8,
  },
  closeBtnText: {
    fontSize:   14,
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
    paddingVertical:   10,
    paddingHorizontal: 4,
    alignItems:        'center',
    justifyContent:    'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize:   11,
    fontWeight: '500',
    textAlign:  'center',
  },

  // ── Content area
  contentArea: {
    flex:      1,
    minHeight: 180,
    maxHeight: CARD_MAX_HEIGHT - 320,
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
    fontSize:      14,
    fontWeight:    '700',
    letterSpacing: 0.3,
    marginTop:     16,
    marginBottom:  6,
  },
  bodyText: {
    fontSize:     13,
    lineHeight:   20,
    marginBottom: 8,
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
    paddingTop:        14,
    paddingBottom:     20,
  },
  ageWarning: {
    fontSize:     11,
    marginTop:    6,
    marginBottom: 8,
  },

  // Full-width Accept
  acceptButton: {
    width:           '100%',
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 14,
    borderRadius:    10,
    marginTop:       10,
  },
  acceptText: {
    fontSize:      15,
    fontWeight:    '700',
    letterSpacing: 0.4,
  },

  // Subtle decline link
  declineRow: {
    alignItems:   'center',
    paddingTop:   12,
    paddingBottom: 2,
  },
  declineText: {
    fontSize:   13,
    fontWeight: '500',
  },

  // ── Checkbox
  checkboxRow: {
    flexDirection:  'row',
    alignItems:     'center',
    marginVertical: 4,
    gap:            10,
  },
  checkboxBox: {
    width:           20,
    height:          20,
    borderRadius:    5,
    borderWidth:     1.5,
    alignItems:      'center',
    justifyContent:  'center',
  },
  checkboxTick: {
    fontSize:   12,
    fontWeight: '700',
    lineHeight: 14,
  },
  checkboxLabel: {
    flex:       1,
    fontSize:   13,
    lineHeight: 18,
  },
});

export default EarningsConsentGate;