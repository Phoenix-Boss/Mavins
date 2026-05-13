/**
 * MixCard
 *
 * Universal card component used across all home screen sections.
 *
 * Routing behaviour by itemType:
 *   song     → playAudio(song, queue) via MusicPlayerContext
 *   artist   → /artist/[id]
 *   playlist → /playlist/[id]
 *   album    → /album/[id]
 *   channel  → /channel/[id]
 *
 * The `queue` prop is the full list of songs from the current section so
 * the engine gets a proper queue with skip forward/back context.
 *
 * The `songUrl` prop is the full YouTube watch URL required by MavinEngine
 * e.g. "https://www.youtube.com/watch?v=JGwWNGJdvx8"
 * For non-song types it is ignored.
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

// Import from the canonical bridge — never directly from MusicPlayerContext.
import { useMusicPlayer, usePlayerEngine } from "@/libs/playerSetup";
import { usePlayerOverlay } from "@/app/_layout";

// ─── Colors ───────────────────────────────────────────────────────────────────

const COLORS = {
  background:    "#000000",
  surfaceLight:  "#1F1F1F",
  goldPrimary:   "#D4AF37",
  goldShiny:     "#FFD700",
  goldShimmer:   "#E6C16A",
  text:          "#FFFFFF",
  textSecondary: "#B3B3B3",
  textMuted:     "#808080",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type MixCardItemType = "song" | "artist" | "playlist" | "album" | "channel";

/**
 * Song shape expected by MusicPlayerContext.playAudio().
 * Must match the shape used in HomeScreen.
 */
export interface MixCardSong {
  id:        string;
  title:     string;
  artist:    string;
  thumbnail: string;
  url:       string;
  duration?: number;  // Optional for backward compatibility
  videoId?:  string;  // Optional for backward compatibility
}

export interface MixCardProps {
  item?: {
    id?:        string;
    title?:     string;
    artist?:    string;
    thumbnail?: string;
    reason?:    string;
    /** Full YouTube watch URL — required when itemType === "song" */
    url?:       string;
    duration?:  number;
    videoId?:   string;
  };
  /**
   * Determines routing behaviour on press.
   * Defaults to "song" to preserve backward compatibility.
   */
  itemType?: MixCardItemType;
  /**
   * Full list of songs in the current section — passed as the queue to
   * playAudio() so skip forward/back works correctly.
   * Only used when itemType === "song".
   */
  queue?: MixCardSong[];
  isCurrentTrack?: boolean;
  isPlaying?:      boolean;
  /** Override the default press behaviour entirely. */
  onPress?: () => void;
  fallbackTitle?: string;
  /** Optional callback when playback starts (e.g., to expand player) */
  onPlaybackStart?: () => void;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Safely navigates to a route with encoded parameters
 */
const navigateToRoute = (router: any, basePath: string, id: string) => {
  if (!id) return;
  
  // Properly encode the ID for URL safety
  const encodedId = encodeURIComponent(id);
  const route = `${basePath}/${encodedId}` as const;
  
  router.push(route);
};

// ─── Component ────────────────────────────────────────────────────────────────

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
  const router         = useRouter();
  const { playAudio }  = useMusicPlayer();
  const { expandPlayer } = usePlayerOverlay(); // Get expandPlayer from layout
  // usePlayerEngine gives us currentTrack + isPlaying from the expo-audio engine
  const engine         = usePlayerEngine();

  // ── Safe defaults ──────────────────────────────────────────────────────────
  const safeItem = {
    id:        item?.id        || "",
    title:     item?.title     || fallbackTitle,
    artist:    item?.artist    || "Unknown Artist",
    thumbnail: item?.thumbnail || null,
    reason:    item?.reason,
    url:       item?.url       || "",
    duration:  item?.duration,
    videoId:   item?.videoId,
  };

  const hasValidImage =
    !!safeItem.thumbnail && safeItem.thumbnail.startsWith("http");

  // Whether this card's track is the one currently loaded in the engine
  const isActive = engine.currentTrack?.id === safeItem.id;

  // Live playing state — engine.isPlaying is the source of truth
  const isActivePlaying = isActive && engine.isPlaying;

  // ── Press handler ──────────────────────────────────────────────────────────
  const handlePress = async () => {
    triggerHaptic();

    if (onPress) {
      onPress();
      return;
    }

    if (!safeItem.id) return;

    switch (itemType) {
      case "song": {
        const song: MixCardSong = {
          id:        safeItem.id,
          title:     safeItem.title,
          artist:    safeItem.artist,
          thumbnail: safeItem.thumbnail ?? "",
          url:       safeItem.url,
          duration:  safeItem.duration,
          videoId:   safeItem.videoId,
        };
        
        // Match HomeScreen's playAudio call signature
        // Third parameter: callback to expand player when playback starts
        const onStart = onPlaybackStart || expandPlayer;
        await playAudio(song, queue ?? [song], onStart);
        break;
      }
      case "artist":
        navigateToRoute(router, "/artist", safeItem.id);
        break;
      case "playlist":
        navigateToRoute(router, "/playlist", safeItem.id);
        break;
      case "album":
        navigateToRoute(router, "/album", safeItem.id);
        break;
      case "channel":
        navigateToRoute(router, "/channel", safeItem.id);
        break;
    }
  };

  // ── Play button (song type only) ───────────────────────────────────────────
  const handlePlayPress = async (e: any) => {
    e.stopPropagation();
    triggerHaptic();
    if (itemType === "song") {
      const song: MixCardSong = {
        id:        safeItem.id,
        title:     safeItem.title,
        artist:    safeItem.artist,
        thumbnail: safeItem.thumbnail ?? "",
        url:       safeItem.url,
        duration:  safeItem.duration,
        videoId:   safeItem.videoId,
      };
      
      // Match HomeScreen's playAudio call signature
      const onStart = onPlaybackStart || expandPlayer;
      await playAudio(song, queue ?? [song], onStart);
    } else {
      handlePress();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <TouchableOpacity
      style={[
        styles.mixCard,
        isActive && styles.currentPlayingTrack,
        !hasValidImage && styles.noImageCard,
      ]}
      onPress={handlePress}
      activeOpacity={0.9}
    >
      {/* Thumbnail */}
      {hasValidImage ? (
        <Image
          source={{ uri: safeItem.thumbnail! }}
          style={styles.mixCardImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.mixCardImage, styles.fallbackImage]}>
          <Ionicons
            name={
              itemType === "artist"   ? "person"       :
              itemType === "channel"  ? "tv"            :
              itemType === "album"    ? "disc"          :
              itemType === "playlist" ? "list-circle"   :
                                       "musical-notes"
            }
            size={40}
            color={COLORS.goldShimmer}
          />
        </View>
      )}

      {/* Play/navigate button — top right */}
      {hasValidImage && (
        <View style={styles.mixCardPlayButtonContainer}>
          <TouchableOpacity
            style={[
              styles.metallicPlayButtonOutline,
              isActive && styles.activePlayButton,
            ]}
            onPress={handlePlayPress}
          >
            <Ionicons
              name={
                itemType !== "song"
                  ? "arrow-forward"
                  : isActivePlaying
                  ? "pause"
                  : "play"
              }
              size={12}
              color={COLORS.goldShiny}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Info overlay */}
      <View style={styles.mixCardOverlay}>
        <Text style={styles.mixCardTitle} numberOfLines={1}>
          {safeItem.title}
        </Text>
        <Text style={styles.mixCardArtist} numberOfLines={1}>
          {safeItem.artist}
        </Text>
        {safeItem.reason && (
          <Text style={styles.mixCardReason} numberOfLines={1}>
            {safeItem.reason}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  mixCard: {
    width:           150,
    height:          150,
    borderRadius:    10,
    overflow:        "hidden",
    position:        "relative",
    backgroundColor: COLORS.surfaceLight,
  },
  noImageCard: {
    borderWidth: 1,
    borderColor: COLORS.goldPrimary + "30",
  },
  mixCardImage: {
    width:           "100%",
    height:          "100%",
    backgroundColor: COLORS.surfaceLight,
  },
  fallbackImage: {
    justifyContent:  "center",
    alignItems:      "center",
    backgroundColor: COLORS.surfaceLight,
  },
  mixCardPlayButtonContainer: {
    position: "absolute",
    top:      8,
    right:    8,
    zIndex:   2,
  },
  metallicPlayButtonOutline: {
    width:           28,
    height:          28,
    borderRadius:    14,
    backgroundColor: "transparent",
    borderWidth:     1.5,
    borderColor:     COLORS.goldShiny,
    justifyContent:  "center",
    alignItems:      "center",
    shadowColor:     COLORS.goldShiny,
    shadowOffset:    { width: 0, height: 1 },
    shadowOpacity:   0.6,
    shadowRadius:    3,
    elevation:       3,
  },
  activePlayButton: {
    backgroundColor: COLORS.goldPrimary + "30",
    shadowColor:     COLORS.goldShiny,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.9,
    shadowRadius:    6,
    elevation:       6,
  },
  mixCardOverlay: {
    position:        "absolute",
    bottom:          0,
    left:            0,
    right:           0,
    padding:         10,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  mixCardTitle: {
    fontSize:      14,
    fontWeight:    "600",
    color:         COLORS.text,
    marginBottom:  2,
  },
  mixCardArtist: {
    fontSize:     12,
    color:        COLORS.goldShimmer,
    marginBottom: 2,
  },
  mixCardReason: {
    fontSize: 10,
    color:    COLORS.textSecondary,
  },
  currentPlayingTrack: {
    borderWidth: 2,
    borderColor: COLORS.goldPrimary,
  },
});