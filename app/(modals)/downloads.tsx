// (modals)/downloads.tsx
//
// Downloads Modal - Full Screen BandLab-style overlay
// Features:
//   - Full screen overlay (not half sheet)
//   - Drag down to close (handle at top)
//   - Theme-aware background
//   - Dynamic artwork from first song in sorted list
//   - Total duration and like count from all downloads
//   - Long press for edit mode with side panel
//   - Shuffle all button
//   - Heart like button for current track
//   - Share button
//   - Edit mode: reorder, delete, rename

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  Animated as RNAnimated,
  PanResponder,
  Dimensions,
  Alert,
  ToastAndroid,
  Image,
  TextInput,
  LayoutAnimation,
  UIManager,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  Feather,
} from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { triggerHaptic } from "@/helpers/haptics";
import {
  moderateScale,
  scale,
  verticalScale,
} from "react-native-size-matters/extend";
import { useTheme } from "@/contexts/ThemeContext";
import {
  useDownloadedTracks,
  useLibraryStore,
  type DownloadedSongMetadata,
  type Song,
} from "@/store/library";
import { deleteDownloadedSong } from "@/services/download";
import { useMusicPlayer } from "@/libs/playerSetup";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// Enable LayoutAnimation for Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Helper to format duration
const formatDuration = (seconds: number): string => {
  if (!seconds) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

// Helper to format total duration
const formatTotalDuration = (seconds: number): string => {
  if (!seconds) return "0 min";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  return `${minutes} min`;
};

// Helper to format play count
const formatPlayCount = (count: number): string => {
  if (!count) return "0";
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
};

// Edit Mode Side Panel Component
interface EditPanelProps {
  visible: boolean;
  onClose: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
  onMoveToPlaylist: () => void;
  currentTitle: string;
  colors: any;
}

const EditPanel: React.FC<EditPanelProps> = ({
  visible,
  onClose,
  onDelete,
  onRename,
  onMoveToPlaylist,
  currentTitle,
  colors,
}) => {
  const [newTitle, setNewTitle] = useState(currentTitle);
  const translateX = useRef(new RNAnimated.Value(SCREEN_WIDTH)).current;

  useEffect(() => {
    if (visible) {
      RNAnimated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 300,
      }).start();
    } else {
      RNAnimated.spring(translateX, {
        toValue: SCREEN_WIDTH,
        useNativeDriver: true,
        damping: 20,
        stiffness: 300,
      }).start();
    }
  }, [visible]);

  const handleRename = () => {
    if (newTitle.trim() && newTitle !== currentTitle) {
      onRename(newTitle);
    }
    onClose();
  };

  if (!visible) return null;

  return (
    <>
      <TouchableOpacity style={styles.editPanelBackdrop} onPress={onClose} activeOpacity={1} />
      <RNAnimated.View
        style={[
          styles.editPanel,
          { transform: [{ translateX }], backgroundColor: colors.surface },
        ]}
      >
        <View style={[styles.editPanelHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.editPanelTitle, { color: colors.text }]}>Options</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.editPanelContent}>
          {/* Rename Section */}
          <View style={styles.editSection}>
            <Text style={[styles.editSectionLabel, { color: colors.textSub }]}>Rename</Text>
            <TextInput
              style={[styles.editInput, { color: colors.text, borderColor: colors.border }]}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Enter new name"
              placeholderTextColor={colors.textSub}
              autoFocus
            />
            <TouchableOpacity onPress={handleRename} style={[styles.editButton, { backgroundColor: colors.gold }]}>
              <Text style={styles.editButtonText}>Save</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.editDivider, { backgroundColor: colors.border }]} />

          {/* Move to Playlist */}
          <TouchableOpacity style={styles.editAction} onPress={onMoveToPlaylist}>
            <MaterialIcons name="playlist-add" size={22} color={colors.text} />
            <Text style={[styles.editActionText, { color: colors.text }]}>Add to Playlist</Text>
          </TouchableOpacity>

          <View style={[styles.editDivider, { backgroundColor: colors.border }]} />

          {/* Delete */}
          <TouchableOpacity style={styles.editAction} onPress={onDelete}>
            <MaterialIcons name="delete-outline" size={22} color="#FF4444" />
            <Text style={[styles.editActionText, { color: "#FF4444" }]}>Delete from Downloads</Text>
          </TouchableOpacity>
        </View>
      </RNAnimated.View>
    </>
  );
};

// Track Item Component
interface TrackItemProps {
  song: DownloadedSongMetadata;
  index: number;
  isPlaying: boolean;
  isEditMode: boolean;
  onPlay: (song: DownloadedSongMetadata) => void;
  onLongPress: (song: DownloadedSongMetadata, index: number) => void;
  onMoveItem: (fromIndex: number, toIndex: number) => void;
  colors: any;
}

const TrackItem: React.FC<TrackItemProps> = ({
  song,
  index,
  isPlaying,
  isEditMode,
  onPlay,
  onLongPress,
  onMoveItem,
  colors,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handlePlay = () => {
    if (isEditMode) return;
    triggerHaptic();
    onPlay(song);
  };

  const handleLongPress = () => {
    if (isEditMode) return;
    triggerHaptic();
    onLongPress(song, index);
  };

  // Random color for placeholder artwork based on song id
  const getPlaceholderColor = () => {
    const colors_list = ['#FF4444', '#44FF44', '#4444FF', '#FFFF44', '#FF44FF', '#44FFFF'];
    const hash = song.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors_list[hash % colors_list.length];
  };

  const artworkSource = song.thumbnail
    ? { uri: song.thumbnail }
    : null;

  return (
    <TouchableOpacity
      style={[
        styles.trackItem,
        { borderBottomColor: colors.border, opacity: isDragging ? 0.5 : 1 },
      ]}
      onPress={handlePlay}
      onLongPress={handleLongPress}
      delayLongPress={300}
      activeOpacity={0.7}
    >
      {/* Artwork */}
      <View style={styles.trackArtwork}>
        {artworkSource ? (
          <Image source={artworkSource} style={styles.trackArtworkImage} />
        ) : (
          <View style={[styles.trackArtworkPlaceholder, { backgroundColor: getPlaceholderColor() }]}>
            <Text style={styles.trackArtworkText}>{song.artist?.charAt(0) || "?"}</Text>
          </View>
        )}
        {isPlaying && !isEditMode && (
          <View style={[styles.trackPlayingOverlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
            <Ionicons name="pause" size={20} color="#fff" />
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.trackInfo}>
        <Text
          style={[
            styles.trackTitle,
            { color: isPlaying && !isEditMode ? colors.gold : colors.text },
          ]}
          numberOfLines={1}
        >
          {song.title}
        </Text>
        <Text style={[styles.trackArtist, { color: colors.textSub }]} numberOfLines={1}>
          {song.artist}
        </Text>
      </View>

      {/* Reorder handle (edit mode) or duration (normal mode) */}
      {isEditMode ? (
        <View style={styles.reorderHandle}>
          <MaterialIcons name="drag-handle" size={24} color={colors.textSub} />
        </View>
      ) : (
        <Text style={[styles.trackDuration, { color: colors.textSub }]}>
          {formatDuration(song.duration)}
        </Text>
      )}
    </TouchableOpacity>
  );
};

// Header Component
interface HeaderProps {
  onClose: () => void;
  artworkUrl?: string;
  title: string;
  artist: string;
  playCount: number;
  totalDuration: number;
  likeCount: number;
  isLiked: boolean;
  onLikePress: () => void;
  onShufflePress: () => void;
  onSharePress: () => void;
  isEditMode: boolean;
  onEditModeToggle: () => void;
  onEditModeDone: () => void;
  colors: any;
}

const Header: React.FC<HeaderProps> = ({
  onClose,
  artworkUrl,
  title,
  artist,
  playCount,
  totalDuration,
  likeCount,
  isLiked,
  onLikePress,
  onShufflePress,
  onSharePress,
  isEditMode,
  onEditModeToggle,
  onEditModeDone,
  colors,
}) => {
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  const handlePlayPreview = () => {
    triggerHaptic();
    setIsPlayingPreview(true);
    setTimeout(() => setIsPlayingPreview(false), 500);
    // Play first song preview
  };

  const artworkSource = artworkUrl
    ? { uri: artworkUrl }
    : require('@/assets/images/mavins.png');

  return (
    <View style={styles.header}>
      {/* Drag Handle */}
      <View style={styles.dragHandleContainer}>
        <View style={[styles.dragHandle, { backgroundColor: colors.textMuted }]} />
      </View>

      {/* Close and Edit Buttons */}
      <View style={styles.headerTop}>
        <TouchableOpacity onPress={onClose} style={styles.headerButton}>
          <Ionicons name="chevron-down" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          {!isEditMode ? (
            <TouchableOpacity onPress={onEditModeToggle} style={styles.headerButton}>
              <MaterialIcons name="edit" size={22} color={colors.text} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onEditModeDone} style={[styles.doneButton, { backgroundColor: colors.gold }]}>
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Artwork */}
      <View style={styles.artworkContainer}>
        <Image source={artworkSource} style={styles.artworkImage} />
        <TouchableOpacity
          style={[styles.playOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
          onPress={handlePlayPreview}
          activeOpacity={0.8}
        >
          <Ionicons name={isPlayingPreview ? "pause" : "play"} size={40} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Title and Artist */}
      <Text style={[styles.trackTitle, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.artistRow}>
        <View style={[styles.verifiedBadge, { backgroundColor: colors.gold }]}>
          <MaterialIcons name="check" size={12} color="#fff" />
        </View>
        <Text style={[styles.artistName, { color: colors.textSub }]}>{artist}</Text>
        <View style={[styles.artistIcon, { backgroundColor: colors.gold }]}>
          <MaterialIcons name="whatshot" size={10} color="#fff" />
        </View>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Ionicons name="musical-notes" size={14} color={colors.textSub} />
          <Text style={[styles.statText, { color: colors.textSub }]}>{formatPlayCount(playCount)}</Text>
        </View>
        <View style={styles.statItem}>
          <Ionicons name="time-outline" size={14} color={colors.textSub} />
          <Text style={[styles.statText, { color: colors.textSub }]}>{formatTotalDuration(totalDuration)}</Text>
        </View>
        <TouchableOpacity style={styles.statItem} onPress={onLikePress}>
          <Ionicons name={isLiked ? "heart" : "heart-outline"} size={14} color={isLiked ? colors.gold : colors.textSub} />
          <Text style={[styles.statText, { color: isLiked ? colors.gold : colors.textSub }]}>
            {formatPlayCount(likeCount)}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Action Buttons Row */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionButton} onPress={onLikePress}>
          <Ionicons name={isLiked ? "heart" : "heart-outline"} size={24} color={isLiked ? colors.gold : colors.text} />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.shuffleButton, { backgroundColor: colors.gold }]} onPress={onShufflePress}>
          <MaterialIcons name="shuffle" size={20} color="#fff" />
          <Text style={styles.shuffleText}>Shuffle</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={onSharePress}>
          <Feather name="share-2" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Main Modal Component
export default function DownloadsModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const downloadedTracks = useDownloadedTracks();
  const { playAudio, currentTrack } = useMusicPlayer();
  const [visible, setVisible] = useState(true);
  const [downloads, setDownloads] = useState<DownloadedSongMetadata[]>(downloadedTracks);
  const [sortOrder, setSortOrder] = useState<'default' | 'az' | 'za' | 'recent'>('default');
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedSong, setSelectedSong] = useState<DownloadedSongMetadata | null>(null);
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);

  const slideAnim = useRef(new RNAnimated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new RNAnimated.Value(0)).current;

  // Calculate totals
  const totalDuration = downloads.reduce((sum, song) => sum + (song.duration || 0), 0);
  const totalPlayCount = downloads.reduce((sum, song) => sum + (song.playCount || 0), 0);
  const totalLikes = downloads.reduce((sum, song) => sum + (song.isFavorite ? 1 : 0), 0);

  // Get first song for header artwork (based on current sort order)
  const headerSong = downloads.length > 0 ? downloads[0] : null;

  // Update downloads when store changes
  useEffect(() => {
    let sorted = [...downloadedTracks];
    if (sortOrder === 'az') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortOrder === 'za') {
      sorted.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sortOrder === 'recent') {
      sorted.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
    }
    setDownloads(sorted);
  }, [downloadedTracks, sortOrder]);

  // Check if current track is in downloads and update like status
  useEffect(() => {
    if (headerSong) {
      setIsLiked(headerSong.isFavorite || false);
    }
    setLikeCount(totalLikes);
  }, [headerSong, totalLikes]);

  // Animate in
  useEffect(() => {
    RNAnimated.parallel([
      RNAnimated.spring(slideAnim, { toValue: 0, damping: 28, stiffness: 200, useNativeDriver: true }),
      RNAnimated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleClose = useCallback(() => {
    triggerHaptic();
    RNAnimated.parallel([
      RNAnimated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 240, useNativeDriver: true }),
      RNAnimated.timing(backdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      router.back();
    });
  }, [router, slideAnim, backdropAnim]);

  const handlePlay = useCallback((song: DownloadedSongMetadata) => {
    triggerHaptic();
    
    const songToPlay: Song = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      thumbnail: song.thumbnail,
      url: song.localTrackUri || song.url,
      duration: song.duration,
      videoId: song.videoId,
      isDownloaded: true,
      isLocal: true,
      isFavorite: song.isFavorite || false,
      playCount: song.playCount || 0,
      skipCount: song.skipCount || 0,
      dateAdded: song.dateAdded,
      dateModified: song.dateModified,
      source: 'downloaded',
    };
    
    playAudio(songToPlay);
  }, [playAudio]);

  const handleLongPress = useCallback((song: DownloadedSongMetadata) => {
    setSelectedSong(song);
    setShowEditPanel(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedSong) return;
    triggerHaptic();
    await deleteDownloadedSong(selectedSong.id);
    ToastAndroid.show("Song removed from downloads", ToastAndroid.SHORT);
    setShowEditPanel(false);
    setSelectedSong(null);
    const updated = useLibraryStore.getState().downloadedSongIds.map(id =>
      useLibraryStore.getState().songs[id]
    ).filter(Boolean) as DownloadedSongMetadata[];
    setDownloads(updated);
  }, [selectedSong]);

  const handleRename = useCallback(async (newName: string) => {
    if (!selectedSong) return;
    // Update the song title in the store
    useLibraryStore.getState().updateSong(selectedSong.id, { title: newName });
    ToastAndroid.show("Song renamed", ToastAndroid.SHORT);
  }, [selectedSong]);

  const handleMoveToPlaylist = useCallback(() => {
    if (!selectedSong) return;
    setShowEditPanel(false);
    router.push({
      pathname: "/(modals)/addToPlaylist",
      params: { songId: selectedSong.id, songTitle: selectedSong.title },
    });
  }, [selectedSong, router]);

  const handleShuffleAll = useCallback(() => {
    if (downloads.length === 0) return;
    triggerHaptic();
    const randomIndex = Math.floor(Math.random() * downloads.length);
    const randomSong = downloads[randomIndex];
    const songToPlay: Song = {
      id: randomSong.id,
      title: randomSong.title,
      artist: randomSong.artist,
      thumbnail: randomSong.thumbnail,
      url: randomSong.localTrackUri || randomSong.url,
      duration: randomSong.duration,
      videoId: randomSong.videoId,
      isDownloaded: true,
      isLocal: true,
      isFavorite: randomSong.isFavorite || false,
      playCount: randomSong.playCount || 0,
      skipCount: randomSong.skipCount || 0,
      dateAdded: randomSong.dateAdded,
      dateModified: randomSong.dateModified,
      source: 'downloaded',
    };
    playAudio(songToPlay);
    ToastAndroid.show("Shuffle playing", ToastAndroid.SHORT);
  }, [downloads, playAudio]);

  const handleShare = useCallback(async () => {
    if (!headerSong) return;
    triggerHaptic();
    try {
      const message = `Check out "${headerSong.title}" by ${headerSong.artist} on Mavin Player`;
      await Share.share({ title: headerSong.title, message });
    } catch (error) {
      ToastAndroid.show("Failed to share", ToastAndroid.SHORT);
    }
  }, [headerSong]);

  const handleLike = useCallback(() => {
    if (!headerSong) return;
    triggerHaptic();
    const newLikeState = !isLiked;
    setIsLiked(newLikeState);
    setLikeCount(prev => newLikeState ? prev + 1 : prev - 1);
    useLibraryStore.getState().updateSong(headerSong.id, { isFavorite: newLikeState });
    ToastAndroid.show(newLikeState ? "Added to favorites" : "Removed from favorites", ToastAndroid.SHORT);
  }, [headerSong, isLiked]);

  const handleMoveItem = useCallback((fromIndex: number, toIndex: number) => {
    if (!isEditMode) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const updated = [...downloads];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    setDownloads(updated);
  }, [downloads, isEditMode]);

  const handleEditModeDone = useCallback(() => {
    setIsEditMode(false);
    // Save new order to persistent storage if needed
    ToastAndroid.show("Order saved", ToastAndroid.SHORT);
  }, []);

  const isCurrentTrackPlaying = (songId: string) => {
    return currentTrack?.id === songId;
  };

  // Pan responder for drag to close
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 10,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          slideAnim.setValue(gesture.dy);
          backdropAnim.setValue(Math.max(0, 1 - gesture.dy / SCREEN_HEIGHT));
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 100 || gesture.vy > 0.5) {
          handleClose();
        } else {
          RNAnimated.parallel([
            RNAnimated.spring(slideAnim, { toValue: 0, damping: 20, stiffness: 300, useNativeDriver: true }),
            RNAnimated.timing(backdropAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={handleClose}>
      <RNAnimated.View
        style={[styles.backdrop, { opacity: backdropAnim, backgroundColor: colors.background }]}
      />

      <RNAnimated.View
        style={[
          styles.sheet,
          {
            transform: [{ translateY: slideAnim }],
            backgroundColor: colors.background,
          },
        ]}
        {...panResponder.panHandlers}
      >
        {/* Header */}
        <Header
          onClose={handleClose}
          artworkUrl={headerSong?.thumbnail}
          title={headerSong?.title || "No Downloads"}
          artist={headerSong?.artist || "No songs downloaded"}
          playCount={totalPlayCount}
          totalDuration={totalDuration}
          likeCount={likeCount}
          isLiked={isLiked}
          onLikePress={handleLike}
          onShufflePress={handleShuffleAll}
          onSharePress={handleShare}
          isEditMode={isEditMode}
          onEditModeToggle={() => setIsEditMode(true)}
          onEditModeDone={handleEditModeDone}
          colors={colors}
        />

        {/* Sort Options */}
        {!isEditMode && downloads.length > 0 && (
          <View style={[styles.sortBar, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.sortButton, sortOrder === 'default' && { borderBottomColor: colors.gold }]}
              onPress={() => setSortOrder('default')}
            >
              <Text style={[styles.sortText, { color: sortOrder === 'default' ? colors.gold : colors.textSub }]}>
                Default
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortButton, sortOrder === 'az' && { borderBottomColor: colors.gold }]}
              onPress={() => setSortOrder('az')}
            >
              <Text style={[styles.sortText, { color: sortOrder === 'az' ? colors.gold : colors.textSub }]}>
                A-Z
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortButton, sortOrder === 'za' && { borderBottomColor: colors.gold }]}
              onPress={() => setSortOrder('za')}
            >
              <Text style={[styles.sortText, { color: sortOrder === 'za' ? colors.gold : colors.textSub }]}>
                Z-A
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sortButton, sortOrder === 'recent' && { borderBottomColor: colors.gold }]}
              onPress={() => setSortOrder('recent')}
            >
              <Text style={[styles.sortText, { color: sortOrder === 'recent' ? colors.gold : colors.textSub }]}>
                Recent
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Edit Mode Hint */}
        {isEditMode && (
          <View style={[styles.editHint, { backgroundColor: `${colors.gold}15` }]}>
            <MaterialIcons name="drag-indicator" size={16} color={colors.gold} />
            <Text style={[styles.editHintText, { color: colors.gold }]}>
              Drag handles to reorder songs
            </Text>
          </View>
        )}

        {/* Track List */}
        {downloads.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIconWrap, { backgroundColor: `${colors.gold}15` }]}>
              <MaterialIcons name="cloud-download" size={48} color={colors.gold} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Downloads Yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSub }]}>
              Songs you download will appear here
            </Text>
          </View>
        ) : (
          <FlatList
            data={downloads}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <TrackItem
                song={item}
                index={index}
                isPlaying={isCurrentTrackPlaying(item.id)}
                isEditMode={isEditMode}
                onPlay={handlePlay}
                onLongPress={handleLongPress}
                onMoveItem={handleMoveItem}
                colors={colors}
              />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 80 }]}
            ItemSeparatorComponent={() => <View style={{ height: verticalScale(2) }} />}
          />
        )}
      </RNAnimated.View>

      {/* Edit Panel */}
      <EditPanel
        visible={showEditPanel}
        onClose={() => setShowEditPanel(false)}
        onDelete={handleDelete}
        onRename={handleRename}
        onMoveToPlaylist={handleMoveToPlaylist}
        currentTitle={selectedSong?.title || ""}
        colors={colors}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    flex: 1,
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  },
  dragHandleContainer: {
    alignItems: "center",
    paddingTop: verticalScale(10),
    paddingBottom: verticalScale(6),
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    opacity: 0.6,
  },
  header: {
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(10),
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: verticalScale(16),
  },
  headerButton: {
    padding: scale(8),
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(12),
  },
  doneButton: {
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(6),
    borderRadius: 20,
  },
  doneButtonText: {
    color: "#fff",
    fontSize: moderateScale(12),
    fontWeight: "600",
  },
  artworkContainer: {
    alignItems: "center",
    marginTop: verticalScale(10),
    marginBottom: verticalScale(20),
  },
  artworkImage: {
    width: SCREEN_WIDTH * 0.65,
    height: SCREEN_WIDTH * 0.65,
    borderRadius: 16,
  },
  playOverlay: {
    position: "absolute",
    width: SCREEN_WIDTH * 0.65,
    height: SCREEN_WIDTH * 0.65,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  trackTitle: {
    fontSize: moderateScale(22),
    fontWeight: "700",
    textAlign: "center",
    marginBottom: verticalScale(4),
  },
  artistRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(6),
    marginBottom: verticalScale(8),
  },
  verifiedBadge: {
    width: scale(16),
    height: scale(16),
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  artistName: {
    fontSize: moderateScale(14),
  },
  artistIcon: {
    width: scale(14),
    height: scale(14),
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(16),
    marginBottom: verticalScale(16),
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(4),
  },
  statText: {
    fontSize: moderateScale(12),
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(20),
    marginBottom: verticalScale(24),
  },
  actionButton: {
    padding: scale(10),
  },
  shuffleButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: scale(20),
    paddingVertical: verticalScale(10),
    borderRadius: 30,
    gap: scale(8),
  },
  shuffleText: {
    color: "#fff",
    fontSize: moderateScale(14),
    fontWeight: "600",
  },
  sortBar: {
    flexDirection: "row",
    paddingHorizontal: scale(20),
    paddingVertical: verticalScale(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: scale(20),
  },
  sortButton: {
    paddingBottom: verticalScale(4),
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  sortText: {
    fontSize: moderateScale(13),
    fontWeight: "500",
  },
  editHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(8),
    paddingVertical: verticalScale(8),
    marginHorizontal: scale(20),
    marginVertical: verticalScale(8),
    borderRadius: 20,
  },
  editHintText: {
    fontSize: moderateScale(12),
    fontWeight: "500",
  },
  listContent: {
    paddingHorizontal: scale(16),
    paddingTop: verticalScale(8),
  },
  trackItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: verticalScale(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackArtwork: {
    position: "relative",
  },
  trackArtworkImage: {
    width: scale(48),
    height: scale(48),
    borderRadius: 6,
  },
  trackArtworkPlaceholder: {
    width: scale(48),
    height: scale(48),
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  trackArtworkText: {
    fontSize: moderateScale(20),
    fontWeight: "600",
    color: "#fff",
  },
  trackPlayingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  trackInfo: {
    flex: 1,
    marginLeft: scale(12),
  },
  trackTitle: {
    fontSize: moderateScale(14),
    fontWeight: "500",
  },
  trackArtist: {
    fontSize: moderateScale(12),
    marginTop: 2,
  },
  trackDuration: {
    fontSize: moderateScale(12),
  },
  reorderHandle: {
    padding: scale(8),
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: verticalScale(80),
    paddingHorizontal: scale(32),
  },
  emptyIconWrap: {
    width: scale(90),
    height: scale(90),
    borderRadius: 45,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: verticalScale(20),
  },
  emptyTitle: {
    fontSize: moderateScale(18),
    fontWeight: "700",
    marginBottom: verticalScale(8),
  },
  emptySubtitle: {
    fontSize: moderateScale(13),
    textAlign: "center",
    lineHeight: moderateScale(18),
  },
  editPanelBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 1000,
  },
  editPanel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: SCREEN_WIDTH * 0.75,
    zIndex: 1001,
    shadowColor: "#000",
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  editPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: scale(20),
    paddingVertical: verticalScale(16),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editPanelTitle: {
    fontSize: moderateScale(18),
    fontWeight: "600",
  },
  editPanelContent: {
    flex: 1,
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(20),
  },
  editSection: {
    marginBottom: verticalScale(20),
  },
  editSectionLabel: {
    fontSize: moderateScale(12),
    marginBottom: verticalScale(8),
  },
  editInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(10),
    fontSize: moderateScale(14),
    marginBottom: verticalScale(12),
  },
  editButton: {
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(10),
    borderRadius: 8,
    alignItems: "center",
  },
  editButtonText: {
    color: "#fff",
    fontSize: moderateScale(14),
    fontWeight: "600",
  },
  editDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: verticalScale(12),
  },
  editAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(12),
    paddingVertical: verticalScale(12),
  },
  editActionText: {
    fontSize: moderateScale(16),
  },
});