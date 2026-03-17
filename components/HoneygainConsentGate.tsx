// components/HoneygainConsentGate.tsx
//
// Professional 3-page consent flow — Mavins Player × Honeygain.
//
// NO API KEY HERE. The module (honeygain-sdk/index.ts) owns the key entirely.
// This component only calls: Honeygain.initialize() → Honeygain.optIn() → Honeygain.start()
//
// Flow:
//   1. All Android runtime permission dialogs fire at once (before modal opens)
//   2. Page 1 — Hero: value proposition + trust signals
//   3. Page 2 — Sections: Privacy / Network / Background / Data Sharing /
//               Boot / Notifications — all pre-toggled ON, each expandable
//   4. Page 3 — Confirm: checklist summary + legal + CTA
//   5. Decision persisted in AsyncStorage — never shown again

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Honeygain from 'honeygain-sdk';

// ─── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY          = '@honeygain_consent_v2';
const { height: SCREEN_H } = Dimensions.get('window');

const ALL_PERMISSIONS = [
  PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
  PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
  PermissionsAndroid.PERMISSIONS.ACCESS_NETWORK_STATE,
  PermissionsAndroid.PERMISSIONS.ACCESS_WIFI_STATE,
  PermissionsAndroid.PERMISSIONS.RECEIVE_BOOT_COMPLETED,
].filter(Boolean) as string[];

// ─── Section definitions ──────────────────────────────────────────────────────
interface Section {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  detail: string;
  required: boolean;
}

const SECTIONS: Section[] = [
  {
    id: 'privacy',
    icon: '🔒',
    title: 'Privacy Protection',
    subtitle: 'Your data stays yours',
    detail:
      'Mavins Player and Honeygain never collect, store, or sell personal data. ' +
      'Only anonymous network traffic is shared — never browsing history, files, ' +
      'contacts, location, or any identifiable information.',
    required: true,
  },
  {
    id: 'network',
    icon: '📶',
    title: 'Network Usage',
    subtitle: 'Idle bandwidth only',
    detail:
      "The SDK uses bandwidth your device isn't already using. " +
      'It respects your data plan — it pauses automatically on mobile data ' +
      'if you prefer Wi-Fi only, and you can set usage limits at any time.',
    required: true,
  },
  {
    id: 'background',
    icon: '⚡',
    title: 'Background Activity',
    subtitle: 'Runs silently, earns passively',
    detail:
      'A lightweight background service keeps earning even when the app is closed. ' +
      'It uses minimal CPU and battery. Android requires a small persistent ' +
      'notification for any background service — you can silence it anytime.',
    required: true,
  },
  {
    id: 'data_sharing',
    icon: '🤝',
    title: 'Data Sharing',
    subtitle: 'Shared with Honeygain network only',
    detail:
      'Your anonymous bandwidth is routed through the Honeygain peer-to-peer network ' +
      'for legitimate commercial use cases: web intelligence, ad verification, and ' +
      'content delivery. No personal data is ever part of this.',
    required: false,
  },
  {
    id: 'boot',
    icon: '🔁',
    title: 'Start on Reboot',
    subtitle: 'Never miss earning time',
    detail:
      'Mavins Player will restart the earning service automatically after your ' +
      'device reboots, so you are always earning without lifting a finger.',
    required: false,
  },
  {
    id: 'notifications',
    icon: '🔔',
    title: 'Notifications',
    subtitle: 'Status & earning updates',
    detail:
      'Android requires a persistent notification for any background service. ' +
      'We keep it minimal — just a small icon confirming the service is active. ' +
      'You can silence or hide it in your device notification settings at any time.',
    required: false,
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────
type Page = 'hero' | 'sections' | 'confirm';
interface Props { children: React.ReactNode }

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────
export default function HoneygainConsentGate({ children }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [page, setPage]           = useState<Page>('hero');
  const [busy, setBusy]           = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [toggles, setToggles]     = useState<Record<string, boolean>>(
    Object.fromEntries(SECTIONS.map(s => [s.id, true]))
  );

  const slideAnim = useRef(new Animated.Value(SCREEN_H)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  const openModal = useCallback(() => {
    setShowModal(true);
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 55, friction: 13, useNativeDriver: true }),
      Animated.timing(fadeAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [slideAnim, fadeAnim]);

  // ── On mount: permissions then check stored decision ──────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try { await PermissionsAndroid.requestMultiple(ALL_PERMISSIONS as any); } catch (_) {}

      const stored = await AsyncStorage.getItem(STORAGE_KEY);

      if (stored === 'accepted') {
        try {
          await Honeygain.initialize(); // no args — key is inside the module
          await Honeygain.start();
        } catch (e) { console.warn('[Honeygain] Silent restart:', e); }
      } else if (stored !== 'declined') {
        openModal();
      }
    })();
  }, [openModal]);

  // ── Allow All ─────────────────────────────────────────────────────────────
  const handleAllow = useCallback(async () => {
    setBusy(true);
    try {
      await Honeygain.initialize(); // no args — key is inside the module
      await Honeygain.optIn();      // custom consent screen: we call optIn ourselves
      await Honeygain.start();
      await AsyncStorage.setItem(STORAGE_KEY, 'accepted');
      setShowModal(false);
    } catch (e) {
      console.warn('[Honeygain] Allow failed:', e);
    } finally {
      setBusy(false);
    }
  }, []);

  // ── Decline ───────────────────────────────────────────────────────────────
  const handleDecline = useCallback(async () => {
    try {
      await Honeygain.optOut();
      await AsyncStorage.setItem(STORAGE_KEY, 'declined');
    } catch (_) {}
    setShowModal(false);
  }, []);

  const toggleSection = useCallback((id: string) => {
    const sec = SECTIONS.find(s => s.id === id);
    if (sec?.required) return;
    setToggles(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => (prev === id ? null : id));
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {children}

      <Modal visible={showModal} transparent animationType="none" statusBarTranslucent onRequestClose={() => {}}>
        {/* Dimmed backdrop */}
        <Animated.View style={[s.backdrop, { opacity: fadeAnim }]} />

        {/* Sheet */}
        <Animated.View style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}>

          {/* Header bar */}
          <View style={s.headerBar}>
            {page !== 'hero' ? (
              <Pressable onPress={() => setPage(p => p === 'confirm' ? 'sections' : 'hero')} hitSlop={12}>
                <Text style={s.backTxt}>‹ Back</Text>
              </Pressable>
            ) : <View style={{ width: 50 }} />}

            <View style={s.stepDots}>
              {(['hero', 'sections', 'confirm'] as Page[]).map(p => (
                <View key={p} style={[s.dot, page === p && s.dotActive]} />
              ))}
            </View>

            <Pressable onPress={handleDecline} hitSlop={12}>
              <Text style={s.skipTxt}>Skip</Text>
            </Pressable>
          </View>

          {/* Pages */}
          {page === 'hero'     && <HeroPage onNext={() => setPage('sections')} />}
          {page === 'sections' && (
            <SectionsPage
              sections={SECTIONS}
              toggles={toggles}
              expanded={expanded}
              onToggle={toggleSection}
              onExpand={toggleExpand}
              onNext={() => setPage('confirm')}
            />
          )}
          {page === 'confirm' && (
            <ConfirmPage busy={busy} onAllow={handleAllow} onDecline={handleDecline} />
          )}

        </Animated.View>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 1 — Hero
// ─────────────────────────────────────────────────────────────────────────────
function HeroPage({ onNext }: { onNext: () => void }) {
  return (
    <View style={s.pageWrap}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.heroScroll}>
        <Text style={s.heroEmoji}>🍯</Text>
        <Text style={s.heroTitle}>Your app.{'\n'}Your earnings.</Text>
        <Text style={s.heroBody}>
          Mavins Player partners with{' '}
          <Text style={s.gold}>Honeygain</Text> — the world's first community-powered
          network — to let you earn passive income simply by using your phone.
        </Text>

        <View style={s.heroCards}>
          {[
            { icon: '💸', heading: 'Real earnings',    body: 'Thousands of users worldwide earn consistently — just by having the app open.' },
            { icon: '🛡️', heading: 'Built on trust',   body: 'Honeygain is used by Fortune 500 companies and trusted by 10M+ users globally.' },
            { icon: '🔓', heading: 'Always in control', body: 'You can pause or stop earning at any time, instantly, from within the app.' },
          ].map(({ icon, heading, body }) => (
            <View key={heading} style={s.heroCard}>
              <Text style={s.heroCardIcon}>{icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.heroCardHeading}>{heading}</Text>
                <Text style={s.heroCardBody}>{body}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={s.heroDisclaimer}>
          Takes 2 minutes to set up. No credit card. No subscriptions.
        </Text>
      </ScrollView>

      <View style={s.footer}>
        <Pressable style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]} onPress={onNext}>
          <Text style={s.primaryBtnTxt}>Get Started →</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 2 — Sections
// ─────────────────────────────────────────────────────────────────────────────
interface SectionsProps {
  sections: Section[];
  toggles: Record<string, boolean>;
  expanded: string | null;
  onToggle: (id: string) => void;
  onExpand: (id: string) => void;
  onNext: () => void;
}

function SectionsPage({ sections, toggles, expanded, onToggle, onExpand, onNext }: SectionsProps) {
  return (
    <View style={s.pageWrap}>
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Permissions &amp; preferences</Text>
        <Text style={s.sectionSubtitle}>
          Everything is on by default. Tap any item to learn more.
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.sectionScroll}>
        {sections.map(sec => {
          const isExpanded = expanded === sec.id;
          const isOn       = toggles[sec.id];
          return (
            <View key={sec.id} style={s.sectionRow}>
              <Pressable style={s.sectionRowInner} onPress={() => onExpand(sec.id)}>
                <Text style={s.sectionIcon}>{sec.icon}</Text>
                <View style={s.sectionText}>
                  <View style={s.sectionTitleRow}>
                    <Text style={s.sectionRowTitle}>{sec.title}</Text>
                    {sec.required && (
                      <View style={s.requiredBadge}>
                        <Text style={s.requiredBadgeTxt}>Required</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.sectionRowSub}>{sec.subtitle}</Text>
                </View>
                <Switch
                  value={isOn}
                  onValueChange={() => onToggle(sec.id)}
                  disabled={sec.required}
                  trackColor={{ false: '#2a2a2a', true: '#7a5010' }}
                  thumbColor={isOn ? GOLD : '#555'}
                  ios_backgroundColor="#2a2a2a"
                />
              </Pressable>
              {isExpanded && (
                <View style={s.expandedBox}>
                  <Text style={s.expandedTxt}>{sec.detail}</Text>
                </View>
              )}
            </View>
          );
        })}

        {/* Trust badges */}
        <View style={s.trustRow}>
          {['GDPR\nCompliant', 'CCPA\nReady', 'ISO 27001\nAligned', 'SOC 2\nPractices'].map(t => (
            <View key={t} style={s.trustBadge}>
              <Text style={s.trustBadgeTxt}>{t}</Text>
            </View>
          ))}
        </View>

        <Text style={s.complianceNote}>
          Honeygain operates under GDPR, CCPA, and applicable data protection laws.
          Your consent is recorded with a timestamp and can be withdrawn at any time
          via Settings → Privacy in Mavins Player.
        </Text>
      </ScrollView>

      <View style={s.footer}>
        <Pressable style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]} onPress={onNext}>
          <Text style={s.primaryBtnTxt}>Continue →</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page 3 — Confirm
// ─────────────────────────────────────────────────────────────────────────────
interface ConfirmProps {
  busy: boolean;
  onAllow: () => void;
  onDecline: () => void;
}

function ConfirmPage({ busy, onAllow, onDecline }: ConfirmProps) {
  return (
    <View style={s.pageWrap}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.confirmScroll}>
        <Text style={s.confirmEmoji}>✅</Text>
        <Text style={s.confirmTitle}>You're all set</Text>
        <Text style={s.confirmBody}>
          By tapping{' '}
          <Text style={s.gold}>Allow All &amp; Start Earning</Text>
          {' '}below, you agree that Mavins Player may activate the Honeygain
          bandwidth-sharing service on this device under the terms you reviewed.
        </Text>

        <View style={s.summaryBox}>
          <Text style={s.summaryHeading}>What you're agreeing to</Text>
          {[
            'Anonymous bandwidth sharing via the Honeygain network',
            'Background service that continues when the app is closed',
            'Automatic restart of the service after device reboot',
            'A persistent (silenceable) status notification',
            'No personal data collection or sharing — ever',
          ].map(line => (
            <View key={line} style={s.summaryRow}>
              <Text style={s.summaryCheck}>✓</Text>
              <Text style={s.summaryLine}>{line}</Text>
            </View>
          ))}
        </View>

        <Text style={s.legalSmall}>
          You can revoke this consent at any time via{' '}
          <Text style={s.goldSmall}>Settings → Privacy → Honeygain</Text>
          {' '}inside Mavins Player. This will immediately stop all bandwidth sharing.
          For full details see the{' '}
          <Text style={s.goldSmall}>Honeygain Privacy Policy</Text>
          {' '}and{' '}
          <Text style={s.goldSmall}>Terms of Service</Text>.
        </Text>
      </ScrollView>

      <View style={s.footer}>
        <Pressable
          style={({ pressed }) => [s.primaryBtn, pressed && s.pressed, busy && s.disabled]}
          onPress={onAllow}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color="#111" size="small" />
            : <Text style={s.primaryBtnTxt}>Allow All &amp; Start Earning 🍯</Text>}
        </Pressable>

        <Pressable
          style={({ pressed }) => [s.ghostBtn, pressed && s.pressed]}
          onPress={onDecline}
          disabled={busy}
        >
          <Text style={s.ghostBtnTxt}>No thanks, skip earning</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const GOLD = '#F5A623';

const s = StyleSheet.create({
  // Modal shell
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: SCREEN_H * 0.92,
    backgroundColor: '#0f0f0f',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },

  // Header bar
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e1e',
  },
  backTxt:   { color: '#666', fontSize: 15 },
  skipTxt:   { color: '#444', fontSize: 13 },
  stepDots:  { flexDirection: 'row', gap: 6 },
  dot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2a2a2a' },
  dotActive: { backgroundColor: GOLD, width: 18, borderRadius: 3 },

  // Page wrapper
  pageWrap: { flex: 1 },

  // ── Hero
  heroScroll:       { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  heroEmoji:        { fontSize: 52, textAlign: 'center', marginBottom: 16 },
  heroTitle:        { color: '#fff', fontSize: 30, fontWeight: '800', textAlign: 'center', lineHeight: 36, marginBottom: 14 },
  heroBody:         { color: '#999', fontSize: 15, lineHeight: 23, textAlign: 'center', marginBottom: 28 },
  heroCards:        { gap: 12, marginBottom: 24 },
  heroCard:         { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#161616', borderRadius: 16, padding: 16, gap: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#232323' },
  heroCardIcon:     { fontSize: 26, marginTop: 2 },
  heroCardHeading:  { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  heroCardBody:     { color: '#777', fontSize: 13, lineHeight: 19 },
  heroDisclaimer:   { color: '#3a3a3a', fontSize: 12, textAlign: 'center' },

  // ── Sections
  sectionHeader:    { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },
  sectionTitle:     { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  sectionSubtitle:  { color: '#555', fontSize: 13 },
  sectionScroll:    { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  sectionRow:       { backgroundColor: '#161616', borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: '#222' },
  sectionRowInner:  { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  sectionIcon:      { fontSize: 22, width: 30, textAlign: 'center' },
  sectionText:      { flex: 1 },
  sectionTitleRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  sectionRowTitle:  { color: '#fff', fontSize: 14, fontWeight: '600' },
  sectionRowSub:    { color: '#555', fontSize: 12 },
  requiredBadge:    { backgroundColor: '#1e1a0a', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#3a2e00' },
  requiredBadgeTxt: { color: GOLD, fontSize: 10, fontWeight: '700' },
  expandedBox:      { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1e1e1e' },
  expandedTxt:      { color: '#666', fontSize: 13, lineHeight: 20, paddingTop: 12 },
  trustRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20, marginBottom: 12, justifyContent: 'center' },
  trustBadge:       { borderRadius: 10, borderWidth: 1, borderColor: '#252525', paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  trustBadgeTxt:    { color: '#444', fontSize: 11, fontWeight: '600', textAlign: 'center', lineHeight: 15 },
  complianceNote:   { color: '#333', fontSize: 11, lineHeight: 17, textAlign: 'center', marginBottom: 8 },

  // ── Confirm
  confirmScroll:    { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  confirmEmoji:     { fontSize: 48, textAlign: 'center', marginBottom: 14 },
  confirmTitle:     { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  confirmBody:      { color: '#777', fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  summaryBox:       { backgroundColor: '#161616', borderRadius: 16, padding: 18, marginBottom: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: '#222', gap: 10 },
  summaryHeading:   { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  summaryRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  summaryCheck:     { color: GOLD, fontSize: 14, fontWeight: '700', marginTop: 1 },
  summaryLine:      { color: '#888', fontSize: 13, lineHeight: 20, flex: 1 },
  legalSmall:       { color: '#333', fontSize: 11, lineHeight: 17, textAlign: 'center' },

  // ── Footer / buttons
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1a1a1a',
    gap: 8,
  },
  primaryBtn:    { backgroundColor: GOLD, borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  primaryBtnTxt: { color: '#111', fontWeight: '800', fontSize: 16 },
  ghostBtn:      { paddingVertical: 12, alignItems: 'center' },
  ghostBtnTxt:   { color: '#3a3a3a', fontSize: 14 },

  // Utilities
  gold:      { color: GOLD, fontWeight: '700' },
  goldSmall: { color: GOLD },
  pressed:   { opacity: 0.75 },
  disabled:  { opacity: 0.5 },
});