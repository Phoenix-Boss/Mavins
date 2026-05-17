// contexts/ThemeContext.tsx
//
// Global theme context for light/dark mode support
// Detects device theme and allows user preference override
// ANDROID-ONLY: No iOS specific behaviors
//
// LIGHT MODE: Cinematic ambient feel - ancient sky blue with gold accents
// DARK MODE: Dark luxury - black base with gold accents

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useColorScheme, Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { triggerHaptic } from '@/helpers/haptics';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  // Backgrounds
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceHigh: string;
  
  // Text
  text: string;
  textSub: string;
  textMuted: string;
  textInverse: string;
  
  // Brand / Accent - Gold only (no purple)
  gold: string;
  goldDim: string;
  goldFill: string;
  goldFillStrong: string;
  
  // Borders
  border: string;
  borderGold: string;
  
  // Status / Feedback
  success: string;
  error: string;
  warning: string;
  info: string;
  
  // Player specific
  playerBackground: string;
  playerGradientStart: string;
  playerGradientMiddle: string;
  playerGradientEnd: string;
  sliderTrack: string;
  sliderThumb: string;
  
  // Tab bar
  tabBarBackground: string;
  tabBarActive: string;
  tabBarInactive: string;
  
  // Home screen watermark
  watermarkOpacity: number;
  watermarkTint?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Color Definitions
// ─────────────────────────────────────────────────────────────────────────────

// DARK MODE - Dark luxury
const DARK_THEME: ThemeColors = {
  background: '#000000',
  surface: '#0D0D0D',
  surfaceRaised: '#161616',
  surfaceHigh: '#1F1F1F',
  
  text: '#FFFFFF',
  textSub: '#888888',
  textMuted: '#4A4A4A',
  textInverse: '#000000',
  
  gold: '#D4AF37',
  goldDim: 'rgba(212, 175, 55, 0.4)',
  goldFill: 'rgba(212, 175, 55, 0.1)',
  goldFillStrong: 'rgba(212, 175, 55, 0.15)',
  
  border: 'rgba(255, 255, 255, 0.07)',
  borderGold: 'rgba(212, 175, 55, 0.22)',
  
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  
  playerBackground: '#000000',
  playerGradientStart: '#1A1A1A',
  playerGradientMiddle: '#0D0D0D',
  playerGradientEnd: '#000000',
  sliderTrack: 'rgba(255, 255, 255, 0.25)',
  sliderThumb: '#D4AF37',
  
  tabBarBackground: '#0D0D0D',
  tabBarActive: '#D4AF37',
  tabBarInactive: '#888888',
  
  watermarkOpacity: 0.08,
};

// LIGHT MODE - Cinematic Ambient (Ancient Sky Blue with Gold only)
const LIGHT_THEME: ThemeColors = {
  // Backgrounds - Soft sky blue
  background: '#E8F0F8',
  surface: '#FFFFFF',
  surfaceRaised: '#F8FAFE',
  surfaceHigh: '#F0F4FA',
  
  // Text - Deep navy
  text: '#1A2A3A',
  textSub: '#4A5568',
  textMuted: '#718096',
  textInverse: '#FFFFFF',
  
  // Brand / Accent - Gold only (dark goldenrod for visibility)
  gold: '#B8860B',
  goldDim: 'rgba(184, 134, 11, 0.4)',
  goldFill: 'rgba(184, 134, 11, 0.12)',
  goldFillStrong: 'rgba(184, 134, 11, 0.18)',
  
  // Borders - Gold-tinted
  border: 'rgba(0, 0, 0, 0.08)',
  borderGold: 'rgba(184, 134, 11, 0.25)',
  
  success: '#059669',
  error: '#DC2626',
  warning: '#D97706',
  info: '#3B82F6',
  
  // Player specific - Gold-tinted cinematic gradient (no purple)
  playerBackground: '#F0F4F8',
  playerGradientStart: '#F5E6D3',  // Soft gold/warm tone
  playerGradientMiddle: '#E8D5C8', // Warm beige
  playerGradientEnd: '#D4C4B0',    // Deeper warm gold
  sliderTrack: 'rgba(0, 0, 0, 0.12)',
  sliderThumb: '#B8860B',
  
  tabBarBackground: '#FFFFFF',
  tabBarActive: '#B8860B',
  tabBarInactive: '#718096',
  
  watermarkOpacity: 0.04,
};

// Storage key for theme preference
const THEME_STORAGE_KEY = 'app_theme_mode';

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

export interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      mode: 'dark',
      colors: DARK_THEME,
      isDark: true,
      setMode: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const deviceTheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const loadThemePreference = async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setModeState(saved);
        }
      } catch (error) {
        console.warn('[Theme] Failed to load theme preference:', error);
      } finally {
        setIsInitialized(true);
      }
    };
    loadThemePreference();
  }, []);

  const setMode = useCallback(async (newMode: ThemeMode) => {
    if (!isInitialized) return;
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch (error) {
      console.warn('[Theme] Failed to save theme preference:', error);
    }
  }, [isInitialized]);

  const toggleTheme = useCallback(() => {
    triggerHaptic();
    if (mode === 'dark') setMode('light');
    else if (mode === 'light') setMode('system');
    else setMode('dark');
  }, [mode, setMode]);

  const activeTheme = useMemo(() => {
    if (mode === 'system') {
      return deviceTheme === 'dark' ? DARK_THEME : LIGHT_THEME;
    }
    return mode === 'dark' ? DARK_THEME : LIGHT_THEME;
  }, [mode, deviceTheme]);

  const isDark = useMemo(() => {
    if (mode === 'system') return deviceTheme === 'dark';
    return mode === 'dark';
  }, [mode, deviceTheme]);

  const value: ThemeContextValue = {
    mode,
    colors: activeTheme,
    isDark,
    setMode,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper Hooks
// ─────────────────────────────────────────────────────────────────────────────

export const useThemedStyles = <T extends Record<string, any>>(
  styleCreator: (colors: ThemeColors) => T
): T => {
  const { colors } = useTheme();
  return useMemo(() => styleCreator(colors), [colors, styleCreator]);
};

export const useThemeColors = (): ThemeColors => {
  const { colors } = useTheme();
  return colors;
};
