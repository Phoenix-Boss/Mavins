// components/player/ShareSheet.tsx
//
// Spotify/BandLab-grade share sheet overlay
// Features:
//   • Slide-up bottom sheet with spring animation + swipe-to-dismiss
//   • Song preview card (artwork + title + artist)
//   • Theme selector — coloured gradient swatches (like Spotify share)
//   • Caption text editor with character count (like BandLab)
//   • Share-to row: WhatsApp, Telegram, X, Instagram, Copy Link, More
//   • Haptic feedback on every interaction
//   • Fully theme-aware (light/dark via useTheme)

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.82;
const DISMISS_THRESHOLD = SHEET_HEIGHT * 0.18;
const SNAP_DURATION = 300;
const CAPTION_MAX = 280;

// Theme swatches — gradient pairs for the card preview background
interface ThemeSwatch {
  key: string;
  colors: [string, string, ...string[]];
  label: string;
}

const THEME_SWATCHES: ThemeSwatch[] = [
  { key: 'midnight', colors: ['#0f0c29', '#302b63', '#24243e'], label: 'Midnight' },
  { key: 'ember',    colors: ['#232526', '#414345'],             label: 'Carbon' },
  { key: 'gold',     colors: ['#5c3d0f', '#c8862a', '#7b4f12'], label: 'Gold' },
  { key: 'ocean',    colors: ['#0f2027', '#203a43', '#2c5364'], label: 'Ocean' },
  { key: 'rose',     colors: ['#3a0d20', '#b5294e', '#3a0d20'], label: 'Rose' },
  { key: 'forest',   colors: ['#0a2118', '#1e5631', '#0a2118'], label: 'Forest' },
  { key: 'violet',   colors: ['#1a0533', '#6c1fa3', '#1a0533'], label: 'Violet' },
];

// ─────────────────────────────────────────────────────────────────────────────
// ICON COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

const ICON_SIZE = scale(50);

function IconCircle({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <View style={[iconStyles.circle, { backgroundColor: bg, width: ICON_SIZE, height: ICON_SIZE, borderRadius: ICON_SIZE / 2 }]}>
      {children}
    </View>
  );
}

const iconStyles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARE TARGET ITEM
// ─────────────────────────────────────────────────────────────────────────────

function ShareTargetItem({
  icon, label, onPress,
}: { icon: React.ReactNode; label: string; onPress: () => void }) {
  const scale_ = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={{ transform: [{ scale: scale_ }] }}>
      <TouchableOpacity
        style={targetStyles.wrapper}
        activeOpacity={1}
        onPress={onPress}
        onPressIn={() =>
          Animated.spring(scale_, { toValue: 0.87, useNativeDriver: true, speed: 30, bounciness: 6 }).start()
        }
        onPressOut={() =>
          Animated.spring(scale_, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }).start()
        }
      >
        {icon}
        <Text style={targetStyles.label} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const targetStyles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: verticalScale(6), width: scale(58) },
  label: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: moderateScale(10.5),
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.1,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// COPY TOAST
// ─────────────────────────────────────────────────────────────────────────────

function CopyToast({ visible }: { visible: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.delay(1400),
        Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Animated.View style={[toastStyles.wrap, { opacity }]} pointerEvents="none">
      <Ionicons name="checkmark-circle" size={moderateScale(15)} color="#4ADE80" />
      <Text style={toastStyles.text}>Link copied</Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: verticalScale(20),
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(6),
    backgroundColor: 'rgba(20,20,20,0.94)',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(9),
    borderRadius: moderateScale(22),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  text: { color: '#fff', fontSize: moderateScale(13), fontWeight: '600' },
});

// ─────────────────────────────────────────────────────────────────────────────
// SONG PREVIEW CARD  (shown inside the selected gradient theme)
// ─────────────────────────────────────────────────────────────────────────────

function SongPreviewCard({
  track,
  themeSwatch,
  caption,
}: {
  track: ShareSheetProps['track'];
  themeSwatch: ThemeSwatch;
  caption: string;
}) {
  return (
    <LinearGradient
      colors={themeSwatch.colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={previewStyles.card}
    >
      {/* Artwork */}
      <View style={previewStyles.artworkWrap}>
        {track.thumbnail ? (
          <Image
            source={{ uri: track.thumbnail }}
            style={previewStyles.artwork}
            contentFit="cover"
          />
        ) : (
          <View style={[previewStyles.artwork, previewStyles.artworkFallback]}>
            <Ionicons name="musical-notes" size={moderateScale(32)} color="rgba(255,255,255,0.4)" />
          </View>
        )}
        {/* Glass border on artwork */}
        <View style={previewStyles.artworkBorder} pointerEvents="none" />
      </View>

      {/* Track info */}
      <Text style={previewStyles.title} numberOfLines={2}>{track.title}</Text>
      {!!track.artist && (
        <Text style={previewStyles.artist} numberOfLines={1}>{track.artist}</Text>
      )}

      {/* Caption preview */}
      {!!caption && (
        <Text style={previewStyles.caption} numberOfLines={3}>{caption}</Text>
      )}

      {/* Branding pill */}
      <View style={previewStyles.brandPill}>
        <Ionicons name="musical-note" size={moderateScale(10)} color="rgba(255,255,255,0.7)" />
        <Text style={previewStyles.brandText}>Mavin</Text>
      </View>
    </LinearGradient>
  );
}

const CARD_W = SCREEN_WIDTH - scale(40);
const CARD_H = CARD_W * 0.72;

const previewStyles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: moderateScale(18),
    alignItems: 'center',
    justifyContent: 'center',
    padding: scale(16),
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
  },
  artworkWrap: {
    position: 'relative',
    borderRadius: moderateScale(12),
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    marginBottom: verticalScale(10),
  },
  artwork: {
    width: scale(80),
    height: scale(80),
    borderRadius: moderateScale(12),
  },
  artworkFallback: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkBorder: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: moderateScale(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  title: {
    color: '#fff',
    fontSize: moderateScale(15),
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.2,
    lineHeight: moderateScale(20),
  },
  artist: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(12),
    fontWeight: '500',
    textAlign: 'center',
    marginTop: verticalScale(3),
  },
  caption: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: moderateScale(11),
    fontWeight: '400',
    textAlign: 'center',
    marginTop: verticalScale(8),
    lineHeight: moderateScale(16),
    fontStyle: 'italic',
  },
  brandPill: {
    position: 'absolute',
    bottom: scale(10),
    right: scale(12),
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(3),
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: scale(8),
    paddingVertical: verticalScale(3),
    borderRadius: scale(20),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  brandText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: moderateScale(9),
    fontWeight: '600',
    letterSpacing: 0.4,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// THEME SWATCH PICKER
// ─────────────────────────────────────────────────────────────────────────────

function ThemePicker({
  selected,
  onSelect,
}: { selected: string; onSelect: (key: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={swatchStyles.row}
    >
      {THEME_SWATCHES.map(sw => (
        <TouchableOpacity
          key={sw.key}
          onPress={() => { triggerHaptic(); onSelect(sw.key); }}
          activeOpacity={0.8}
          style={swatchStyles.item}
        >
          <LinearGradient
            colors={sw.colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              swatchStyles.swatch,
              selected === sw.key && swatchStyles.swatchSelected,
            ]}
          />
          <Text style={[
            swatchStyles.label,
            selected === sw.key && swatchStyles.labelSelected,
          ]}>
            {sw.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const swatchStyles = StyleSheet.create({
  row: { paddingHorizontal: scale(20), gap: scale(12), alignItems: 'center' },
  item: { alignItems: 'center', gap: verticalScale(5) },
  swatch: {
    width: scale(38),
    height: scale(38),
    borderRadius: scale(10),
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: '#fff',
    transform: [{ scale: 1.12 }],
  },
  label: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: moderateScale(9),
    fontWeight: '500',
  },
  labelSelected: {
    color: '#fff',
    fontWeight: '700',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ShareSheet({ visible, onClose, track }: ShareSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  // ── Local state ───────────────────────────────────────────────────────────
  const [caption, setCaption] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<string>(THEME_SWATCHES[0].key);
  const [copyToastVisible, setCopyToastVisible] = useState(false);

  const currentSwatch = THEME_SWATCHES.find(s => s.key === selectedTheme) ?? THEME_SWATCHES[0];

  // ── Animation values ──────────────────────────────────────────────────────
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // ── Shared URL / text ──────────────────────────────────────────────────────
  const shareUrl = track.videoId
    ? `https://www.youtube.com/watch?v=${track.videoId}`
    : (track.url ?? '');

  const shareText = `${track.title}${track.artist ? ` · ${track.artist}` : ''}`;
  const shareMessage = caption
    ? `${caption}\n\n🎵 ${shareText}\n${shareUrl}`
    : `🎵 ${shareText}\n\n${shareUrl}`;

  // ── Open / close ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setCaption('');
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
          duration: 250,
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

  // ── Swipe-down pan ────────────────────────────────────────────────────────
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
        else Share.share({ title: track.title, message: shareMessage });
      })
      .catch(() => Share.share({ title: track.title, message: shareMessage }));
  }, [shareMessage, track.title]);

  const handleWhatsApp = useCallback(() => {
    openDeepLink(`whatsapp://send?text=${encodeURIComponent(shareMessage)}`);
  }, [shareMessage, openDeepLink]);

  const handleTelegram = useCallback(() => {
    openDeepLink(`tg://msg?text=${encodeURIComponent(shareMessage)}`);
  }, [shareMessage, openDeepLink]);

  const handleX = useCallback(() => {
    openDeepLink(`twitter://post?message=${encodeURIComponent(`${shareText} ${shareUrl}`)}`);
  }, [shareText, shareUrl, openDeepLink]);

  const handleInstagram = useCallback(() => {
    triggerHaptic();
    Linking.canOpenURL('instagram://').then(can => {
      if (can) Linking.openURL('instagram://');
      else Share.share({ title: track.title, message: shareMessage });
    });
  }, [shareMessage, track.title]);

  const handleCopyLink = useCallback(() => {
    triggerHaptic();
    Clipboard.setString(shareUrl);
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

  // ── Sheet background ──────────────────────────────────────────────────────
  const sheetBg = isDark ? '#0e0e0f' : '#111113';

  const targets = [
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      icon: <IconCircle bg="#25D366"><MaterialCommunityIcons name="whatsapp" size={ICON_SIZE * 0.52} color="#fff" /></IconCircle>,
      onPress: handleWhatsApp,
    },
    {
      key: 'telegram',
      label: 'Telegram',
      icon: <IconCircle bg="#2AABEE"><MaterialCommunityIcons name="send" size={ICON_SIZE * 0.46} color="#fff" /></IconCircle>,
      onPress: handleTelegram,
    },
    {
      key: 'x',
      label: 'X',
      icon: <IconCircle bg="#000"><MaterialCommunityIcons name="twitter" size={ICON_SIZE * 0.5} color="#fff" /></IconCircle>,
      onPress: handleX,
    },
    {
      key: 'instagram',
      label: 'Instagram',
      icon: <IconCircle bg="#E1306C"><MaterialCommunityIcons name="instagram" size={ICON_SIZE * 0.5} color="#fff" /></IconCircle>,
      onPress: handleInstagram,
    },
    {
      key: 'copy',
      label: 'Copy Link',
      icon: <IconCircle bg="rgba(255,255,255,0.12)"><Ionicons name="copy-outline" size={ICON_SIZE * 0.46} color="#fff" /></IconCircle>,
      onPress: handleCopyLink,
    },
    {
      key: 'more',
      label: 'More',
      icon: <IconCircle bg="rgba(255,255,255,0.12)"><Ionicons name="ellipsis-horizontal" size={ICON_SIZE * 0.46} color="#fff" /></IconCircle>,
      onPress: handleNativeShare,
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      {/* Dim backdrop */}
      <TouchableWithoutFeedback onPress={dismiss}>
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: 'rgba(0,0,0,0.72)', opacity: backdropOpacity },
          ]}
        />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={sheetStyles.kvWrapper}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            sheetStyles.sheet,
            {
              backgroundColor: sheetBg,
              paddingBottom: insets.bottom + verticalScale(10),
              transform: [{ translateY }],
            },
          ]}
        >
          {/* Drag handle zone */}
          <View {...panResponder.panHandlers} style={sheetStyles.handleZone}>
            <View style={sheetStyles.handle} />
          </View>

          {/* Header */}
          <View style={sheetStyles.header}>
            <Text style={sheetStyles.headerTitle}>Share</Text>
            <TouchableOpacity onPress={dismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <View style={sheetStyles.closeBtn}>
                <Ionicons name="close" size={moderateScale(15)} color="rgba(255,255,255,0.7)" />
              </View>
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={sheetStyles.scrollContent}
          >
            {/* ── Song preview card ── */}
            <View style={sheetStyles.cardWrapper}>
              <SongPreviewCard
                track={track}
                themeSwatch={currentSwatch}
                caption={caption}
              />
            </View>

            {/* ── Section: Theme ── */}
            <View style={sheetStyles.sectionHeader}>
              <Text style={sheetStyles.sectionLabel}>Theme</Text>
            </View>
            <ThemePicker selected={selectedTheme} onSelect={setSelectedTheme} />

            {/* ── Section: Caption ── */}
            <View style={sheetStyles.sectionHeader}>
              <Text style={sheetStyles.sectionLabel}>Caption</Text>
              <Text style={[
                sheetStyles.charCount,
                caption.length > CAPTION_MAX * 0.85 && sheetStyles.charCountWarn,
                caption.length >= CAPTION_MAX && sheetStyles.charCountOver,
              ]}>
                {caption.length}/{CAPTION_MAX}
              </Text>
            </View>
            <View style={sheetStyles.captionWrap}>
              <TextInput
                style={sheetStyles.captionInput}
                placeholder="Add a caption…"
                placeholderTextColor="rgba(255,255,255,0.28)"
                multiline
                maxLength={CAPTION_MAX}
                value={caption}
                onChangeText={setCaption}
                selectionColor="rgba(255,255,255,0.5)"
                returnKeyType="done"
                blurOnSubmit
              />
            </View>

            {/* ── Divider ── */}
            <View style={sheetStyles.divider} />

            {/* ── Share targets ── */}
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
          </ScrollView>

          <CopyToast visible={copyToastVisible} />
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const sheetStyles = StyleSheet.create({
  kvWrapper: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: moderateScale(24),
    borderTopRightRadius: moderateScale(24),
    overflow: 'hidden',
    elevation: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    maxHeight: SHEET_HEIGHT,
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
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(20),
    paddingBottom: verticalScale(12),
    paddingTop: verticalScale(2),
  },
  headerTitle: {
    color: '#fff',
    fontSize: moderateScale(17),
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: scale(28),
    height: scale(28),
    borderRadius: scale(14),
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollContent: {
    paddingBottom: verticalScale(8),
  },

  // Song preview card
  cardWrapper: {
    alignItems: 'center',
    paddingHorizontal: scale(20),
    marginBottom: verticalScale(18),
  },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(20),
    marginBottom: verticalScale(10),
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: moderateScale(11),
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  charCount: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: moderateScale(11),
    fontWeight: '500',
  },
  charCountWarn: {
    color: '#F59E0B',
  },
  charCountOver: {
    color: '#EF4444',
  },

  // Caption editor
  captionWrap: {
    marginHorizontal: scale(20),
    marginBottom: verticalScale(18),
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: moderateScale(14),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(10),
    minHeight: verticalScale(72),
  },
  captionInput: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '400',
    lineHeight: moderateScale(20),
    minHeight: verticalScale(52),
    textAlignVertical: 'top',
  },

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginHorizontal: scale(20),
    marginBottom: verticalScale(20),
  },

  // Share targets
  targetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    paddingHorizontal: scale(12),
    rowGap: verticalScale(14),
    paddingBottom: verticalScale(4),
  },
});