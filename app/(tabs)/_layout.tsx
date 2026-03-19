// app/(tabs)/_layout.tsx

import React, { useRef, useEffect } from "react";
import { View, StyleSheet, TouchableOpacity, Text, Animated } from "react-native";
import { Tabs, useRouter, useSegments } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { moderateScale } from "react-native-size-matters/extend";
import FloatingPlayer from "@/components/FloatingPlayer";
import { triggerHaptic } from "@/helpers/haptics";
import { useGlobalUIState } from "@/contexts/GlobalUIStateContext";
import Svg, {
  Path, Circle, Rect, Defs, RadialGradient, Stop,
} from "react-native-svg";

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = {
  gold:        "#D4AF37",
  goldShimmer: "#E6C16A",
  goldGlow:    "#FFD700",
  inactive:    "#3A3A3A",
  background:  "#000000",
  surfaceDark: "#0A0A0A",
  border:      "rgba(212,175,55,0.15)",
};

const TAB_HEIGHT = 58;

// ─────────────────────────────────────────────────────────────────────────────
// Futuristic SVG icons
// Each has an active state (gold fill + glow) and inactive (muted stroke).
// ─────────────────────────────────────────────────────────────────────────────

interface IconProps { focused: boolean; size?: number }

function HomeIcon({ focused, size = 26 }: IconProps) {
  const c = focused ? COLORS.gold : COLORS.inactive;
  const sw = focused ? 1.6 : 1.4;
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      {focused && (
        <Defs>
          <RadialGradient id="hg" cx="50%" cy="50%" r="50%">
            <Stop offset="0%"   stopColor={COLORS.goldGlow} stopOpacity="0.25" />
            <Stop offset="100%" stopColor={COLORS.goldGlow} stopOpacity="0"    />
          </RadialGradient>
        </Defs>
      )}
      {focused && <Circle cx="13" cy="13" r="12" fill="url(#hg)" />}

      {/* House body */}
      <Path
        d="M13 4 L22 12 L20 12 L20 21 L6 21 L6 12 L4 12 Z"
        fill={focused ? COLORS.gold + "20" : "none"}
        stroke={c}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Door arch */}
      <Path
        d="M10 21 L10 16.5 Q10 14.5 13 14.5 Q16 14.5 16 16.5 L16 21"
        fill={focused ? COLORS.gold + "30" : "none"}
        stroke={c}
        strokeWidth={sw - 0.2}
        strokeLinecap="round"
      />
      {/* Apex dot */}
      <Circle cx="13" cy="12.2" r={focused ? 1.5 : 1.1} fill={c} />
    </Svg>
  );
}

function LibraryIcon({ focused, size = 26 }: IconProps) {
  const c = focused ? COLORS.gold : COLORS.inactive;
  const sw = focused ? 1.6 : 1.4;
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      {focused && (
        <Defs>
          <RadialGradient id="lg" cx="50%" cy="50%" r="50%">
            <Stop offset="0%"   stopColor={COLORS.goldGlow} stopOpacity="0.25" />
            <Stop offset="100%" stopColor={COLORS.goldGlow} stopOpacity="0"    />
          </RadialGradient>
        </Defs>
      )}
      {focused && <Circle cx="13" cy="13" r="12" fill="url(#lg)" />}

      {/* Shelf bars */}
      <Rect x="4" y="7"  width="10" height="2.2" rx="1.1" fill={c} />
      <Rect x="4" y="12" width="10" height="2.2" rx="1.1" fill={c} />
      <Rect x="4" y="17" width="10" height="2.2" rx="1.1" fill={c} />

      {/* Vinyl disc */}
      <Circle
        cx="20" cy="13" r="4.5"
        fill={focused ? COLORS.gold + "18" : "none"}
        stroke={c} strokeWidth={sw - 0.2}
      />
      <Circle
        cx="20" cy="13" r="2.4"
        fill="none"
        stroke={c} strokeWidth={sw - 0.6} strokeOpacity="0.45"
      />
      <Circle cx="20" cy="13" r={focused ? 1.2 : 0.9} fill={c} />
    </Svg>
  );
}

function SettingsIcon({ focused, size = 26 }: IconProps) {
  const c = focused ? COLORS.gold : COLORS.inactive;
  const sw = focused ? 1.6 : 1.4;

  // 6-tooth gear path computed around centre (13,13)
  const gearPath = (() => {
    const cx = 13, cy = 13, r = 7.2, toothH = 2.1, teeth = 6;
    const pts: string[] = [];
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2 - Math.PI / 2;
      const a1 = a0 + (Math.PI / teeth) * 0.52;
      const a2 = a0 + (Math.PI / teeth) * 0.78;
      const a3 = a0 + (Math.PI / teeth);
      const ix0 = cx + r * Math.cos(a0),             iy0 = cy + r * Math.sin(a0);
      const tx1 = cx + (r + toothH) * Math.cos(a1),  ty1 = cy + (r + toothH) * Math.sin(a1);
      const tx2 = cx + (r + toothH) * Math.cos(a2),  ty2 = cy + (r + toothH) * Math.sin(a2);
      const ix3 = cx + r * Math.cos(a3),              iy3 = cy + r * Math.sin(a3);
      pts.push(i === 0
        ? `M${ix0.toFixed(2)} ${iy0.toFixed(2)}`
        : `L${ix0.toFixed(2)} ${iy0.toFixed(2)}`);
      pts.push(`L${tx1.toFixed(2)} ${ty1.toFixed(2)}`);
      pts.push(`L${tx2.toFixed(2)} ${ty2.toFixed(2)}`);
      pts.push(`L${ix3.toFixed(2)} ${iy3.toFixed(2)}`);
    }
    return pts.join(" ") + " Z";
  })();

  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      {focused && (
        <Defs>
          <RadialGradient id="sg" cx="50%" cy="50%" r="50%">
            <Stop offset="0%"   stopColor={COLORS.goldGlow} stopOpacity="0.25" />
            <Stop offset="100%" stopColor={COLORS.goldGlow} stopOpacity="0"    />
          </RadialGradient>
        </Defs>
      )}
      {focused && <Circle cx="13" cy="13" r="12" fill="url(#sg)" />}

      <Path
        d={gearPath}
        fill={focused ? COLORS.gold + "20" : "none"}
        stroke={c} strokeWidth={sw} strokeLinejoin="round"
      />
      <Circle
        cx="13" cy="13" r="2.8"
        fill={focused ? COLORS.gold + "40" : "none"}
        stroke={c} strokeWidth={sw - 0.2}
      />
      <Circle cx="13" cy="13" r={focused ? 1.1 : 0.8} fill={c} />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab config — 3 tabs only
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  {
    name:  "index",
    title: "Home",
    Icon:  HomeIcon,
  },
  {
    name:  "library",
    title: "Library",
    Icon:  LibraryIcon,
  },
  {
    name:  "settings",
    title: "Settings",
    Icon:  SettingsIcon,
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Animated tab button
// ─────────────────────────────────────────────────────────────────────────────

interface TabButtonProps {
  tab: (typeof TABS)[number];
  focused: boolean;
  onPress: () => void;
}

function TabButton({ tab, focused, onPress }: TabButtonProps) {
  const scale   = useRef(new Animated.Value(1)).current;
  const labelOp = useRef(new Animated.Value(focused ? 1 : 0.45)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: focused ? 1.08 : 1,
        useNativeDriver: true,
        tension: 200,
        friction: 9,
      }),
      Animated.timing(labelOp, {
        toValue: focused ? 1 : 0.45,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused]);

  const { Icon } = tab;

  return (
    <TouchableOpacity
      style={styles.tabButton}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {/* Gold pill indicator above icon */}
      <Animated.View
        style={[
          styles.activePill,
          {
            opacity:    focused ? 1 : 0,
            transform:  [{ scaleX: focused ? 1 : 0 }],
          },
        ]}
      />

      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon focused={focused} size={26} />
      </Animated.View>

      <Animated.Text
        style={[styles.tabLabel, { opacity: labelOp }]}
      >
        {tab.title}
      </Animated.Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TabLayoutContent
// ─────────────────────────────────────────────────────────────────────────────

function TabLayoutContent() {
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const router   = useRouter();
  const segments = useSegments();
  const { resetNavigationState } = useGlobalUIState();
  const lastSegment = useRef(segments.join("/"));

  useEffect(() => {
    const current = segments.join("/");
    if (current !== lastSegment.current) {
      resetNavigationState();
      lastSegment.current = current;
    }
  }, [segments, resetNavigationState]);

  const isPlayerScreen = segments[0] === "(player)";

  // Determine active tab from current route segments
  const activeTabName = (() => {
    const seg = segments[segments.length - 1] ?? "index";
    if (TABS.some((t) => t.name === seg)) return seg;
    return "index";
  })();

  const handleTabPress = (tabName: string) => {
    triggerHaptic();
    router.push(tabName === "index" ? "/(tabs)" : `/(tabs)/${tabName}`);
  };

  return (
    <View style={styles.root}>
      {/* Expo Router tab navigator — all screens registered, tab bar hidden */}
      <Tabs
        screenOptions={{
          tabBarStyle:  { display: "none" },
          headerShown:  false,
        }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{ title: tab.title }}
          />
        ))}
      </Tabs>

      {/* Custom tab bar + floating player — hidden on player screen */}
      {!isPlayerScreen && (
        <>
          {/* FloatingPlayer positions itself above the tab bar via its own animated style */}
          <FloatingPlayer tabHeight={TAB_HEIGHT + safeAreaBottom} />

          {/* Custom tab bar */}
          <View
            style={[
              styles.tabBar,
              { height: TAB_HEIGHT + safeAreaBottom, paddingBottom: safeAreaBottom },
            ]}
          >
            {/* Background gradient */}
            <LinearGradient
              colors={[
                "rgba(10,10,10,0.97)",
                "rgba(8,8,8,0.99)",
                "#000000",
              ]}
              style={StyleSheet.absoluteFill}
            />

            {/* Gold hairline top border */}
            <View style={styles.topBorder} />

            {/* Tab buttons */}
            <View style={styles.tabButtonsRow}>
              {TABS.map((tab) => (
                <TabButton
                  key={tab.name}
                  tab={tab}
                  focused={activeTabName === tab.name}
                  onPress={() => handleTabPress(tab.name)}
                />
              ))}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export default function TabLayout() {
  return <TabLayoutContent />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: COLORS.background,
  },

  // ── Tab bar ────────────────────────────────────────────────────────────
  tabBar: {
    position: "absolute",
    left:     0,
    right:    0,
    bottom:   0,
    zIndex:   10,
    overflow: "hidden",
  },

  topBorder: {
    position:        "absolute",
    top:             0,
    left:            0,
    right:           0,
    height:          1,
    backgroundColor: COLORS.border,
  },

  tabButtonsRow: {
    flexDirection:  "row",
    justifyContent: "space-around",
    alignItems:     "center",
    flex:           1,
    paddingHorizontal: 8,
  },

  // ── Individual tab button ───────────────────────────────────────────────
  tabButton: {
    alignItems:     "center",
    justifyContent: "center",
    flex:           1,
    paddingTop:     10,
    paddingBottom:  4,
    position:       "relative",
  },

  // Gold pill above icon when focused
  activePill: {
    position:        "absolute",
    top:             0,
    width:           22,
    height:          2,
    borderRadius:    2,
    backgroundColor: COLORS.gold,
    shadowColor:     COLORS.gold,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   1,
    shadowRadius:    8,
    elevation:       6,
  },

  tabLabel: {
    fontSize:      moderateScale(10),
    fontWeight:    "600",
    color:         COLORS.goldShimmer,
    marginTop:     5,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
});