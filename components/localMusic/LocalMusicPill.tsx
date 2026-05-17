// components/localMusic/LocalMusicPill.tsx
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalMusicStore } from '@/store/localMusicStore';

interface LocalMusicPillProps {
  onPress: () => void;
}

export function LocalMusicPill({ onPress }: LocalMusicPillProps) {
  const { colors } = useTheme();
  const { watchedFolders } = useLocalMusicStore();
  
  return (
    <TouchableOpacity style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={onPress}>
      <Ionicons name="phone-portrait-outline" size={18} color={colors.gold} />
      <Text style={[styles.label, { color: colors.text }]}>Local Music</Text>
      {watchedFolders.length > 0 && (
        <Text style={[styles.badge, { backgroundColor: colors.gold }]}>{watchedFolders.length}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 30,
    gap: 8,
    borderWidth: 0.5,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: '700',
    color: '#000',
  },
});
