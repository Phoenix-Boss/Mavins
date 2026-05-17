// components/localMusic/WatchedFoldersList.tsx
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalMusicStore } from '@/store/localMusicStore';
import { mediaStoreManager } from '@/utils/localMediaStoreManager';
import { loadArtworkFromCache } from '@/utils/artworkCache';
import { triggerHaptic } from '@/helpers/haptics';

interface WatchedFoldersListProps {
  onClose: () => void;
}

export function WatchedFoldersList({ onClose }: WatchedFoldersListProps) {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [folders, setFolders] = useState<any[]>([]);
  
  const { removeWatchedFolder, clearAllWatchedFolders } = useLocalMusicStore();
  
  const loadFolders = useCallback(async () => {
    const watchedAlbums = await mediaStoreManager.getWatchedAlbums();
    const foldersWithTracks = await Promise.all(
      watchedAlbums.map(async (album) => {
        const tracks = await mediaStoreManager.getAlbumLocalTracks(album.album_id);
        return { ...album, trackCount: tracks.length };
      })
    );
    setFolders(foldersWithTracks);
  }, []);
  
  const handleRemove = useCallback((albumId: string, albumName: string) => {
    triggerHaptic();
    Alert.alert(
      'Remove Folder',
      `Remove "${albumName}" from your library? Your files will not be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await mediaStoreManager.removeWatchedAlbum(albumId);
            removeWatchedFolder(albumId);
            loadFolders();
          },
        },
      ]
    );
  }, [removeWatchedFolder, loadFolders]);
  
  const handleRemoveAll = useCallback(() => {
    triggerHaptic();
    Alert.alert(
      'Remove All Folders',
      'Remove all local music from your library? Your files will not be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove All',
          style: 'destructive',
          onPress: async () => {
            for (const folder of folders) {
              await mediaStoreManager.removeWatchedAlbum(folder.album_id);
            }
            clearAllWatchedFolders();
            loadFolders();
          },
        },
      ]
    );
  }, [folders, clearAllWatchedFolders, loadFolders]);
  
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFolders();
    setRefreshing(false);
  }, [loadFolders]);
  
  useEffect(() => {
    loadFolders();
  }, [loadFolders]);
  
  return (
    <FlatList
      data={folders}
      keyExtractor={(item) => item.album_id}
      renderItem={({ item }) => (
        <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.iconContainer}>
            <Ionicons name="folder" size={28} color={colors.gold} />
          </View>
          <View style={styles.info}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{item.album_name}</Text>
            <Text style={[styles.meta, { color: colors.textSub }]}>
              {item.trackCount} {item.trackCount === 1 ? 'track' : 'tracks'} • Added {new Date(item.date_added).toLocaleDateString()}
            </Text>
          </View>
          <TouchableOpacity onPress={() => handleRemove(item.album_id, item.album_name)} hitSlop={12}>
            <Ionicons name="close-circle-outline" size={22} color="#FF4535" />
          </TouchableOpacity>
        </View>
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.gold} colors={[colors.gold]} />}
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textSub }]}>No watched folders</Text>
          <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>Add folders from the Local Music browser</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  listContent: { paddingVertical: 8, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14, marginBottom: 10, borderWidth: 0.5 },
  iconContainer: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 2 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, fontWeight: '500', marginTop: 16 },
  emptySubtext: { fontSize: 13, marginTop: 8, textAlign: 'center' },
});
