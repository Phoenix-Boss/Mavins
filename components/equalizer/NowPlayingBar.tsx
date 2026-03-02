// components/equalizer/NowPlayingBar.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { scale, verticalScale, moderateScale } from 'react-native-size-matters/extend';
import { Colors } from '../../constants/Colors';

interface NowPlayingBarProps {
  track: {
    title: string;
    artist: string;
    artwork?: string | number;
  };
  compact?: boolean;           // ✅ Added compact prop
  isPlaying: boolean;         // ✅ Playback state
  progress: number;           // ✅ Real progress 0-1
  onPlayPause: () => void;    // ✅ Play/pause control
  onPress?: () => void;       // ✅ Track navigation
}

export const NowPlayingBar: React.FC<NowPlayingBarProps> = ({
  track,
  compact = false,
  isPlaying,
  progress,
  onPlayPause,
  onPress
}) => {
  const getImageSource = (artwork: string | number | undefined) => {
    if (!artwork) return require('@/assets/images/icon.png');
    if (typeof artwork === 'number') return artwork;
    return { uri: artwork };
  };

  return (
    <TouchableOpacity 
      style={styles.nowPlayingContainer} 
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Image
        source={getImageSource(track.artwork)}
        style={[
          styles.nowPlayingArtwork, 
          compact && styles.nowPlayingArtworkCompact
        ]}
        contentFit="cover"
      />
      
      <View style={[styles.nowPlayingInfo, compact && styles.nowPlayingInfoCompact]}>
        <Text style={styles.nowPlayingTitle} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.nowPlayingArtist} numberOfLines={1}>
          {track.artist}
        </Text>
        {!compact && (
          <View style={styles.progressContainer}>
            <View style={[
              styles.progressBar, 
              { 
                backgroundColor: Colors.metallicBrown.primary,
                width: `${Math.max(0, Math.min(100, progress * 100))}%`  // ✅ Dynamic progress
              }
            ]} />
          </View>
        )}
      </View>
      
      <TouchableOpacity 
        style={[styles.playButton, { backgroundColor: Colors.metallicBrown.primary }]} 
        onPress={onPlayPause}      // ✅ Functional handler
        activeOpacity={0.7}
      >
        <MaterialIcons 
          name={isPlaying ? "pause" : "play-arrow"}  // ✅ Dynamic icon
          size={compact ? 24 : 28} 
          color="#fff" 
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  nowPlayingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: verticalScale(25),
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: scale(12),
    gap: scale(12),
  },
  nowPlayingArtwork: {
    width: scale(50),
    height: scale(50),
    borderRadius: 8,
  },
  nowPlayingArtworkCompact: {
    width: scale(40),
    height: scale(40),
  },
  nowPlayingInfo: {
    flex: 1,
  },
  nowPlayingInfoCompact: {
    // Slightly smaller text in compact mode
  },
  nowPlayingTitle: {
    color: '#fff',
    fontSize: moderateScale(14),
    fontWeight: '600',
  },
  nowPlayingArtist: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: moderateScale(12),
    marginTop: 2,
  },
  progressContainer: {
    marginTop: verticalScale(6),
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  playButton: {
    width: scale(40),
    height: scale(40),
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
