// components/localMusic/FolderBrowserOverlay.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  FlatList,
  RefreshControl,
  Linking,
  Platform,
  Animated,
  ActivityIndicator,
  TextInput,
  Alert,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalMusicStore } from '@/store/localMusicStore';
import { mediaStoreManager, AlbumInfo } from '@/utils/localMediaStoreManager';
import { triggerHaptic } from '@/helpers/haptics';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtendedAlbumInfo extends AlbumInfo {
  isWatched: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_LOADING_MESSAGES = [
  'Loading your music library',
  'Almost there',
  'Scanning your tracks',
  'Finding your albums',
  'Discovering local files',
  'Reading folder structure',
  'Gathering your collection',
  'Indexing audio files',
  'Mapping your music',
  'Sorting through folders',
  'Counting your tracks',
  'Fetching album details',
  'Organising your library',
  'Reading metadata',
  'Identifying music files',
  'Building your collection',
  'Picking up the beat',
  'Tuning in to your files',
  'Digging through folders',
  'Rounding up your tracks',
];

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FolderBrowserOverlayProps {
  visible: boolean;
  onClose: () => void;
  onComplete?: () => void;
  /**
   * When true the overlay opens directly onto the watched-folder list
   * with long-press editing/deletion available and no add-mode UI.
   */
  manageMode?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FolderBrowserOverlay({
  visible,
  onClose,
  onComplete,
  manageMode = false,
}: FolderBrowserOverlayProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // ── core list state ──────────────────────────────────────────────────────────
  const [albums, setAlbums] = useState<ExtendedAlbumInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<Set<string>>(new Set());
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  // ── loading animation state ──────────────────────────────────────────────────
  const [shuffledMessages, setShuffledMessages] = useState<string[]>(() =>
    shuffleArray(ALL_LOADING_MESSAGES),
  );
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [loadingPercent, setLoadingPercent] = useState(0);
  const percentTimer = useRef<NodeJS.Timeout | null>(null);
  const messageTimer = useRef<NodeJS.Timeout | null>(null);

  // ── long-press / Instagram selection state ───────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedForAction, setSelectedForAction] = useState<Set<string>>(new Set());
  const selectionBarAnim = useRef(new Animated.Value(0)).current;

  // ── context action modal state ───────────────────────────────────────────────
  const [contextTarget, setContextTarget] = useState<ExtendedAlbumInfo | null>(null);

  // ── edit name modal state ────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<ExtendedAlbumInfo | null>(null);
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // ── WHITE FLASH FIX ──────────────────────────────────────────────────────────
  // Always start at opacity 1. For first-time users we set it to 0 synchronously
  // inside the visible effect BEFORE any render, then fade to 1 after load.
  // For returning users it stays 1: the list paints on frame 1 with no flicker.
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const { addWatchedFolder, watchedFolders, setDefaultView, removeWatchedFolder, renameWatchedFolder } =
    useLocalMusicStore();
  const saveInProgress = useRef(false);
  const watchedFolderIds = useRef<Set<string>>(new Set());

  // ── keep watchedFolderIds ref in sync ───────────────────────────────────────
  useEffect(() => {
    watchedFolderIds.current = new Set(watchedFolders.map(f => f.id));
    setAlbums(prev =>
      prev.map(album => ({
        ...album,
        isWatched: watchedFolderIds.current.has(album.id),
      })),
    );
  }, [watchedFolders]);

  // ── selection bar spring animation ──────────────────────────────────────────
  useEffect(() => {
    Animated.spring(selectionBarAnim, {
      toValue: selectionMode ? 1 : 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 180,
    }).start();
  }, [selectionMode]);

  // ── Android back exits selection mode first ──────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectionMode) {
        exitSelectionMode();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [visible, selectionMode]);

  // ── loading message rotation ─────────────────────────────────────────────────
  useEffect(() => {
    if (loading) {
      messageTimer.current = setInterval(() => {
        setLoadingMessageIndex(prev => (prev + 1) % shuffledMessages.length);
      }, 2000);
    }
    return () => {
      if (messageTimer.current) clearInterval(messageTimer.current);
    };
  }, [loading, shuffledMessages]);

  // ── simulated loading percentage ─────────────────────────────────────────────
  useEffect(() => {
    if (loading) {
      setLoadingPercent(0);
      percentTimer.current = setInterval(() => {
        setLoadingPercent(prev => {
          if (prev >= 99) return 99;
          const step = prev < 60 ? Math.random() * 4 + 2 : Math.random() * 1.5 + 0.5;
          return Math.min(99, Math.floor(prev + step));
        });
      }, 400);
    } else {
      setLoadingPercent(100);
      if (percentTimer.current) clearInterval(percentTimer.current);
    }
    return () => {
      if (percentTimer.current) clearInterval(percentTimer.current);
    };
  }, [loading]);

  // ── open / reset ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) {
      exitSelectionMode();
      return;
    }

    setSelectedAlbumIds(new Set());
    setSaving(false);
    setPermissionDenied(false);
    saveInProgress.current = false;

    const isReturningUser = watchedFolders.length > 0;

    if (isReturningUser || manageMode) {
      // ── Returning user ───────────────────────────────────────────────────────
      // Keep fadeAnim at 1 (already set). Seed from store synchronously so the
      // list is ready for frame 1. Background-fetch full list silently.
      fadeAnim.setValue(1);
      setLoading(false);
      const seedAlbums: ExtendedAlbumInfo[] = watchedFolders.map(f => ({
        id: f.id,
        title: f.name,
        assetCount: f.trackCount,
        artworkUri: undefined,
        isWatched: true,
      }));
      setAlbums(seedAlbums);

      mediaStoreManager
        .getAvailableAlbums(false)
        .then(availableAlbums => {
          const watchedSet = watchedFolderIds.current;
          const merged: ExtendedAlbumInfo[] = availableAlbums.map(album => ({
            ...album,
            isWatched: watchedSet.has(album.id),
          }));
          setAlbums(merged);
        })
        .catch(err => console.error('[FolderBrowser] Background fetch failed:', err));
    } else {
      // ── First-time user: full loading experience ─────────────────────────────
      // Set opacity to 0 HERE (synchronous, before render) then fade in after load.
      fadeAnim.setValue(0);
      setLoading(true);
      setLoadingMessageIndex(0);
      setShuffledMessages(shuffleArray(ALL_LOADING_MESSAGES));
      loadAlbums(false);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Data loading ─────────────────────────────────────────────────────────

  const loadAlbums = useCallback(
    async (forceRefresh: boolean = false) => {
      const hasPermission = await mediaStoreManager.hasPermission();
      if (!hasPermission) {
        const granted = await mediaStoreManager.requestPermissions();
        if (!granted) {
          setPermissionDenied(true);
          setLoading(false);
          return;
        }
      }
      try {
        const availableAlbums = await mediaStoreManager.getAvailableAlbums(forceRefresh);
        const watchedSet = watchedFolderIds.current;
        const albumsWithStatus: ExtendedAlbumInfo[] = availableAlbums.map(album => ({
          ...album,
          isWatched: watchedSet.has(album.id),
        }));
        setAlbums(albumsWithStatus);
        if (isFirstLoad && !forceRefresh) {
          setIsFirstLoad(false);
          mediaStoreManager.refreshAlbumsInBackground();
        }
      } catch (error) {
        console.error('[FolderBrowser] Failed to load albums:', error);
      } finally {
        setLoading(false);
        // Fade in only for first-time users (returning users are already at opacity 1)
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }).start();
      }
    },
    [isFirstLoad], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mediaStoreManager.refreshAlbumsInBackground();
      const availableAlbums = await mediaStoreManager.getAvailableAlbums(true);
      const watchedSet = watchedFolderIds.current;
      const albumsWithStatus: ExtendedAlbumInfo[] = availableAlbums.map(album => ({
        ...album,
        isWatched: watchedSet.has(album.id),
      }));
      setAlbums(albumsWithStatus);
      triggerHaptic();
    } catch (error) {
      console.error('[FolderBrowser] Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // ─── Add-mode handlers ─────────────────────────────────────────────────────

  const toggleSelectAlbum = useCallback((albumId: string) => {
    triggerHaptic();
    setSelectedAlbumIds(prev => {
      const next = new Set(prev);
      if (next.has(albumId)) next.delete(albumId);
      else next.add(albumId);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (selectedAlbumIds.size === 0 || saveInProgress.current) return;
    saveInProgress.current = true;
    setSaving(true);
    const selectedAlbums = albums.filter(a => selectedAlbumIds.has(a.id));
    const firstTimeSave = watchedFolders.length === 0;
    for (const album of selectedAlbums) {
      if (!watchedFolderIds.current.has(album.id)) {
        addWatchedFolder({
          id: album.id,
          path: album.id,
          name: album.title,
          dateAdded: Date.now(),
          lastScan: Date.now(),
          trackCount: album.assetCount || 0,
        });
        mediaStoreManager.addWatchedAlbumWithTracksInBackground(
          album.id,
          album.title,
          album.artworkUri || null,
        );
        setAlbums(prev => prev.map(a => (a.id === album.id ? { ...a, isWatched: true } : a)));
      }
    }
    if (firstTimeSave && selectedAlbums.length > 0) setDefaultView('local');
    setSaving(false);
    saveInProgress.current = false;
    setSelectedAlbumIds(new Set());
    onComplete?.();
    onClose();
  }, [selectedAlbumIds, albums, watchedFolders, addWatchedFolder, setDefaultView, onComplete, onClose]);

  // ─── Selection-mode handlers ───────────────────────────────────────────────

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedForAction(new Set());
  }, []);

  const enterSelectionMode = useCallback((album: ExtendedAlbumInfo) => {
    triggerHaptic();
    setSelectionMode(true);
    setSelectedForAction(new Set([album.id]));
  }, []);

  const toggleActionSelect = useCallback((albumId: string) => {
    triggerHaptic();
    setSelectedForAction(prev => {
      const next = new Set(prev);
      if (next.has(albumId)) next.delete(albumId);
      else next.add(albumId);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const openContextModal = useCallback((album: ExtendedAlbumInfo) => {
    triggerHaptic();
    setContextTarget(album);
  }, []);

  // ─── Manage actions ────────────────────────────────────────────────────────

  const startEdit = useCallback(() => {
    if (!contextTarget) return;
    setEditName(contextTarget.title);
    setEditTarget(contextTarget);
    setContextTarget(null);
  }, [contextTarget]);

  const commitEdit = useCallback(async () => {
    if (!editTarget || !editName.trim() || editSaving) return;
    setEditSaving(true);
    try {
      await mediaStoreManager.renameAlbum(editTarget.id, editName.trim());
      renameWatchedFolder(editTarget.id, editName.trim());
      setAlbums(prev =>
        prev.map(a => (a.id === editTarget.id ? { ...a, title: editName.trim() } : a)),
      );
    } catch (err) {
      Alert.alert('Rename failed', 'Could not rename the folder on your device.');
      console.error('[FolderBrowser] rename error', err);
    } finally {
      setEditSaving(false);
      setEditTarget(null);
    }
  }, [editTarget, editName, editSaving, renameWatchedFolder]);

  const handleRemove = useCallback(
    (ids: string[]) => {
      Alert.alert(
        ids.length > 1 ? `Remove ${ids.length} folders` : 'Remove folder',
        'These folders will be removed from your library. Files stay on your device.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              ids.forEach(id => removeWatchedFolder(id));
              setAlbums(prev =>
                prev.map(a => (ids.includes(a.id) ? { ...a, isWatched: false } : a)),
              );
              exitSelectionMode();
              setContextTarget(null);
            },
          },
        ],
      );
    },
    [removeWatchedFolder, exitSelectionMode],
  );

  const handleDelete = useCallback(
    (ids: string[]) => {
      Alert.alert(
        ids.length > 1 ? `Delete ${ids.length} folders` : 'Delete from device',
        'This will permanently delete these tracks from your device. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                for (const id of ids) {
                  await mediaStoreManager.deleteAlbum(id);
                  removeWatchedFolder(id);
                }
                setAlbums(prev => prev.filter(a => !ids.includes(a.id)));
              } catch (err) {
                Alert.alert('Delete failed', 'Could not delete some files from your device.');
                console.error('[FolderBrowser] delete error', err);
              }
              exitSelectionMode();
              setContextTarget(null);
            },
          },
        ],
      );
    },
    [removeWatchedFolder, exitSelectionMode],
  );

  const openAppSettings = useCallback(() => {
    triggerHaptic();
    if (Platform.OS === 'android') Linking.openSettings();
  }, []);

  // ─── Derived values ────────────────────────────────────────────────────────

  const selectedCount = selectedAlbumIds.size;
  const actionCount = selectedForAction.size;

  const selectionBarTranslateY = selectionBarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [120, 0],
  });

  // ─── Permission denied ────────────────────────────────────────────────────

  if (permissionDenied) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Local Music</Text>
            <View style={{ width: 24 }} />
          </View>
          <View style={styles.centered}>
            <View style={[styles.permissionIconContainer, { backgroundColor: `${colors.gold}15` }]}>
              <Ionicons name="folder-open" size={48} color={colors.gold} />
            </View>
            <Text style={[styles.permissionTitle, { color: colors.text }]}>Storage Access Required</Text>
            <Text style={[styles.permissionText, { color: colors.textSub }]}>
              Mavin needs access to your storage to find and play your local music files.
            </Text>
            <TouchableOpacity style={[styles.settingsButton, { backgroundColor: colors.gold }]} onPress={openAppSettings}>
              <Ionicons name="settings-outline" size={18} color="#000" />
              <Text style={styles.settingsButtonText}>Open Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cancelButton, { borderColor: colors.border }]} onPress={onClose}>
              <Text style={[styles.cancelButtonText, { color: colors.textSub }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // ─── Loading (first-time only) ────────────────────────────────────────────

  if (loading) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Local Music</Text>
            <View style={{ width: 24 }} />
          </View>
          <View style={styles.loadingContainer}>
            <View style={styles.loadingContent}>
              <View style={[styles.spinnerWrapper, { backgroundColor: `${colors.gold}10` }]}>
                <ActivityIndicator size="large" color={colors.gold} />
                <Text style={[styles.percentText, { color: colors.gold }]}>{loadingPercent}%</Text>
              </View>
              <Text style={[styles.loadingMessage, { color: colors.text }]}>
                {shuffledMessages[loadingMessageIndex]}
              </Text>
              <Text style={[styles.loadingSubtext, { color: colors.textSub }]}>
                This may take a moment for large libraries
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // ─── Main list ────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        if (selectionMode) { exitSelectionMode(); return; }
        onClose();
      }}
    >
      {/*
        WHITE FLASH FIX:
        - The outer View always has backgroundColor = colors.background, set as a
          direct style prop. This is painted synchronously by the Modal before any
          JS animation runs, so there is NEVER a white frame regardless of opacity.
        - Returning users: fadeAnim stays at 1 → Animated.View is fully opaque on
          frame 1. No fade animation occurs.
        - First-time users: fadeAnim is set to 0 synchronously in the visible effect,
          then animated to 1 after loadAlbums finishes.
      */}
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}>

          {/* ── Header ─────────────────────────────────────────────────────────── */}
          <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
            {selectionMode ? (
              <>
                <TouchableOpacity onPress={exitSelectionMode} hitSlop={12}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                  {actionCount > 0 ? `${actionCount} selected` : 'Select folders'}
                </Text>
                <TouchableOpacity
                  hitSlop={12}
                  onPress={() => {
                    const allWatchedIds = albums.filter(a => a.isWatched).map(a => a.id);
                    setSelectedForAction(new Set(allWatchedIds));
                  }}
                >
                  <Text style={[styles.saveText, { color: colors.gold }]}>All</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity onPress={onClose} hitSlop={12}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>
                  {manageMode ? 'My Music Folders' : 'Add Music Folders'}
                </Text>
                {manageMode ? (
                  <View style={{ width: 40 }} />
                ) : (
                  <TouchableOpacity onPress={handleSave} disabled={selectedCount === 0 || saving}>
                    <Text
                      style={[
                        styles.saveText,
                        { color: colors.gold, opacity: selectedCount === 0 || saving ? 0.5 : 1 },
                      ]}
                    >
                      {saving ? 'Adding…' : `Add${selectedCount > 0 ? ` ${selectedCount}` : ''}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* ── List ───────────────────────────────────────────────────────────── */}
          <FlatList
            data={albums}
            keyExtractor={item => item.id}
            contentContainerStyle={[
              styles.listContent,
              selectionMode && { paddingBottom: 100 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.gold}
                colors={[colors.gold]}
                progressBackgroundColor={colors.surface}
              />
            }
            initialNumToRender={15}
            maxToRenderPerBatch={20}
            windowSize={10}
            removeClippedSubviews={Platform.OS === 'android'}
            renderItem={({ item }) => {
              const isAddSelected = selectedAlbumIds.has(item.id);
              const isWatched = item.isWatched;
              const isActionSelected = selectedForAction.has(item.id);

              return (
                <TouchableOpacity
                  style={[
                    styles.albumRow,
                    !selectionMode && isAddSelected && { backgroundColor: `${colors.gold}10` },
                    selectionMode && isActionSelected && { backgroundColor: `${colors.gold}12` },
                    !manageMode && !selectionMode && isWatched && styles.watchedRow,
                  ]}
                  onPress={() => {
                    if (selectionMode) {
                      if (isWatched) toggleActionSelect(item.id);
                      return;
                    }
                    if (manageMode) {
                      if (isWatched) openContextModal(item);
                      return;
                    }
                    if (!isWatched) toggleSelectAlbum(item.id);
                  }}
                  onLongPress={() => {
                    if (!selectionMode && isWatched) enterSelectionMode(item);
                  }}
                  delayLongPress={350}
                  activeOpacity={0.7}
                >
                  {/* Leading icon / checkbox */}
                  {selectionMode && isWatched ? (
                    <View
                      style={[
                        styles.selectionCircle,
                        isActionSelected
                          ? { backgroundColor: colors.gold, borderColor: colors.gold }
                          : { borderColor: colors.border },
                      ]}
                    >
                      {isActionSelected && <Ionicons name="checkmark" size={13} color="#000" />}
                    </View>
                  ) : (
                    <View style={[styles.albumIcon, { backgroundColor: colors.surface }]}>
                      <Ionicons
                        name={isWatched ? 'checkmark-circle' : 'folder-outline'}
                        size={20}
                        color={isWatched ? colors.gold : colors.textMuted}
                      />
                    </View>
                  )}

                  {/* Info */}
                  <View style={styles.albumInfo}>
                    <Text
                      style={[
                        styles.albumName,
                        {
                          color:
                            !manageMode && !selectionMode && isWatched
                              ? colors.textMuted
                              : colors.text,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                    <Text style={[styles.albumCount, { color: colors.textSub }]}>
                      {item.assetCount} {item.assetCount === 1 ? 'track' : 'tracks'}
                    </Text>
                  </View>

                  {/* Trailing */}
                  {!selectionMode && (
                    isWatched ? (
                      manageMode ? (
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                      ) : (
                        <View style={styles.watchedIndicator}>
                          <Text style={[styles.watchedText, { color: colors.gold }]}>Added</Text>
                        </View>
                      )
                    ) : (
                      !manageMode && (
                        <View
                          style={[
                            styles.checkbox,
                            isAddSelected && { backgroundColor: colors.gold, borderColor: colors.gold },
                          ]}
                        >
                          {isAddSelected && <Ionicons name="checkmark" size={14} color="#000" />}
                        </View>
                      )
                    )
                  )}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIconContainer, { backgroundColor: `${colors.gold}10` }]}>
                  <Ionicons name="folder-open" size={40} color={colors.gold} />
                </View>
                <Text style={[styles.emptyText, { color: colors.textSub }]}>No folders found</Text>
                <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
                  Pull down to refresh and scan for music folders
                </Text>
              </View>
            }
          />

          {/* ── Instagram-style bottom selection bar ────────────────────────────── */}
          <Animated.View
            style={[
              styles.selectionBar,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                paddingBottom: insets.bottom + 8,
                transform: [{ translateY: selectionBarTranslateY }],
              },
            ]}
            pointerEvents={selectionMode ? 'auto' : 'none'}
          >
            {/* Remove — unwatch, keep files on device */}
            <TouchableOpacity
              style={styles.selectionBarAction}
              onPress={() => handleRemove(Array.from(selectedForAction))}
              disabled={actionCount === 0}
            >
              <View
                style={[
                  styles.selectionBarIconWrap,
                  { backgroundColor: `${colors.textSub}15`, opacity: actionCount === 0 ? 0.35 : 1 },
                ]}
              >
                <Ionicons name="remove-circle-outline" size={22} color={colors.text} />
              </View>
              <Text style={[styles.selectionBarLabel, { color: colors.textSub }]}>Remove</Text>
            </TouchableOpacity>

            {/* Delete — erase from device permanently */}
            <TouchableOpacity
              style={styles.selectionBarAction}
              onPress={() => handleDelete(Array.from(selectedForAction))}
              disabled={actionCount === 0}
            >
              <View
                style={[
                  styles.selectionBarIconWrap,
                  { backgroundColor: '#FF3B3015', opacity: actionCount === 0 ? 0.35 : 1 },
                ]}
              >
                <Ionicons name="trash-outline" size={22} color="#FF3B30" />
              </View>
              <Text style={[styles.selectionBarLabel, { color: '#FF3B30' }]}>Delete</Text>
            </TouchableOpacity>
          </Animated.View>

        </Animated.View>
      </View>

      {/* ── Context action sheet (tap in manageMode or long-press) ──────────── */}
      <Modal
        visible={!!contextTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setContextTarget(null)}
      >
        <TouchableOpacity
          style={styles.contextOverlay}
          activeOpacity={1}
          onPress={() => setContextTarget(null)}
        >
          <View style={[styles.contextSheet, { backgroundColor: colors.surface }]}>
            {/* Folder identity */}
            <View style={styles.contextHeader}>
              <View style={[styles.contextIconWrap, { backgroundColor: `${colors.gold}15` }]}>
                <Ionicons name="folder-outline" size={22} color={colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.contextName, { color: colors.text }]} numberOfLines={1}>
                  {contextTarget?.title}
                </Text>
                <Text style={[styles.contextCount, { color: colors.textSub }]}>
                  {contextTarget?.assetCount}{' '}
                  {contextTarget?.assetCount === 1 ? 'track' : 'tracks'}
                </Text>
              </View>
            </View>

            <View style={[styles.contextDivider, { backgroundColor: colors.border }]} />

            <TouchableOpacity style={styles.contextAction} onPress={startEdit}>
              <Ionicons name="pencil-outline" size={20} color={colors.text} />
              <Text style={[styles.contextActionText, { color: colors.text }]}>Edit name</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.contextAction}
              onPress={() => contextTarget && handleRemove([contextTarget.id])}
            >
              <Ionicons name="remove-circle-outline" size={20} color={colors.text} />
              <Text style={[styles.contextActionText, { color: colors.text }]}>
                Remove from library
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.contextAction}
              onPress={() => contextTarget && handleDelete([contextTarget.id])}
            >
              <Ionicons name="trash-outline" size={20} color="#FF3B30" />
              <Text style={[styles.contextActionText, { color: '#FF3B30' }]}>
                Delete from device
              </Text>
            </TouchableOpacity>

            <View style={[styles.contextDivider, { backgroundColor: colors.border }]} />

            <TouchableOpacity style={styles.contextAction} onPress={() => setContextTarget(null)}>
              <Text
                style={[
                  styles.contextActionText,
                  { color: colors.textSub, flex: 1, textAlign: 'center' },
                ]}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Edit name dialog ─────────────────────────────────────────────────── */}
      <Modal
        visible={!!editTarget}
        transparent
        animationType="fade"
        onRequestClose={() => !editSaving && setEditTarget(null)}
      >
        <View style={styles.contextOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => !editSaving && setEditTarget(null)}
          />
          <View style={[styles.editSheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.editTitle, { color: colors.text }]}>Rename Folder</Text>
            <Text style={[styles.editSubtitle, { color: colors.textSub }]}>
              This will rename the folder on your device.
            </Text>
            <TextInput
              style={[
                styles.editInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              value={editName}
              onChangeText={setEditName}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={commitEdit}
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.editActions}>
              <TouchableOpacity
                style={[styles.editBtn, { borderColor: colors.border }]}
                onPress={() => setEditTarget(null)}
                disabled={editSaving}
              >
                <Text style={[styles.editBtnText, { color: colors.textSub }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.editBtn,
                  styles.editBtnPrimary,
                  { backgroundColor: colors.gold, opacity: editSaving || !editName.trim() ? 0.5 : 1 },
                ]}
                onPress={commitEdit}
                disabled={editSaving || !editName.trim()}
              >
                <Text style={styles.editBtnPrimaryText}>{editSaving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },
  saveText: { fontSize: 15, fontWeight: '600' },
  listContent: { paddingVertical: 8, paddingBottom: 20 },

  // ── Loading ────────────────────────────────────────────────────────────────
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingContent: { alignItems: 'center', paddingHorizontal: 32, width: '100%' },
  spinnerWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    position: 'relative',
  },
  percentText: {
    position: 'absolute',
    bottom: 10,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  loadingMessage: { fontSize: 17, fontWeight: '500', textAlign: 'center', marginBottom: 8 },
  loadingSubtext: { fontSize: 13, textAlign: 'center', lineHeight: 18, opacity: 0.7 },

  // ── Permission ─────────────────────────────────────────────────────────────
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  permissionIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  permissionTitle: { fontSize: 20, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  permissionText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
    opacity: 0.8,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
    marginBottom: 12,
  },
  settingsButtonText: { color: '#000', fontSize: 15, fontWeight: '600' },
  cancelButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, borderWidth: 0.5 },
  cancelButtonText: { fontSize: 15, fontWeight: '500' },

  // ── Empty ──────────────────────────────────────────────────────────────────
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyText: { fontSize: 16, fontWeight: '500', marginBottom: 8 },
  emptySubtext: { fontSize: 13, textAlign: 'center', lineHeight: 18 },

  // ── Album rows ─────────────────────────────────────────────────────────────
  albumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 12,
    marginVertical: 3,
    borderRadius: 10,
  },
  watchedRow: { opacity: 0.7 },
  albumIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  albumInfo: { flex: 1 },
  albumName: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  albumCount: { fontSize: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchedIndicator: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  watchedText: { fontSize: 12, fontWeight: '500' },

  // ── Instagram selection circle ─────────────────────────────────────────────
  selectionCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  // ── Instagram-style bottom bar ─────────────────────────────────────────────
  selectionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 0.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 12,
  },
  selectionBarAction: { alignItems: 'center', gap: 6, flex: 1 },
  selectionBarIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionBarLabel: { fontSize: 11, fontWeight: '500' },

  // ── Context sheet ──────────────────────────────────────────────────────────
  contextOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  contextSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 34,
    overflow: 'hidden',
  },
  contextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  contextIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextName: { fontSize: 15, fontWeight: '600' },
  contextCount: { fontSize: 12, marginTop: 2 },
  contextDivider: { height: 0.5 },
  contextAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  contextActionText: { fontSize: 15, fontWeight: '500' },

  // ── Edit dialog ────────────────────────────────────────────────────────────
  editSheet: {
    marginHorizontal: 24,
    borderRadius: 20,
    padding: 24,
  },
  editTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  editSubtitle: { fontSize: 13, marginBottom: 20, lineHeight: 18 },
  editInput: {
    fontSize: 15,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  editActions: { flexDirection: 'row', gap: 10 },
  editBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 0.5,
  },
  editBtnText: { fontSize: 15, fontWeight: '500' },
  editBtnPrimary: { borderWidth: 0 },
  editBtnPrimaryText: { fontSize: 15, fontWeight: '600', color: '#000' },
});
