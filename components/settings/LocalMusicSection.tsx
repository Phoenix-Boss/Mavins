// components/settings/LocalMusicSection.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalMusicStore } from '@/store/localMusicStore';
import { mediaStoreManager } from '@/utils/localMediaStoreManager';
import { getArtworkCacheSizeMB, clearArtworkCache } from '@/utils/artworkCache';
import { getTotalTrackCount } from '@/db/localDatabase';
import { triggerHaptic } from '@/helpers/haptics';

export function LocalMusicSection() {
  const { colors } = useTheme();
  const { defaultView, setDefaultView, watchedFolders, clearAllWatchedFolders } = useLocalMusicStore();
  
  const [totalTracks, setTotalTracks] = useState(0);
  const [cacheSize, setCacheSize] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  
  useEffect(() => {
    loadStats();
  }, [watchedFolders]);
  
  const loadStats = async () => {
    const tracks = await getTotalTrackCount();
    const size = await getArtworkCacheSizeMB();
    setTotalTracks(tracks);
    setCacheSize(size);
  };
  
  const handleRescan = async () => {
    triggerHaptic();
    setIsScanning(true);
    await mediaStoreManager.refreshAllWatchedAlbums();
    await loadStats();
    setIsScanning(false);
    Alert.alert('Rescan Complete', 'Your local music library has been refreshed.');
  };
  
  const handleClearCache = async () => {
    triggerHaptic();
    Alert.alert('Clear Artwork Cache', `Clear ${cacheSize.toFixed(1)}MB of cached artwork?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', onPress: async () => { await clearArtworkCache(); await loadStats(); } },
    ]);
  };
  
  const handleClearAll = async () => {
    triggerHaptic();
    Alert.alert('Clear All Local Music', 'Remove all local music from your library? Your files will not be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear All', style: 'destructive', onPress: async () => {
          for (const folder of watchedFolders) {
            await mediaStoreManager.removeWatchedAlbum(folder.id);
          }
          clearAllWatchedFolders();
          await loadStats();
        },
      },
    ]);
  };
  
  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Local Music</Text>
      
      <View style={styles.settingRow}>
        <View style={styles.settingInfo}><Ionicons name="musical-notes-outline" size={20} color={colors.gold} /><Text style={[styles.settingLabel, { color: colors.text }]}>Total Tracks</Text></View>
        <Text style={[styles.settingValue, { color: colors.textSub }]}>{totalTracks}</Text>
      </View>
      
      <View style={styles.settingRow}>
        <View style={styles.settingInfo}><Ionicons name="folder-outline" size={20} color={colors.gold} /><Text style={[styles.settingLabel, { color: colors.text }]}>Watched Folders</Text></View>
        <Text style={[styles.settingValue, { color: colors.textSub }]}>{watchedFolders.length}</Text>
      </View>
      
      <View style={styles.settingRow}>
        <View style={styles.settingInfo}><Ionicons name="images-outline" size={20} color={colors.gold} /><Text style={[styles.settingLabel, { color: colors.text }]}>Artwork Cache</Text></View>
        <Text style={[styles.settingValue, { color: colors.textSub }]}>{cacheSize.toFixed(1)} MB</Text>
      </View>
      
      <View style={styles.settingRow}>
        <View style={styles.settingInfo}><Ionicons name="swap-horizontal-outline" size={20} color={colors.gold} /><Text style={[styles.settingLabel, { color: colors.text }]}>Default View</Text></View>
        <View style={styles.switchContainer}>
          <Text style={[styles.switchLabel, { color: colors.textSub }]}>{defaultView === 'normal' ? 'Normal' : 'Local'}</Text>
          <Switch value={defaultView === 'local'} onValueChange={() => setDefaultView(defaultView === 'normal' ? 'local' : 'normal')} trackColor={{ false: colors.border, true: colors.gold }} thumbColor="#fff" />
        </View>
      </View>
      
      <TouchableOpacity style={styles.actionButton} onPress={handleRescan} disabled={isScanning}>
        <Ionicons name="refresh-outline" size={20} color={colors.gold} /><Text style={[styles.actionText, { color: colors.text }]}>{isScanning ? 'Scanning...' : 'Rescan All Folders'}</Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={styles.actionButton} onPress={handleClearCache}>
        <Ionicons name="trash-outline" size={20} color={colors.textMuted} /><Text style={[styles.actionText, { color: colors.textSub }]}>Clear Artwork Cache</Text>
      </TouchableOpacity>
      
      <TouchableOpacity style={[styles.actionButton, styles.dangerButton]} onPress={handleClearAll}>
        <Ionicons name="warning-outline" size={20} color="#FF4535" /><Text style={[styles.actionText, { color: '#FF4535' }]}>Clear All Local Music</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 16, marginHorizontal: 16, marginVertical: 8, paddingVertical: 8, overflow: 'hidden' },
  sectionTitle: { fontSize: 16, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 12 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.07)' },
  settingInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingLabel: { fontSize: 15 },
  settingValue: { fontSize: 14 },
  switchContainer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchLabel: { fontSize: 14 },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.07)' },
  actionText: { fontSize: 15 },
  dangerButton: { borderTopWidth: 0.5, borderTopColor: '#FF453520' },
});
