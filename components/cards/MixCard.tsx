/**
 * MixCard - Theme-aware with cinematic light mode support
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { useMusicPlayer, usePlayerEngine } from "@/libs/playerSetup";
import { usePlayerOverlay } from '@/libs/playerOverlay';
import { useTheme } from "@/contexts/ThemeContext";

export type MixCardItemType = "song" | "artist" | "playlist" | "album" | "channel";

export interface MixCardSong {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  duration?: number;
  videoId?: string;
}

export interface MixCardProps {
  item?: {
    id?: string;
    title?: string;
    artist?: string;
    thumbnail?: string;
    reason?: string;
    url?: string;
    duration?: number;
    videoId?: string;
  };
  itemType?: MixCardItemType;
  queue?: MixCardSong[];
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
  onPress?: () => void;
  fallbackTitle?: string;
  onPlaybackStart?: () => void;
}

const navigateToRoute = (router: any, basePath: string, id: string) => {
  if (!id) return;
  const encodedId = encodeURIComponent(id);
  router.push(`${basePath}/${encodedId}`);
};

export const MixCard = ({
  item,
  itemType = "song",
  queue,
  isCurrentTrack = false,
  isPlaying = false,
  onPress,
  fallbackTitle = "Unknown",
  onPlaybackStart,
}: MixCardProps) => {
  const router = useRouter();
  const { playAudio } = useMusicPlayer();
  const { expandPlayer } = usePlayerOverlay();
  const engine = usePlayerEngine();
  const { colors, isDark } = useTheme();

  const safeItem = {
    id: item?.id || "",
    title: item?.title || fallbackTitle,
    artist: item?.artist || "Unknown Artist",
    thumbnail: item?.thumbnail || null,
    reason: item?.reason,
    url: item?.url || "",
    duration: item?.duration,
    videoId: item?.videoId,
  };

  const hasValidImage = !!safeItem.thumbnail && safeItem.thumbnail.startsWith("http");
  const isActive = engine.currentTrack?.id === safeItem.id;
  const isActivePlaying = isActive && engine.isPlaying;

  // Theme-aware overlay background
  const overlayBackground = isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)';

  const handlePress = async () => {
    triggerHaptic();
    if (onPress) { onPress(); return; }
    if (!safeItem.id) return;

    switch (itemType) {
      case "song": {
        const song: MixCardSong = {
          id: safeItem.id,
          title: safeItem.title,
          artist: safeItem.artist,
          thumbnail: safeItem.thumbnail ?? "",
          url: safeItem.url,
          duration: safeItem.duration,
          videoId: safeItem.videoId,
        };
        const onStart = onPlaybackStart || expandPlayer;
        await playAudio(song, queue ?? [song], onStart);
        break;
      }
      case "artist":
        navigateToRoute(router, "/(player)/search/artist", safeItem.id);
        break;
      case "playlist":
        navigateToRoute(router, "/(player)/search/playlist", safeItem.id);
        break;
      case "album":
        navigateToRoute(router, "/(player)/search/album", safeItem.id);
        break;
      case "channel":
        navigateToRoute(router, "/channel", safeItem.id);
        break;
    }
  };

  const handlePlayPress = async (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    if (itemType === "song") {
      const song: MixCardSong = {
        id: safeItem.id,
        title: safeItem.title,
        artist: safeItem.artist,
        thumbnail: safeItem.thumbnail ?? "",
        url: safeItem.url,
        duration: safeItem.duration,
        videoId: safeItem.videoId,
      };
      const onStart = onPlaybackStart || expandPlayer;
      await playAudio(song, queue ?? [song], onStart);
    } else {
      handlePress();
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.mixCard,
        { backgroundColor: colors.surface },
        isActive && { borderWidth: 2, borderColor: colors.gold },
        !hasValidImage && { borderWidth: 1, borderColor: `${colors.gold}30` },
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      {hasValidImage ? (
        <Image source={{ uri: safeItem.thumbnail! }} style={styles.mixCardImage} resizeMode="cover" />
      ) : (
        <View style={[styles.mixCardImage, styles.fallbackImage, { backgroundColor: colors.surfaceLight }]}>
          <Ionicons
            name={itemType === "artist" ? "person" : itemType === "channel" ? "tv" : itemType === "album" ? "disc" : itemType === "playlist" ? "list-circle" : "musical-notes"}
            size={40}
            color={colors.gold}
          />
        </View>
      )}

      {hasValidImage && (
        <View style={styles.mixCardPlayButtonContainer}>
          <TouchableOpacity
            style={[
              styles.metallicPlayButtonOutline,
              { borderColor: colors.gold, shadowColor: colors.gold },
              isActive && { backgroundColor: `${colors.gold}30` },
            ]}
            onPress={handlePlayPress}
          >
            <Ionicons
              name={itemType !== "song" ? "arrow-forward" : isActivePlaying ? "pause" : "play"}
              size={12}
              color={colors.gold}
            />
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.mixCardOverlay, { backgroundColor: overlayBackground }]}>
        <Text style={[styles.mixCardTitle, { color: isDark ? colors.text : colors.text }]} numberOfLines={1}>
          {safeItem.title}
        </Text>
        <Text style={[styles.mixCardArtist, { color: colors.gold }]} numberOfLines={1}>
          {safeItem.artist}
        </Text>
        {safeItem.reason && (
          <Text style={[styles.mixCardReason, { color: colors.textSub }]} numberOfLines={1}>
            {safeItem.reason}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  mixCard: { width: 150, height: 150, borderRadius: 10, overflow: "hidden", position: "relative" },
  mixCardImage: { width: "100%", height: "100%" },
  fallbackImage: { justifyContent: "center", alignItems: "center" },
  mixCardPlayButtonContainer: { position: "absolute", top: 8, right: 8, zIndex: 2 },
  metallicPlayButtonOutline: { width: 28, height: 28, borderRadius: 14, backgroundColor: "transparent", borderWidth: 1.5, justifyContent: "center", alignItems: "center", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.6, shadowRadius: 3, elevation: 3 },
  mixCardOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 10 },
  mixCardTitle: { fontSize: 14, fontWeight: "600", marginBottom: 2 },
  mixCardArtist: { fontSize: 12, marginBottom: 2 },
  mixCardReason: { fontSize: 10 },
});
