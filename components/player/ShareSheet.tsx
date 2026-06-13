// components/player/ShareSheet.tsx
//
// Production-grade share sheet — Spotify/Apple Music aesthetic.
// A bottom-sheet overlay with:
//   • Blurred frosted glass backdrop
//   • Animated slide-up with spring physics
//   • Track card (artwork + title + artist)
//   • Share-to row: WhatsApp, Instagram, X/Twitter, Telegram, Copy Link, More
//   • Swipe-down to dismiss
//   • Haptic feedback on every action

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Dimensions,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import * as ExpoClipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { moderateScale, scale, verticalScale } from 'react-native-size-matters/extend';

import { triggerHaptic } from '@/helpers/haptics';
import { useTheme } from '@/contexts/ThemeContext';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareSheetProps {
  visible: boolean;
  onClose: () => void;
  track: {
    title: string;
    artist?: string;
    thumbnail?: string;
    videoId?: string;
    url?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.62;
const DISMISS_THRESHOLD = SHEET_HEIGHT * 0.22;
const SNAP_DURATION = 320;

// App deep-link share targets
interface ShareTarget {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  onPress: (url: string, text: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ICON SUB-COMPONENTS (inline SVG-like coloured icons)
// ─────────────────────────────────────────────────────────────────────────────

function WhatsAppIcon({ size }: { size: number }) {
  return (
    <View style={[iconWrap.base, { backgroundColor: '#25D366', width: size, height: size, borderRadius: size / 2 }]}>
      <MaterialCommunityIcons name="whatsapp" size={size * 0.55} color="#fff" />
    </View>
  );
}

function TelegramIcon({ size }: { size: number }) {
  return (
    <View style={[iconWrap.base, { backgroundColor: '#2AABEE', width: size, height: size, borderRadius: size / 2 }]}>
      <MaterialCommunityIcons name="send" size={size * 0.48} color="#fff" />
    </View>
  );
}

function XIcon({ size }: { size: number }) {
  return (
    <View style={[iconWrap.base, { backgroundColor: '#000', width: size, height: size, borderRadius: size / 2 }]}>
      <MaterialCommunityIcons name="twitter" size={size * 0.52} color="#fff" />
    </View>
  );
}

function InstagramIcon({ size }: { size: number }) {
  return (
    <View
      style={[
        iconWrap.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#E1306C',
        },
      ]}
    >
      <MaterialCommunityIcons name="instagram" size={size * 0.52} color="#fff" />
    </View>
  );
}

function CopyIcon({ size, color }: { size: number; color: string }) {
  return (
    <View style={[iconWrap.base, { backgroundColor: 'rgba(255,255,255,0.12)', width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name="copy-outline" size={size * 0.48} color={color} />
    </View>
  );
}

function MoreIcon({ size, color }: { size: number; color: string }) {
  return (
    <View style={[iconWrap.base, { backgroundColor: 'rgba(255,255,255,0.12)', width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name="ellipsis-horizontal" size={size * 0.48} color={color} />
    </View>
  );
}

const iconWrap = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARE TARGET ITEM
// ─────────────────────────────────────────────────────────────────────────────

function ShareTargetItem({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.88,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 10,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={targetStyles.wrapper}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        {icon}
        <Text style={targetStyles.label} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const targetStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    gap: verticalScale(7),
    width: scale(62),
  },
  label: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: moderateScale(11),
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.1,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// COPY LINK TOAST
// ─────────────────────────────────────────────────────────────────────────────

function CopyToast({ visible }: { visible: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(1400),
        Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Animated.View style={[toastStyles.wrap, { opacity }]} pointerEvents="none">
      <Ionicons name="checkmark-circle" size={moderateScale(16)} color="#4ADE80" />
      <Text style={toastStyles.text}>Link copied</Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: verticalScale(24),
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(6),
    backgroundColor: 'rgba(30,30,30,0.92)',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(9),
    borderRadius: moderateScale(24),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  text: {
    color: '#fff',
    fontSize: moderateScale(13),
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ShareSheet({ visible, onClose, track }: ShareSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const [copyToastVisible, setCopyToastVisible] = useState(false);

  // ── Animation values ──────────────────────────────────────────────────────
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // ── Shared URL ────────────────────────────────────────────────────────────
  const shareUrl = track.videoId
    ? `https://www.youtube.com/watch?v=${track.videoId}`
    : (track.url ?? '');

  const shareText = `${track.title}${track.artist ? ` · ${track.artist}` : ''}`;
  const shareMessage = `🎵 ${shareText}\n\n${shareUrl}`;

  // ── Open / close animation ────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      translateY.setValue(SHEET_HEIGHT);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 22,
          mass: 0.9,
          stiffness: 200,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SHEET_HEIGHT,
        duration: SNAP_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: SNAP_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [onClose]);

  // ── Swipe-down pan responder ──────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_THRESHOLD || g.vy > 0.6) {
          triggerHaptic();
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 220,
          }).start();
        }
      },
    }),
  ).current;

  // ── Share actions ─────────────────────────────────────────────────────────

  const openDeepLink = useCallback((url: string) => {
    triggerHaptic();
    Linking.canOpenURL(url)
      .then(can => {
        if (can) Linking.openURL(url);
        else {
          // Fallback to native share if app not installed
          Share.share({
            title: track.title,
            message: shareMessage,
          });
        }
      })
      .catch(() => {
        Share.share({ title: track.title, message: shareMessage });
      });
  }, [shareMessage, track.title]);

  const handleWhatsApp = useCallback(() => {
    triggerHaptic();
    const encoded = encodeURIComponent(shareMessage);
    openDeepLink(`whatsapp://send?text=${encoded}`);
  }, [shareMessage, openDeepLink]);

  const handleTelegram = useCallback(() => {
    triggerHaptic();
    const encoded = encodeURIComponent(shareMessage);
    openDeepLink(`tg://msg?text=${encoded}`);
  }, [shareMessage, openDeepLink]);

  const handleX = useCallback(() => {
    triggerHaptic();
    const encoded = encodeURIComponent(`${shareText} ${shareUrl}`);
    openDeepLink(`twitter://post?message=${encoded}`);
  }, [shareText, shareUrl, openDeepLink]);

  const handleInstagram = useCallback(() => {
    triggerHaptic();
    // Instagram doesn't support direct URL sharing; open stories if possible
    Linking.canOpenURL('instagram://').then(can => {
      if (can) Linking.openURL('instagram://');
      else Share.share({ title: track.title, message: shareMessage });
    });
  }, [shareMessage, track.title]);

  const handleCopyLink = useCallback(() => {
    triggerHaptic();
    ExpoClipboard.setStringAsync(shareUrl).catch(() => {});
    setCopyToastVisible(false);
    setTimeout(() => setCopyToastVisible(true), 10);
  }, [shareUrl]);

  const handleNativeShare = useCallback(() => {
    triggerHaptic();
    Share.share({
      title: track.title,
      message: Platform.OS === 'android' ? shareMessage : shareText,
      url: Platform.OS === 'ios' ? shareUrl : undefined,
    });
  }, [track.title, shareMessage, shareText, shareUrl]);

  // ── Icon size ─────────────────────────────────────────────────────────────
  const ICON_SIZE = scale(52);

  const targets = [
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      icon: <WhatsAppIcon size={ICON_SIZE} />,
      onPress: handleWhatsApp,
    },
    {
      key: 'telegram',
      label: 'Telegram',
      icon: <TelegramIcon size={ICON_SIZE} />,
      onPress: handleTelegram,
    },
    {
      key: 'x',
      label: 'X (Twitter)',
      icon: <XIcon size={ICON_SIZE} />,
      onPress: handleX,
    },
    {
      key: 'instagram',
      label: 'Instagram',
      icon: <InstagramIcon size={ICON_SIZE} />,
      onPress: handleInstagram,
    },
    {
      key: 'copy',
      label: 'Copy Link',
      icon: <CopyIcon size={ICON_SIZE} color={colors.text ?? '#fff'} />,
      onPress: handleCopyLink,
    },
    {
      key: 'more',
      label: 'More',
      icon: <MoreIcon size={ICON_SIZE} color={colors.text ?? '#fff'} />,
      onPress: handleNativeShare,
    },
  ];

  // ── Sheet background ──────────────────────────────────────────────────────
  // Deep near-black with slight warm tint — consistent with dark player aesthetic
  const sheetBg = isDark ? '#111110' : '#1A1918';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={dismiss}>
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: 'rgba(0,0,0,0.6)', opacity: backdropOpacity },
          ]}
        />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <Animated.View
        style={[
          sheetStyles.sheet,
          {
            backgroundColor: sheetBg,
            paddingBottom: insets.bottom + verticalScale(12),
            transform: [{ translateY }],
          },
        ]}
      >
        {/* Drag handle */}
        <View {...panResponder.panHandlers} style={sheetStyles.handleZone}>
          <View style={sheetStyles.handle} />
        </View>

        {/* Header */}
        <View style={sheetStyles.header}>
          <Text style={sheetStyles.headerTitle}>Share</Text>
          <TouchableOpacity
            onPress={dismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <View style={sheetStyles.closeBtn}>
              <Ionicons name="close" size={moderateScale(16)} color="rgba(255,255,255,0.7)" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Track card */}
        <View style={sheetStyles.trackCard}>
          {/* Artwork */}
          <View style={sheetStyles.artworkWrap}>
            {track.thumbnail ? (
              <Image
                source={{ uri: track.thumbnail }}
                style={sheetStyles.artwork}
                contentFit="cover"
              />
            ) : (
              <View style={[sheetStyles.artwork, sheetStyles.artworkFallback]}>
                <Ionicons name="musical-notes" size={moderateScale(28)} color="rgba(255,255,255,0.35)" />
              </View>
            )}
            {/* Subtle vinyl shimmer overlay */}
            <View style={sheetStyles.artworkShimmer} pointerEvents="none" />
          </View>

          {/* Meta */}
          <View style={sheetStyles.trackMeta}>
            <Text style={sheetStyles.trackTitle} numberOfLines={2}>
              {track.title}
            </Text>
            {!!track.artist && (
              <Text style={sheetStyles.trackArtist} numberOfLines={1}>
                {track.artist}
              </Text>
            )}
            {!!shareUrl && (
              <Text style={sheetStyles.trackUrl} numberOfLines={1}>
                {shareUrl.replace('https://', '')}
              </Text>
            )}
          </View>
        </View>

        {/* Divider */}
        <View style={sheetStyles.divider} />

        {/* Share targets */}
        <View style={sheetStyles.targetsRow}>
          {targets.map(t => (
            <ShareTargetItem
              key={t.key}
              icon={t.icon}
              label={t.label}
              onPress={t.onPress}
            />
          ))}
        </View>

        {/* Copy-link toast */}
        <CopyToast visible={copyToastVisible} />
      </Animated.View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const sheetStyles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: moderateScale(22),
    borderTopRightRadius: moderateScale(22),
    overflow: 'hidden',
    // Elevation for Android
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },

  handleZone: {
    alignItems: 'center',
    paddingTop: verticalScale(12),
    paddingBottom: verticalScale(4),
  },
  handle: {
    width: scale(36),
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(20),
    paddingBottom: verticalScale(14),
    paddingTop: verticalScale(2),
  },
  headerTitle: {
    color: '#fff',
    fontSize: moderateScale(17),
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  closeBtn: {
    width: scale(28),
    height: scale(28),
    borderRadius: scale(14),
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Track card ────────────────────────────────────────────────────────────
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(14),
    marginHorizontal: scale(20),
    marginBottom: verticalScale(18),
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: moderateScale(14),
    padding: scale(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  artworkWrap: {
    position: 'relative',
    borderRadius: moderateScale(10),
    overflow: 'hidden',
    // Tiny shadow to lift it
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 6,
  },
  artwork: {
    width: scale(58),
    height: scale(58),
    borderRadius: moderateScale(10),
  },
  artworkFallback: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Subtle glass overlay on the artwork
  artworkShimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: moderateScale(10),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },

  trackMeta: {
    flex: 1,
    gap: verticalScale(3),
  },
  trackTitle: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '700',
    letterSpacing: -0.1,
    lineHeight: moderateScale(19),
  },
  trackArtist: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: moderateScale(12),
    fontWeight: '500',
  },
  trackUrl: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: moderateScale(10),
    fontWeight: '400',
    marginTop: verticalScale(2),
  },

  // ── Row ───────────────────────────────────────────────────────────────────
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginHorizontal: scale(20),
    marginBottom: verticalScale(22),
  },

  targetsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: scale(10),
    paddingBottom: verticalScale(6),
  },
});