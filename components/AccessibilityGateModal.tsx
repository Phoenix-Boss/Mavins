// components/AccessibilityGateModal.tsx
import React, { useEffect, useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  Animated,
  AppState,
  AccessibilityInfo,
  Linking,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { triggerHaptic } from '@/helpers/haptics';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';
import { Pilot } from 'expo-pilot';

const ACCESSIBILITY_CHECK_KEY = '@mavin_accessibility_checked';
const ACCESSIBILITY_ENABLED_KEY = '@mavin_accessibility_enabled';
const PILOT_INITIALIZED_KEY = '@mavin_pilot_initialized';

interface AccessibilityGateModalProps {
  visible: boolean;
  onComplete: () => void;
}

export function AccessibilityGateModal({ visible, onComplete }: AccessibilityGateModalProps) {
  const { colors, isDark } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [pilotInitialized, setPilotInitialized] = useState(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const opacity = useRef(new Animated.Value(0)).current;
  const scale$ = useRef(new Animated.Value(0.92)).current;

  // Initialize Pilot when accessibility is enabled
  const initializePilot = async () => {
    try {
      if (!pilotInitialized) {
        await Pilot.initialize();
        setPilotInitialized(true);
        await AsyncStorage.setItem(PILOT_INITIALIZED_KEY, 'true');
        console.log('[Pilot] Initialized successfully');
      }
    } catch (error) {
      console.error('[Pilot] Initialization error:', error);
    }
  };

  // Animate in when visible
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 340,
          useNativeDriver: true,
        }),
        Animated.spring(scale$, {
          toValue: 1,
          tension: 70,
          friction: 14,
          useNativeDriver: true,
        }),
      ]).start();
      
      // Start checking accessibility status
      startChecking();
    } else {
      opacity.setValue(0);
      scale$.setValue(0.92);
      stopChecking();
    }
    
    return () => stopChecking();
  }, [visible, opacity, scale$]);

  // Start periodic checking
  const startChecking = () => {
    // Check immediately
    checkAccessibilityStatus();
    
    // Then check every 2 seconds
    checkIntervalRef.current = setInterval(() => {
      checkAccessibilityStatus();
    }, 2000);
  };

  // Stop periodic checking
  const stopChecking = () => {
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
  };

  // Check if accessibility service is enabled
  const checkAccessibilityStatus = async () => {
    try {
      if (Platform.OS === 'android') {
        const enabled = await AccessibilityInfo.isAccessibilityServiceEnabled();
        setIsEnabled(enabled);
        
        if (enabled) {
          // Accessibility is enabled! Initialize Pilot and complete
          await AsyncStorage.setItem(ACCESSIBILITY_ENABLED_KEY, 'true');
          await AsyncStorage.setItem(ACCESSIBILITY_CHECK_KEY, 'true');
          stopChecking();
          
          // Initialize Pilot before completing
          await initializePilot();
          onComplete();
        }
      }
    } catch (error) {
      console.error('[AccessibilityGate] Failed to check status:', error);
    }
  };

  // Open accessibility settings
  const handleEnable = async () => {
    triggerHaptic();
    setIsLoading(true);
    try {
      // Open accessibility settings
      await AccessibilityInfo.openAccessibilitySettings();
      // Mark that we've opened settings
      await AsyncStorage.setItem(ACCESSIBILITY_CHECK_KEY, 'true');
    } catch (error) {
      console.error('[AccessibilityGate] Failed to open settings:', error);
      // Fallback to general settings
      try {
        await Linking.openSettings();
      } catch (e) {
        console.error('[AccessibilityGate] Fallback settings failed:', e);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Listen for accessibility service changes while modal is visible
  useEffect(() => {
    if (!visible) return;

    const subscription = AccessibilityInfo.addEventListener(
      'accessibilityServiceChanged',
      async (isEnabled) => {
        if (isEnabled) {
          // User enabled it! Proceed.
          await AsyncStorage.setItem(ACCESSIBILITY_ENABLED_KEY, 'true');
          await AsyncStorage.setItem(ACCESSIBILITY_CHECK_KEY, 'true');
          stopChecking();
          await initializePilot();
          onComplete();
        }
      }
    );

    return () => subscription.remove();
  }, [visible, onComplete]);

  // Also check when app comes back to foreground
  useEffect(() => {
    if (!visible) return;

    const subscription = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        // Check immediately when returning to app
        await checkAccessibilityStatus();
      }
    });

    return () => subscription.remove();
  }, [visible]);

  // Check if Pilot was already initialized
  useEffect(() => {
    const checkPilotState = async () => {
      const initialized = await AsyncStorage.getItem(PILOT_INITIALIZED_KEY);
      if (initialized === 'true') {
        setPilotInitialized(true);
      }
    };
    checkPilotState();
  }, []);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <BlurView
          intensity={Platform.OS === 'ios' ? 90 : 100}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFillObject}
        />
        
        <Animated.View
          style={[
            styles.container,
            {
              backgroundColor: isDark ? colors.surface : colors.surface,
              borderColor: colors.borderGold,
              borderWidth: 0.5,
              transform: [{ scale: scale$ }],
              opacity,
            },
          ]}
        >
          <View style={[styles.topAccent, { backgroundColor: colors.gold }]} />

          <View style={[styles.iconRing, { 
            borderColor: `${colors.gold}60`,
            backgroundColor: `${colors.gold}12`
          }]}>
            <Ionicons 
              name="hand-left" 
              size={moderateScale(34)} 
              color={colors.gold} 
            />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            Unlock the Full Spectrum
          </Text>

          <Text style={[styles.description, { color: isDark ? colors.textSub : '#4A5568' }]}>
            Accessibility permissions unlock the full spectrum of Mavin Player's capabilities — 
            immersive gesture control, seamless overlay navigation, and precision media management.
          </Text>

          <View style={[styles.benefitsContainer, { borderColor: `${colors.gold}20` }]}>
            <View style={styles.benefitItem}>
              <View style={[styles.benefitDot, { backgroundColor: colors.gold }]} />
              <Text style={[styles.benefitText, { color: isDark ? colors.textSub : '#4A5568' }]}>
                Intuitive gesture-driven playback controls
              </Text>
            </View>
            <View style={styles.benefitItem}>
              <View style={[styles.benefitDot, { backgroundColor: colors.gold }]} />
              <Text style={[styles.benefitText, { color: isDark ? colors.textSub : '#4A5568' }]}>
                Persistent floating player overlay
              </Text>
            </View>
            <View style={styles.benefitItem}>
              <View style={[styles.benefitDot, { backgroundColor: colors.gold }]} />
              <Text style={[styles.benefitText, { color: isDark ? colors.textSub : '#4A5568' }]}>
                Advanced audio session management
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.enableButton,
              { backgroundColor: colors.gold },
              isLoading && styles.disabledButton,
            ]}
            onPress={handleEnable}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text style={[styles.enableText, { color: isDark ? '#000000' : '#000000' }]}>
              {isLoading ? 'Preparing...' : 'Enable Accessibility'}
            </Text>
          </TouchableOpacity>

          <Text style={[styles.footerNote, { color: colors.textMuted }]}>
            This permission is required to unlock the complete Mavin Player experience
          </Text>

          <View style={[styles.bottomAccent, { backgroundColor: colors.gold }]} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(20),
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  container: {
    width: width * 0.88,
    maxWidth: 400,
    borderRadius: moderateScale(28),
    overflow: 'hidden',
    paddingHorizontal: scale(28),
    paddingTop: verticalScale(8),
    paddingBottom: verticalScale(22),
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 40,
    elevation: 28,
    borderWidth: 0.5,
  },
  topAccent: {
    height: 3,
    width: '100%',
    marginBottom: verticalScale(18),
  },
  bottomAccent: {
    height: 2,
    width: '30%',
    marginTop: verticalScale(10),
    borderRadius: 2,
    opacity: 0.4,
  },
  iconRing: {
    width: moderateScale(80),
    height: moderateScale(80),
    borderRadius: moderateScale(40),
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(14),
  },
  title: {
    fontSize: moderateScale(24),
    fontWeight: '700',
    marginBottom: verticalScale(8),
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  description: {
    fontSize: moderateScale(14),
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: verticalScale(22),
    paddingHorizontal: scale(4),
    letterSpacing: 0.2,
  },
  benefitsContainer: {
    width: '100%',
    marginBottom: verticalScale(28),
    paddingVertical: verticalScale(14),
    paddingHorizontal: scale(16),
    borderWidth: 0.5,
    borderRadius: moderateScale(14),
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: verticalScale(8),
  },
  benefitDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: scale(12),
  },
  benefitText: {
    fontSize: moderateScale(13),
    lineHeight: 20,
    flex: 1,
    letterSpacing: 0.2,
  },
  enableButton: {
    width: '100%',
    paddingVertical: verticalScale(18),
    borderRadius: moderateScale(16),
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D4AF37',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  disabledButton: {
    opacity: 0.5,
    shadowOpacity: 0,
  },
  enableText: {
    fontSize: moderateScale(17),
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  footerNote: {
    fontSize: moderateScale(11),
    marginTop: verticalScale(14),
    textAlign: 'center',
    letterSpacing: 0.3,
    opacity: 0.7,
  },
});

export default AccessibilityGateModal;