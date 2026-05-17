// components/localMusic/FileRow.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { moderateScale } from 'react-native-size-matters/extend';

interface FileRowProps {
  name: string;
  path: string;
  size?: number;
  extension?: string;
}

export function FileRow({ name, path, size, extension }: FileRowProps) {
  const { colors } = useTheme();
  
  const formatSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  
  const getIconName = () => {
    const audioExtensions = ['mp3', 'm4a', 'flac', 'wav', 'ogg'];
    if (extension && audioExtensions.includes(extension)) {
      return 'musical-notes';
    }
    return 'document-outline';
  };
  
  return (
    <View style={styles.container}>
      <View style={[styles.iconContainer, { backgroundColor: colors.surface }]}>
        <Ionicons name={getIconName()} size={moderateScale(20)} color={colors.textMuted} />
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.textMuted }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.meta, { color: colors.textSub }]} numberOfLines={1}>
          {formatSize(size)} • {extension?.toUpperCase() || 'Audio'}
        </Text>
      </View>
      <View style={styles.disabledBadge}>
        <Ionicons name="lock-closed" size={moderateScale(14)} color={colors.textMuted} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    opacity: 0.6,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '500',
  },
  meta: {
    fontSize: 11,
    marginTop: 2,
  },
  disabledBadge: {
    width: 36,
    alignItems: 'center',
  },
});
