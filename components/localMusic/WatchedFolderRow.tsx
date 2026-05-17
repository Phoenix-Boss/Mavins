// components/localMusic/WatchedFolderRow.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { moderateScale } from 'react-native-size-matters/extend';

interface WatchedFolderRowProps {
  name: string;
  path: string;
  trackCount: number;
  dateAdded: number;
  onRemove: () => void;
}

export function WatchedFolderRow({ name, path, trackCount, dateAdded, onRemove }: WatchedFolderRowProps) {
  const { colors } = useTheme();
  
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };
  
  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.iconContainer}>
        <Ionicons name="folder" size={moderateScale(28)} color={colors.gold} />
      </View>
      
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.path, { color: colors.textSub }]} numberOfLines={1}>
          {path}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.metaText, { color: colors.textMuted }]}>
            {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
          </Text>
          <Text style={[styles.metaText, { color: colors.textMuted }]}>•</Text>
          <Text style={[styles.metaText, { color: colors.textMuted }]}>
            Added {formatDate(dateAdded)}
          </Text>
        </View>
      </View>
      
      <TouchableOpacity style={styles.removeButton} onPress={onRemove} hitSlop={12}>
        <Ionicons name="close-circle-outline" size={moderateScale(22)} color="#FF4535" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 0.5,
  },
  iconContainer: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
  },
  path: {
    fontSize: 12,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  metaText: {
    fontSize: 11,
  },
  removeButton: {
    padding: 4,
  },
});
