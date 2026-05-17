/**
 * EarningsConsentGate.tsx
 *
 * Four-tab consent modal for Pawns SDK bandwidth sharing.
 *
 * Tabs:
 *   1. General       — information about the app feature (no Pawns branding)
 *   2. Data Sharing  — required Pawns SDK disclosures (Section 3.6.5 a–e)
 *   3. Privacy       — your privacy policy + Pawns policies + age confirmation
 *   4. Data Protection — data retention, security, user rights
 *
 * Buttons:
 *   Accept  — enabled only after age checkbox is checked
 *             → calls Honeygain.optIn() then Honeygain.start()
 *             → stores 'accepted' in AsyncStorage
 *             → if "Don't show again" is checked, sets permanent suppression flag
 *   Decline — stores 'rejected' permanently (no auto re-prompt ever)
 *             → user must go to settings and tap "Enable Sharing" to re-trigger
 *
 * Show logic (call checkAndShowConsent() from your app's init code):
 *   - No stored decision          → show modal
 *   - stored 'accepted'           → never auto-show
 *   - stored 'rejected'           → never auto-show (manual re-trigger via settings)
 *
 * Usage:
 *   import { EarningsConsentGate, checkAndShowConsent } from './EarningsConsentGate';
 *
 *   // In your root layout / App component:
 *   const [showConsent, setShowConsent] = useState(false);
 *
 *   useEffect(() => {
 *     checkAndShowConsent().then(should => { if (should) setShowConsent(true); });
 *   }, []);
 *
 *   <EarningsConsentGate
 *     visible={showConsent}
 *     onDismiss={() => setShowConsent(false)}
 *   />
 *
 * To manually re-trigger from settings (after user tapped "Enable Sharing"):
 *   await AsyncStorage.removeItem(CONSENT_STORAGE_KEY);
 *   setShowConsent(true);
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Linking,
  Platform,
  Dimensions,
  ActivityIndicator,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Honeygain from './index';

// ─── Storage keys ─────────────────────────────────────────────────────────────

export const CONSENT_STORAGE_KEY        = '@mavin_pawns_consent_decision';
export const CONSENT_SUPPRESS_KEY       = '@mavin_pawns_suppress_modal';
const CONSENT_DECISION_ACCEPTED         = 'accepted';
const CONSENT_DECISION_REJECTED         = 'rejected';

// ─── External URLs ────────────────────────────────────────────────────────────

const URLS = {
  pawnsPrivacyPolicy:    'https://pawns.app/privacy-policy',
  pawnsAcceptableUse:    'https://pawns.app/acceptable-use-policy',
  appPrivacyPolicy:      'https://mavinapp.com/privacy',       // replace with your URL
  appTerms:              'https://mavinapp.com/terms',         // replace with your URL
  appLegalNotice:        'https://mavinapp.com/legal',         // replace with your URL
} as const;

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = ['General', 'Data Sharing', 'Privacy', 'Data Protection'] as const;
type Tab = typeof TABS[number];

// ─── Helper to open links ─────────────────────────────────────────────────────

function openUrl(url: string) {
  Linking.openURL(url).catch(() => {
    // Silently fail — the URL will not open if no browser is available
  });
}

// ─── Checkbox component ───────────────────────────────────────────────────────

interface CheckboxProps {
  checked:  boolean;
  onPress:  () => void;
  label:    string;
  testID?:  string;
}

function Checkbox({ checked, onPress, label, testID }: CheckboxProps) {
  return (
    <TouchableOpacity
      style={styles.checkboxRow}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      testID={testID}
      activeOpacity={0.7}
    >
      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
        {checked && <Text style={styles.checkboxTick}>✓</Text>}
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Link text component ──────────────────────────────────────────────────────

interface LinkTextProps {
  children: React.ReactNode;
  url:      string;
}

function LinkText({ children, url }: LinkTextProps) {
  return (
    <Text style={styles.link} onPress={() => openUrl(url)} accessibilityRole="link">
      {children}
    </Text>
  );
}

// ─── Tab content components ───────────────────────────────────────────────────

function GeneralTab() {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>Earn While You Share</Text>
      <Text style={styles.bodyText}>
        Mavin offers you the opportunity to passively earn rewards by allowing a portion of your
        unused internet bandwidth to be used when your device is idle.
      </Text>
      <Text style={styles.bodyText}>
        This feature is entirely optional and has no effect on your core Mavin experience. You
        can enable or disable it at any time from the Settings screen.
      </Text>
      <Text style={styles.sectionTitle}>How It Works</Text>
      <Text style={styles.bodyText}>
        When the sharing feature is active, a lightweight background service runs on your device.
        This service uses a small portion of your internet connection to route encrypted traffic
        through your device. Your personal data is never accessed or shared.
      </Text>
      <Text style={styles.sectionTitle}>What You Earn</Text>
      <Text style={styles.bodyText}>
        Rewards accumulate passively while sharing is active. You can track your balance and
        redeem rewards from within the Mavin app. Reward rates may vary based on your region
        and connection quality.
      </Text>
      <Text style={styles.sectionTitle}>Your Control</Text>
      <Text style={styles.bodyText}>
        You are always in control. Sharing only starts after you give explicit consent on the
        next screens, and you can withdraw your consent at any time from Settings → Sharing.
      </Text>
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

function DataSharingTab() {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>Important Disclosures</Text>
      <Text style={styles.bodyText}>
        By enabling bandwidth sharing, you acknowledge and agree to the following (as required
        by the Pawns SDK Terms of Service, Section 3.6.5):
      </Text>

      <Text style={styles.disclosureLabel}>a) Internet Traffic Routing</Text>
      <Text style={styles.bodyText}>
        Your device will act as a network node. Internet traffic from third parties will be
        routed through your device and your internet connection. This is the mechanism by which
        rewards are generated.
      </Text>

      <Text style={styles.disclosureLabel}>b) Resource Consumption</Text>
      <Text style={styles.bodyText}>
        The sharing service consumes device resources including internet bandwidth, battery, and
        processing capacity. The service is designed to operate at low priority to minimise
        impact on your device's performance.
      </Text>

      <Text style={styles.disclosureLabel}>c) IP Address Visibility</Text>
      <Text style={styles.bodyText}>
        Your device's IP address will be visible to the network during sharing sessions. This
        is an inherent property of acting as a network node. Pawns' policies govern how this
        information is handled — see the{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy}>Pawns Privacy Policy</LinkText>.
      </Text>

      <Text style={styles.disclosureLabel}>d) Eligibility Requirements</Text>
      <Text style={styles.bodyText}>
        You must be the primary user of this device and the primary account holder of the
        internet connection used. You must be at least 18 years of age. You should review your
        internet service provider's terms to ensure participation is permitted.
      </Text>

      <Text style={styles.disclosureLabel}>e) How to Disable</Text>
      <Text style={styles.bodyText}>
        You may stop sharing and withdraw your consent at any time by navigating to{' '}
        <Text style={styles.emphasis}>Settings → Sharing → Disable & Withdraw Consent</Text>.
        Disabling will stop the background service immediately.
      </Text>

      <Text style={styles.sectionTitle}>SDK Policies</Text>
      <Text style={styles.bodyText}>
        Bandwidth sharing is powered by Pawns SDK. By enabling this feature you also agree to:
      </Text>
      <Text style={styles.bulletItem}>
        •{'  '}
        <LinkText url={URLS.pawnsPrivacyPolicy}>Pawns Privacy Policy</LinkText>
      </Text>
      <Text style={styles.bulletItem}>
        •{'  '}
        <LinkText url={URLS.pawnsAcceptableUse}>Pawns Acceptable Use Policy</LinkText>
      </Text>
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

interface PrivacyTabProps {
  ageConfirmed:    boolean;
  onToggleAge:     () => void;
}

function PrivacyTab({ ageConfirmed, onToggleAge }: PrivacyTabProps) {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>Your Privacy (Mavin)</Text>
      <Text style={styles.bodyText}>
        Mavin is committed to protecting your personal data. Our full legal documentation is
        available at the links below:
      </Text>
      <Text style={styles.bulletItem}>
        •{'  '}
        <LinkText url={URLS.appPrivacyPolicy}>Privacy Policy</LinkText>
      </Text>
      <Text style={styles.bulletItem}>
        •{'  '}
        <LinkText url={URLS.appTerms}>Terms & Conditions</LinkText>
      </Text>
      <Text style={styles.bulletItem}>
        •{'  '}
        <LinkText url={URLS.appLegalNotice}>Legal Notice</LinkText>
      </Text>

      <Text style={styles.sectionTitle}>SDK Privacy (Pawns)</Text>
      <Text style={styles.bodyText}>
        The bandwidth sharing feature is powered by Pawns SDK. Pawns' data handling is governed
        by their own policies, which are independent of Mavin's:
      </Text>
      <Text style={styles.bulletItem}>
        •{'  '}
        <LinkText url={URLS.pawnsPrivacyPolicy}>Pawns Privacy Policy</LinkText>
      </Text>
      <Text style={styles.bulletItem}>
        •{'  '}
        <LinkText url={URLS.pawnsAcceptableUse}>Pawns Acceptable Use Policy</LinkText>
      </Text>
      <Text style={styles.bodyText}>
        Pawns may collect device identifiers, IP addresses, and bandwidth usage statistics as
        described in their Privacy Policy. Mavin does not receive or store this data.
      </Text>

      <Text style={styles.sectionTitle}>Age Confirmation</Text>
      <Text style={styles.bodyText}>
        Participation in the bandwidth sharing programme requires you to be at least 18 years
        old (or the age of majority in your jurisdiction, if higher).
      </Text>
      <Checkbox
        checked={ageConfirmed}
        onPress={onToggleAge}
        label="I confirm that I am at least 18 years old"
        testID="age-confirmation-checkbox"
      />
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

function DataProtectionTab() {
  return (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>Data Retention</Text>
      <Text style={styles.bodyText}>
        Consent records (the fact that you gave or withdrew consent, and the timestamp) are
        retained for 24 months from the date of each event. This is required for legal
        compliance and may be provided to Pawns upon request.
      </Text>
      <Text style={styles.bodyText}>
        Bandwidth usage logs generated by the Pawns SDK are subject to Pawns' own retention
        schedule as described in their{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy}>Privacy Policy</LinkText>.
      </Text>

      <Text style={styles.sectionTitle}>Security Measures</Text>
      <Text style={styles.bodyText}>
        All traffic routed through your device by the Pawns SDK is encrypted. Mavin stores your
        consent decision securely on-device using Android's SharedPreferences and React Native's
        AsyncStorage. No consent data is transmitted to Mavin's servers.
      </Text>

      <Text style={styles.sectionTitle}>Your Rights</Text>
      <Text style={styles.bodyText}>
        Depending on your jurisdiction, you may have the right to:
      </Text>
      <Text style={styles.bulletItem}>•{'  '}Access the personal data we hold about you</Text>
      <Text style={styles.bulletItem}>•{'  '}Request correction of inaccurate data</Text>
      <Text style={styles.bulletItem}>•{'  '}Request erasure of your data</Text>
      <Text style={styles.bulletItem}>•{'  '}Object to or restrict processing</Text>
      <Text style={styles.bulletItem}>•{'  '}Withdraw consent at any time</Text>
      <Text style={styles.bodyText}>
        To exercise these rights regarding Mavin's data, contact us via{' '}
        <LinkText url={URLS.appPrivacyPolicy}>our Privacy Policy</LinkText>. For rights
        regarding Pawns' data, contact Pawns directly via their{' '}
        <LinkText url={URLS.pawnsPrivacyPolicy}>Privacy Policy</LinkText>.
      </Text>

      <Text style={styles.sectionTitle}>Data Protection Contact</Text>
      <Text style={styles.bodyText}>
        For data protection enquiries relating to Mavin, please use the contact details in our{' '}
        <LinkText url={URLS.appPrivacyPolicy}>Privacy Policy</LinkText>.
      </Text>
      <View style={styles.tabSpacer} />
    </ScrollView>
  );
}

// ─── Check helper (call from app init) ───────────────────────────────────────

/**
 * Returns true if the consent modal should be shown.
 *
 * Call this from your root component's useEffect or app initialiser.
 * Resolves to false if the user has previously accepted or rejected.
 */
export async function checkAndShowConsent(): Promise<boolean> {
  try {
    const suppressed = await AsyncStorage.getItem(CONSENT_SUPPRESS_KEY);
    if (suppressed === 'true') return false;

    const decision = await AsyncStorage.getItem(CONSENT_STORAGE_KEY);
    // Show only if no decision has been made yet
    return decision === null;
  } catch {
    return false;
  }
}

/**
 * Clears the stored rejection so the modal can be shown again.
 * Call this from the Settings page "Enable Sharing" button.
 */
export async function clearConsentRejection(): Promise<void> {
  await AsyncStorage.multiRemove([CONSENT_STORAGE_KEY, CONSENT_SUPPRESS_KEY]);
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface EarningsConsentGateProps {
  visible:   boolean;
  onDismiss: () => void;
}

export function EarningsConsentGate({ visible, onDismiss }: EarningsConsentGateProps) {
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

  const handleAccept = useCallback(async () => {
    if (!ageConfirmed || isLoading) return;

    setIsLoading(true);
    try {
      // 1. Grant consent in the SDK (also fires onConsentGranted + logs event)
      await Honeygain.optIn();

      // 2. Start bandwidth sharing
      await Honeygain.start();

      // 3. Persist the decision
      await AsyncStorage.setItem(CONSENT_STORAGE_KEY, CONSENT_DECISION_ACCEPTED);

      // 4. If "don't show again" is checked, suppress future auto-shows
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
      // Permanently store the rejection — no auto re-prompt
      await AsyncStorage.setItem(CONSENT_STORAGE_KEY, CONSENT_DECISION_REJECTED);
    } catch (err) {
      console.error('[EarningsConsentGate] Decline storage failed:', err);
    }
    onDismiss();
  }, [isLoading, onDismiss]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'General':
        return <GeneralTab />;
      case 'Data Sharing':
        return <DataSharingTab />;
      case 'Privacy':
        return (
          <PrivacyTab
            ageConfirmed={ageConfirmed}
            onToggleAge={() => setAgeConfirmed(v => !v)}
          />
        );
      case 'Data Protection':
        return <DataProtectionTab />;
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDecline}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card}>

          {/* ── Header ─────────────────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Bandwidth Sharing</Text>
            <Text style={styles.headerSubtitle}>
              Please review the following before enabling this feature
            </Text>
          </View>

          {/* ── Tab bar ────────────────────────────────────────────────── */}
          <View style={styles.tabBar}>
            {TABS.map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
                onPress={() => setActiveTab(tab)}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === tab }}
              >
                <Text
                  style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                >
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Tab content ─────────────────────────────────────────────── */}
          <View style={styles.contentArea}>
            {renderTabContent()}
          </View>

          {/* ── Footer controls ──────────────────────────────────────────── */}
          <View style={styles.footer}>
            {/* "Don't show again" checkbox (visible to acceptors) */}
            <Checkbox
              checked={dontShowAgain}
              onPress={() => setDontShowAgain(v => !v)}
              label="Don't show this message again"
              testID="dont-show-again-checkbox"
            />

            {/* Age confirmation reminder if Privacy tab not yet visited */}
            {!ageConfirmed && (
              <Text style={styles.ageWarning}>
                ⚠ Please confirm your age on the Privacy tab to enable Accept
              </Text>
            )}

            {/* Action buttons */}
            <View style={styles.buttonRow}>
              {/* Decline */}
              <TouchableOpacity
                style={styles.declineButton}
                onPress={handleDecline}
                accessibilityRole="button"
                accessibilityLabel="Decline bandwidth sharing"
                disabled={isLoading}
              >
                <Text style={styles.declineIcon}>✕</Text>
                <Text style={styles.declineText}>Decline</Text>
              </TouchableOpacity>

              {/* Accept */}
              <TouchableOpacity
                style={[
                  styles.acceptButton,
                  (!ageConfirmed || isLoading) && styles.acceptButtonDisabled,
                ]}
                onPress={handleAccept}
                accessibilityRole="button"
                accessibilityLabel="Accept bandwidth sharing"
                accessibilityState={{ disabled: !ageConfirmed || isLoading }}
                disabled={!ageConfirmed || isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.acceptIcon}>✓</Text>
                    <Text style={styles.acceptText}>Accept</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_MAX_WIDTH  = Math.min(SCREEN_WIDTH - 32, 480);
const CARD_MAX_HEIGHT = SCREEN_HEIGHT * 0.88;

const COLORS = {
  primary:         '#6C3CE1',   // Mavin purple — replace with your brand colour
  primaryDisabled: '#B39EEF',
  surface:         '#FFFFFF',
  background:      'rgba(0,0,0,0.55)',
  border:          '#E5E0F8',
  text:            '#1A1A2E',
  textMuted:       '#6B6B8A',
  link:            '#6C3CE1',
  decline:         '#E53E3E',
  declineText:     '#E53E3E',
  tabActive:       '#6C3CE1',
  tabInactive:     '#A0A0B0',
  tabBarBg:        '#F4F1FD',
  warning:         '#C05621',
  checkBg:         '#6C3CE1',
  checkBorder:     '#CBCBDF',
} as const;

const styles = StyleSheet.create({
  // ── Overlay + card
  overlay: {
    flex:            1,
    backgroundColor: COLORS.background,
    justifyContent:  'center',
    alignItems:      'center',
    paddingHorizontal: 16,
  },
  card: {
    width:           CARD_MAX_WIDTH,
    maxHeight:       CARD_MAX_HEIGHT,
    backgroundColor: COLORS.surface,
    borderRadius:    20,
    overflow:        'hidden',
    elevation:       12,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.18,
    shadowRadius:    16,
  },

  // ── Header
  header: {
    backgroundColor: COLORS.primary,
    paddingTop:      20,
    paddingBottom:   16,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize:    20,
    fontWeight:  '700',
    color:       '#FFFFFF',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize:  13,
    color:     'rgba(255,255,255,0.82)',
    lineHeight: 18,
  },

  // ── Tab bar
  tabBar: {
    flexDirection:   'row',
    backgroundColor: COLORS.tabBarBg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tabItem: {
    flex:            1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems:      'center',
    justifyContent:  'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: COLORS.tabActive,
  },
  tabLabel: {
    fontSize:   11,
    fontWeight: '500',
    color:      COLORS.tabInactive,
    textAlign:  'center',
  },
  tabLabelActive: {
    color:      COLORS.tabActive,
    fontWeight: '700',
  },

  // ── Content area
  contentArea: {
    flex:            1,
    minHeight:       180,
    maxHeight:       CARD_MAX_HEIGHT - 340,
  },
  tabContent: {
    flex:            1,
    paddingHorizontal: 20,
    paddingTop:      16,
  },
  tabSpacer: {
    height: 24,
  },

  // ── Typography
  sectionTitle: {
    fontSize:    15,
    fontWeight:  '700',
    color:       COLORS.text,
    marginTop:   16,
    marginBottom: 6,
  },
  bodyText: {
    fontSize:   13,
    color:      COLORS.textMuted,
    lineHeight: 20,
    marginBottom: 8,
  },
  disclosureLabel: {
    fontSize:    13,
    fontWeight:  '700',
    color:       COLORS.primary,
    marginTop:   12,
    marginBottom: 4,
  },
  bulletItem: {
    fontSize:    13,
    color:       COLORS.textMuted,
    lineHeight:  20,
    marginBottom: 4,
    paddingLeft:  4,
  },
  emphasis: {
    fontWeight: '600',
    color:      COLORS.text,
  },
  link: {
    color:           COLORS.link,
    textDecorationLine: 'underline',
  },

  // ── Footer
  footer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 20,
    paddingTop:     14,
    paddingBottom:  Platform.OS === 'ios' ? 28 : 16,
    backgroundColor: COLORS.surface,
  },
  ageWarning: {
    fontSize:    11,
    color:       COLORS.warning,
    marginBottom: 10,
    marginTop:    4,
  },
  buttonRow: {
    flexDirection: 'row',
    gap:           12,
    marginTop:     8,
  },

  // ── Decline button
  declineButton: {
    flex:            1,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 13,
    borderRadius:    10,
    borderWidth:     1.5,
    borderColor:     COLORS.decline,
    gap:             6,
  },
  declineIcon: {
    fontSize:   16,
    color:      COLORS.decline,
    fontWeight: '700',
  },
  declineText: {
    fontSize:   14,
    fontWeight: '600',
    color:      COLORS.declineText,
  },

  // ── Accept button
  acceptButton: {
    flex:            1,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    paddingVertical: 13,
    borderRadius:    10,
    backgroundColor: COLORS.primary,
    gap:             6,
  },
  acceptButtonDisabled: {
    backgroundColor: COLORS.primaryDisabled,
  },
  acceptIcon: {
    fontSize:   16,
    color:      '#FFFFFF',
    fontWeight: '700',
  },
  acceptText: {
    fontSize:   14,
    fontWeight: '700',
    color:      '#FFFFFF',
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
    borderColor:     COLORS.checkBorder,
    backgroundColor: '#FFFFFF',
    alignItems:      'center',
    justifyContent:  'center',
  },
  checkboxBoxChecked: {
    backgroundColor: COLORS.checkBg,
    borderColor:     COLORS.checkBg,
  },
  checkboxTick: {
    color:      '#FFFFFF',
    fontSize:   12,
    fontWeight: '700',
    lineHeight: 14,
  },
  checkboxLabel: {
    flex:       1,
    fontSize:   13,
    color:      COLORS.text,
    lineHeight: 18,
  },
});

export default EarningsConsentGate;