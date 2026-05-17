// app/(modals)/watchedFolders.tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { WatchedFoldersList } from '@/components/localMusic/WatchedFoldersList';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { triggerHaptic } from '@/helpers/haptics';

export default function WatchedFoldersModal() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const handleClose = () => {
    triggerHaptic();
    router.back();
  };
  
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleClose}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Watched Folders</Text>
        <View style={{ width: 24 }} />
      </View>
      <WatchedFoldersList onClose={handleClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
});
