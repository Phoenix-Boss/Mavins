// contexts/AlertContext.tsx
import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useTheme } from './ThemeContext';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';
import { Ionicons } from '@expo/vector-icons';

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertConfig {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButton[];
}

interface AlertContextType {
  showAlert: (title: string, message?: string, buttons?: AlertButton[]) => void;
  hideAlert: () => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const useAlert = () => {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlert must be used within AlertProvider');
  return ctx;
};

export const AlertProvider = ({ children }: { children: ReactNode }) => {
  const { colors } = useTheme();
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    visible: false,
    title: '',
    message: '',
    buttons: [],
  });
  
  const opacity = useRef(new Animated.Value(0)).current;
  const scale$ = useRef(new Animated.Value(0.92)).current;

  const showAlert = useCallback((title: string, message?: string, buttons: AlertButton[] = [{ text: 'OK' }]) => {
    setAlertConfig({ visible: true, title, message, buttons });
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(scale$, { toValue: 1, tension: 100, friction: 14, useNativeDriver: true }),
    ]).start();
  }, []);

  const hideAlert = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(scale$, { toValue: 0.92, duration: 140, useNativeDriver: true }),
    ]).start(() => {
      setAlertConfig(prev => ({ ...prev, visible: false }));
    });
  }, []);

  const isDark = colors.background === '#000' || colors.background === '#0a0a0a';

  return (
    <AlertContext.Provider value={{ showAlert, hideAlert }}>
      {children}
      <Modal visible={alertConfig.visible} transparent animationType="none" onRequestClose={hideAlert}>
        <Animated.View style={[styles.overlay, { opacity }]}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={hideAlert} />
          <Animated.View
            style={[
              styles.alertBox,
              {
                backgroundColor: isDark ? colors.surface : '#ffffff',
                borderColor: `${colors.gold}35`,
                borderWidth: 0.5,
                transform: [{ scale: scale$ }],
              },
            ]}
          >
            <View style={[styles.topAccent, { backgroundColor: colors.gold }]} />
            <View style={[styles.iconRing, { borderColor: `${colors.gold}40`, backgroundColor: `${colors.gold}12` }]}>
              <Ionicons name="alert-circle-outline" size={moderateScale(26)} color={colors.gold} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>{alertConfig.title}</Text>
            {alertConfig.message ? (
              <Text style={[styles.message, { color: isDark ? colors.textMuted : '#555' }]}>
                {alertConfig.message}
              </Text>
            ) : null}
            <View style={[styles.divider, { backgroundColor: `${colors.gold}22` }]} />
            <View style={styles.buttonRow}>
              {alertConfig.buttons.map((btn, idx) => {
                const isDestructive = btn.style === 'destructive';
                const isCancel = btn.style === 'cancel';
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      styles.button,
                      idx < alertConfig.buttons.length - 1 && styles.buttonBorder,
                      isDestructive && styles.destructiveButton,
                    ]}
                    onPress={() => {
                      btn.onPress?.();
                      hideAlert();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        isDestructive && { color: '#e04444', fontWeight: '700' },
                        isCancel && { color: isDark ? colors.textMuted : '#888', fontWeight: '500' },
                        !isDestructive && !isCancel && { color: colors.gold, fontWeight: '700' },
                      ]}
                    >
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </AlertContext.Provider>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  alertBox: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 20,
  },
  topAccent: { height: 3, width: '100%' },
  iconRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 6, textAlign: 'center', paddingHorizontal: 16 },
  message: { fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 16, marginBottom: 20 },
  divider: { height: 0.5, width: '100%' },
  buttonRow: { flexDirection: 'row', width: '100%' },
  button: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBorder: {
    borderRightWidth: 0.5,
    borderRightColor: 'rgba(212,175,55,0.22)',
  },
  destructiveButton: { backgroundColor: 'rgba(220,60,60,0.08)' },
  buttonText: { fontSize: 14 },
});