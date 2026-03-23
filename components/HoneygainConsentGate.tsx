// components/EarningsConsentGate.tsx
//
// Single-page consent modal — Mavins Player passive earnings.
// Shows once. Decision persisted in AsyncStorage — never shown again.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
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

interface Props { children: React.ReactNode }

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────
export default function HoneygainConsentGate({ children }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy]           = useState(false);
  const router                    = useRouter();

  const slideAnim = useRef(new Animated.Value(SCREEN_H)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.02, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const openModal = useCallback(() => {
    setShowModal(true);
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 55, friction: 13, useNativeDriver: true }),
      Animated.timing(fadeAnim,  { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [slideAnim, fadeAnim]);

  // ── On mount: request permissions then check stored decision ──────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try { await PermissionsAndroid.requestMultiple(ALL_PERMISSIONS as any); } catch (_) {}

      const stored = await AsyncStorage.getItem(STORAGE_KEY);

      if (stored === 'accepted') {
        try {
          await Honeygain.initialize();
          await Honeygain.start();
        } catch (e) { console.warn('[Honeygain] Silent restart:', e); }
      } else if (stored !== 'declined') {
        openModal();
      }
    })();
  }, [openModal]);

  // ── Allow ─────────────────────────────────────────────────────────────────
  const handleAllow = useCallback(async () => {
    setBusy(true);
    try {
      await Honeygain.initialize();
      await Honeygain.optIn();
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
    await AsyncStorage.setItem(STORAGE_KEY, 'declined');
    setShowModal(false);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Children render first, underneath everything */}
      {children}

      {/* Modal overlays on top with transparent background */}
      <Modal 
        visible={showModal} 
        transparent 
        animationType="none" 
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={styles.modalRoot}>
          {/* Backdrop - semi-transparent overlay */}
          <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
          
          {/* Sheet slides up from bottom */}
          <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
            {/* Handle pill */}
            <View style={styles.handle} />

            {/* Agreement text */}
            <Text style={styles.agreement}>
              By tapping <Text style={styles.gold}>Allow</Text>, you
              agree to our{' '}
              <Text style={styles.link} onPress={() => router.push('/(modals)/privacy')}>
                Privacy Policy
              </Text>
              ,{' '}
              <Text style={styles.link} onPress={() => router.push('/(modals)/terms')}>
                Terms &amp; Conditions
              </Text>
              {' '}and{' '}
              <Text style={styles.link} onPress={() => router.push('/(modals)/legal')}>
                Legal Notice
              </Text>
              .
            </Text>

            {/* Allow button */}
            <Animated.View style={[styles.btnWrap, { transform: [{ scale: pulseAnim }] }]}>
              <Pressable
                onPress={handleAllow}
                disabled={busy}
                style={({ pressed }) => [
                  pressed && styles.pressed, 
                  busy && styles.disabled, 
                  { width: '100%' }
                ]}
              >
                <LinearGradient
                  colors={['rgba(245,166,35,0.15)', 'rgba(245,166,35,0.05)', 'rgba(255,255,255,0.08)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtn}
                >
                  {busy
                    ? <ActivityIndicator color={GOLD} size="small" />
                    : <Text style={styles.primaryBtnTxt}>Allow</Text>}
                </LinearGradient>
              </Pressable>
            </Animated.View>

            {/* Decline button */}
            <Pressable onPress={handleDecline} style={styles.declineBtn}>
              <Text style={styles.declineTxt}>Not Now</Text>
            </Pressable>

          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const GOLD = '#F5A623';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end', // Sheet at bottom
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  sheet: {
    backgroundColor: '#0f0f0f',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    alignItems: 'center',
    // Add shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2a2a2a',
    marginBottom: 24,
  },
  agreement: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  btnWrap: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.45)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnTxt: {
    color: '#B8F400',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 1.2,
  },
  declineBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  declineTxt: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  // Utilities
  gold:    { color: GOLD, fontWeight: '600' },
  link:    { color: GOLD, textDecorationLine: 'underline' },
  pressed: { opacity: 0.75 },
  disabled:{ opacity: 0.5 },
});