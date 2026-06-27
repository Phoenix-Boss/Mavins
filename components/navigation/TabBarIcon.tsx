// components/TabBarIcon.tsx
/**
 * TabBarIcon — Futuristic custom SVG icons for the 4-tab navigation.
 *
 * Design language: dark luxury futurism — adapts to system theme.
 *   Active state   → gold filled glyph + soft gold radial glow ring
 *   Inactive state → hairline stroke glyph, muted colour, no glow
 *
 * DARK  → classic gold (#D4AF37) glyphs on black
 * LIGHT → dark goldenrod (#B8860B) glyphs on sky blue
 *
 *   home     → stylised house with angled roof ridge + centre dot
 *   search   → magnifying glass with handle and inner dot
 *   library  → three stacked horizontal bars with a vinyl disc inset
 *   settings → hexagonal gear with hollow centre
 */

import React, { useEffect, useRef } from "react";
import { Animated } from "react-native";
import Svg, {
  Path,
  Circle,
  Rect,
  G,
  Defs,
  RadialGradient,
  Stop,
} from "react-native-svg";
import { useTheme } from "@/contexts/ThemeContext";

// ── Shared props ──────────────────────────────────────────────────────────────

export interface TabIconProps {
  focused: boolean;
  size?: number;
}

// ── Animation wrapper ─────────────────────────────────────────────────────────

interface AnimatedIconProps {
  focused: boolean;
  children: () => React.ReactNode;
}

function AnimatedIcon({ focused, children }: AnimatedIconProps) {
  const scale   = useRef(new Animated.Value(focused ? 1.08 : 1)).current;
  const opacity = useRef(new Animated.Value(focused ? 1 : 0.55)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: focused ? 1.08 : 1,
        useNativeDriver: true,
        tension: 180,
        friction: 8,
      }),
      Animated.timing(opacity, {
        toValue: focused ? 1 : 0.55,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused]);

  return (
    <Animated.View style={{ transform: [{ scale }], opacity }}>
      {children()}
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HomeIcon
// ─────────────────────────────────────────────────────────────────────────────

export function HomeIcon({ focused, size = 26 }: TabIconProps) {
  const { colors, isDark } = useTheme();

  const gold      = colors.gold;
  const goldGlow  = isDark ? "#FFD700" : "#D4A017";
  const inactive  = colors.tabBarInactive;
  const color     = focused ? gold    : inactive;
  const strokeW   = focused ? 1.6     : 1.4;
  const fillAlpha = isDark ? "22"     : "18";
  const doorAlpha = isDark ? "33"     : "28";
  const glowId    = "homeGlow";

  return (
    <AnimatedIcon focused={focused}>
      {() => (
        <Svg width={size} height={size} viewBox="0 0 26 26">
          {focused && (
            <Defs>
              <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
                <Stop offset="0%"   stopColor={goldGlow} stopOpacity="0.28" />
                <Stop offset="100%" stopColor={goldGlow} stopOpacity="0"    />
              </RadialGradient>
            </Defs>
          )}

          {focused && (
            <Circle cx="13" cy="13" r="12" fill={`url(#${glowId})`} />
          )}

          {/* Roof */}
          <Path
            d="M13 4 L22 12 L20 12 L20 21 L6 21 L6 12 L4 12 Z"
            fill={focused ? gold + fillAlpha : "none"}
            stroke={color}
            strokeWidth={strokeW}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Door arch */}
          <Path
            d="M10 21 L10 16 Q10 14 13 14 Q16 14 16 16 L16 21"
            fill={focused ? gold + doorAlpha : "none"}
            stroke={color}
            strokeWidth={strokeW - 0.2}
            strokeLinecap="round"
          />

          {/* Centre apex dot */}
          <Circle cx="13" cy="12.5" r={focused ? 1.4 : 1.1} fill={color} />
        </Svg>
      )}
    </AnimatedIcon>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchIcon
// ─────────────────────────────────────────────────────────────────────────────

export function SearchIcon({ focused, size = 26 }: TabIconProps) {
  const { colors, isDark } = useTheme();

  const gold      = colors.gold;
  const goldGlow  = isDark ? "#FFD700" : "#D4A017";
  const inactive  = colors.tabBarInactive;
  const color     = focused ? gold    : inactive;
  const strokeW   = focused ? 1.6     : 1.4;
  const glowId    = "searchGlow";

  return (
    <AnimatedIcon focused={focused}>
      {() => (
        <Svg width={size} height={size} viewBox="0 0 26 26">
          {focused && (
            <Defs>
              <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
                <Stop offset="0%"   stopColor={goldGlow} stopOpacity="0.28" />
                <Stop offset="100%" stopColor={goldGlow} stopOpacity="0"    />
              </RadialGradient>
            </Defs>
          )}

          {focused && (
            <Circle cx="13" cy="13" r="12" fill={`url(#${glowId})`} />
          )}

          {/* Magnifying glass body */}
          <Circle
            cx="13.5"
            cy="13.5"
            r="5.5"
            fill={focused ? gold + "18" : "none"}
            stroke={color}
            strokeWidth={strokeW}
          />

          {/* Magnifying glass handle */}
          <Path
            d="M18 18 L23 23"
            stroke={color}
            strokeWidth={strokeW + 0.4}
            strokeLinecap="round"
          />

          {/* Small decorative dot inside */}
          <Circle
            cx="13.5"
            cy="13.5"
            r={focused ? 1.2 : 0.8}
            fill={color}
            opacity={focused ? 1 : 0.4}
          />
        </Svg>
      )}
    </AnimatedIcon>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LibraryIcon
// ─────────────────────────────────────────────────────────────────────────────

export function LibraryIcon({ focused, size = 26 }: TabIconProps) {
  const { colors, isDark } = useTheme();

  const gold      = colors.gold;
  const goldGlow  = isDark ? "#FFD700" : "#D4A017";
  const inactive  = colors.tabBarInactive;
  const color     = focused ? gold    : inactive;
  const strokeW   = focused ? 1.6     : 1.4;
  const discAlpha = isDark ? "18"     : "14";
  const glowId    = "libGlow";

  return (
    <AnimatedIcon focused={focused}>
      {() => (
        <Svg width={size} height={size} viewBox="0 0 26 26">
          {focused && (
            <Defs>
              <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
                <Stop offset="0%"   stopColor={goldGlow} stopOpacity="0.28" />
                <Stop offset="100%" stopColor={goldGlow} stopOpacity="0"    />
              </RadialGradient>
            </Defs>
          )}

          {focused && (
            <Circle cx="13" cy="13" r="12" fill={`url(#${glowId})`} />
          )}

          {/* Shelf bars */}
          <Rect x="4" y="7"  width="10" height="2.2" rx="1.1" fill={color} />
          <Rect x="4" y="12" width="10" height="2.2" rx="1.1" fill={color} />
          <Rect x="4" y="17" width="10" height="2.2" rx="1.1" fill={color} />

          {/* Vinyl disc */}
          <Circle
            cx="20" cy="13" r="4.5"
            fill={focused ? gold + discAlpha : "none"}
            stroke={color}
            strokeWidth={strokeW - 0.2}
          />
          {/* Groove ring */}
          <Circle
            cx="20" cy="13" r="2.4"
            fill="none"
            stroke={color}
            strokeWidth={strokeW - 0.6}
            strokeOpacity="0.5"
          />
          {/* Centre spindle */}
          <Circle cx="20" cy="13" r={focused ? 1.2 : 0.9} fill={color} />
        </Svg>
      )}
    </AnimatedIcon>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingsIcon
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsIcon({ focused, size = 26 }: TabIconProps) {
  const { colors, isDark } = useTheme();

  const gold      = colors.gold;
  const goldGlow  = isDark ? "#FFD700" : "#D4A017";
  const inactive  = colors.tabBarInactive;
  const color     = focused ? gold    : inactive;
  const strokeW   = focused ? 1.6     : 1.4;
  const bodyAlpha = isDark ? "22"     : "18";
  const ringAlpha = isDark ? "44"     : "38";
  const glowId    = "setGlow";

  // 6-tooth gear path around (13,13)
  const gearPath = (() => {
    const cx = 13, cy = 13, r = 7.2, toothH = 2, toothW = 0.9;
    const teeth = 6;
    const pts: string[] = [];
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2 - Math.PI / 2;
      const a1 = a0 + (Math.PI / teeth) * 0.55;
      const a2 = a0 + (Math.PI / teeth) * 0.75;
      const a3 = a0 + (Math.PI / teeth);
      const ix0 = cx + r * Math.cos(a0),             iy0 = cy + r * Math.sin(a0);
      const tx1 = cx + (r + toothH) * Math.cos(a1 - toothW * 0.15),
            ty1 = cy + (r + toothH) * Math.sin(a1 - toothW * 0.15);
      const tx2 = cx + (r + toothH) * Math.cos(a2 + toothW * 0.15),
            ty2 = cy + (r + toothH) * Math.sin(a2 + toothW * 0.15);
      const ix3 = cx + r * Math.cos(a3),             iy3 = cy + r * Math.sin(a3);
      if (i === 0) pts.push(`M${ix0.toFixed(2)} ${iy0.toFixed(2)}`);
      else         pts.push(`L${ix0.toFixed(2)} ${iy0.toFixed(2)}`);
      pts.push(`L${tx1.toFixed(2)} ${ty1.toFixed(2)}`);
      pts.push(`L${tx2.toFixed(2)} ${ty2.toFixed(2)}`);
      pts.push(`L${ix3.toFixed(2)} ${iy3.toFixed(2)}`);
    }
    pts.push("Z");
    return pts.join(" ");
  })();

  return (
    <AnimatedIcon focused={focused}>
      {() => (
        <Svg width={size} height={size} viewBox="0 0 26 26">
          {focused && (
            <Defs>
              <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
                <Stop offset="0%"   stopColor={goldGlow} stopOpacity="0.28" />
                <Stop offset="100%" stopColor={goldGlow} stopOpacity="0"    />
              </RadialGradient>
            </Defs>
          )}

          {focused && (
            <Circle cx="13" cy="13" r="12" fill={`url(#${glowId})`} />
          )}

          {/* Gear body */}
          <Path
            d={gearPath}
            fill={focused ? gold + bodyAlpha : "none"}
            stroke={color}
            strokeWidth={strokeW}
            strokeLinejoin="round"
          />

          {/* Centre ring */}
          <Circle
            cx="13" cy="13" r="2.8"
            fill={focused ? gold + ringAlpha : "none"}
            stroke={color}
            strokeWidth={strokeW - 0.2}
          />

          {/* Centre dot */}
          <Circle cx="13" cy="13" r={focused ? 1.1 : 0.8} fill={color} />
        </Svg>
      )}
    </AnimatedIcon>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy TabBarIcon — kept for backward compat
// ─────────────────────────────────────────────────────────────────────────────

import Ionicons from "@expo/vector-icons/Ionicons";
import { type IconProps } from "@expo/vector-icons/build/createIconSet";
import { type ComponentProps } from "react";

export function TabBarIcon({
  style,
  ...rest
}: IconProps<ComponentProps<typeof Ionicons>["name"]>) {
  return (
    <Ionicons
      size={25}
      style={[{ marginBottom: -3 }, style]}
      {...rest}
    />
  );
}