// components/localMusic/FolderRow.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { moderateScale } from 'react-native-size-matters/extend';

interface FolderRowProps {
  name: string;
  path: string;
  isSelected: boolean;
  onPress: () => void;
  onSelect: () => void;
}

export function FolderRow({ name, path, isSelected, onPress, onSelect }: FolderRowProps) {
  const { colors } = useTheme();
  
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.folderArea} onPress={onPress} activeOpacity={0.7}>
        <View style={[styles.iconContainer, { backgroundColor: colors.surface }]}>
          <Ionicons name="folder" size={moderateScale(24)} color={colors.gold} />
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.path, { color: colors.textSub }]} numberOfLines={1}>
            {path}
          </Text>
        </View>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.selectButton, isSelected && { backgroundColor: colors.gold }]}
        onPress={onSelect}
        hitSlop={12}
      >
        <Ionicons
          name={isSelected ? 'checkmark' : 'add'}
          size={moderateScale(18)}
          color={isSelected ? '#000' : colors.gold}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  folderArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
    fontSize: 16,
    fontWeight: '500',
  },
  path: {
    fontSize: 12,
    marginTop: 2,
  },
  selectButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
});
