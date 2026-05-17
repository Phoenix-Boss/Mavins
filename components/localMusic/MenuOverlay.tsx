// components/localMusic/MenuOverlay.tsx
import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalMusicStore } from '@/store/localMusicStore';
import { useRouter } from 'expo-router';
import { triggerHaptic } from '@/helpers/haptics';
import { mediaStoreManager } from '@/utils/localMediaStoreManager';
import { clearArtworkCache } from '@/utils/artworkCache';

interface MenuOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export function MenuOverlay({ visible, onClose }: MenuOverlayProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const { 
    clearSelectedFolders, 
    clearAllWatchedFolders, 
    defaultView, 
    setDefaultView,
    watchedFolders
  } = useLocalMusicStore();
  
  const handleViewWatchedFolders = () => {
    triggerHaptic();
    onClose();
    router.push('/(modals)/watchedFolders');
  };
  
  const handleClearSelections = () => {
    triggerHaptic();
    clearSelectedFolders();
    onClose();
  };
  
  const handleDefaultViewToggle = () => {
    triggerHaptic();
    const newView = defaultView === 'normal' ? 'local' : 'normal';
    setDefaultView(newView);
    onClose();
  };
  
  const handleClearAllWatched = () => {
    triggerHaptic();
    Alert.alert(
      'Clear All Watched Folders',
      'Remove all local music from your library? Your files will not be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            for (const folder of watchedFolders) {
              await mediaStoreManager.removeWatchedFolder(folder.id);
            }
            clearAllWatchedFolders();
            onClose();
          },
        },
      ]
    );
  };
  
  const handleClearCache = () => {
    triggerHaptic();
    Alert.alert(
      'Clear Artwork Cache',
      'Clear cached album artwork? This will free up storage space.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          onPress: async () => {
            await clearArtworkCache();
            onClose();
          },
        },
      ]
    );
  };
  
  const handleSettings = () => {
    triggerHaptic();
    onClose();
    router.push('/(player)/settings');
  };
  
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.container, { paddingBottom: insets.bottom + 16, backgroundColor: colors.surface }]}>
        <View style={styles.handle} />
        
        <TouchableOpacity style={styles.menuItem} onPress={handleViewWatchedFolders}>
          <Ionicons name="folder-open-outline" size={22} color={colors.text} />
          <Text style={[styles.menuText, { color: colors.text }]}>View Watched Folders</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={styles.chevron} />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.menuItem} onPress={handleClearSelections}>
          <Ionicons name="close-circle-outline" size={22} color={colors.text} />
          <Text style={[styles.menuText, { color: colors.text }]}>Clear All Selections</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.menuItem} onPress={handleDefaultViewToggle}>
          <Ionicons name="swap-horizontal-outline" size={22} color={colors.text} />
          <Text style={[styles.menuText, { color: colors.text }]}>Default View</Text>
          <Text style={[styles.menuValue, { color: colors.gold }]}>
            {defaultView === 'normal' ? 'Normal Library' : 'Local Music'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.menuItem} onPress={handleClearCache}>
          <Ionicons name="trash-outline" size={22} color={colors.text} />
          <Text style={[styles.menuText, { color: colors.text }]}>Clear Artwork Cache</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.menuItem} onPress={handleClearAllWatched}>
          <Ionicons name="warning-outline" size={22} color="#FF4535" />
          <Text style={[styles.menuText, { color: '#FF4535' }]}>Clear All Watched Folders</Text>
        </TouchableOpacity>
        
        <View style={styles.divider} />
        
        <TouchableOpacity style={styles.menuItem} onPress={handleSettings}>
          <Ionicons name="settings-outline" size={22} color={colors.text} />
          <Text style={[styles.menuText, { color: colors.text }]}>Settings</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.menuItem} onPress={onClose}>
          <Ionicons name="close-outline" size={22} color={colors.textSub} />
          <Text style={[styles.menuText, { color: colors.textSub }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  menuText: {
    fontSize: 16,
    marginLeft: 12,
    flex: 1,
  },
  chevron: {
    marginLeft: 'auto',
  },
  menuValue: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 8,
  },
});
