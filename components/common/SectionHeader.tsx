/**
 * Section Header Component - Reusable header for all sections
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Metallic Gold Color Palette
const COLORS = {
  background: '#000000',
  surface: '#121212',
  goldPrimary: '#D4AF37',
  text: '#FFFFFF',
};

interface SectionHeaderProps {
  title: string;
  showPlayAll?: boolean;
  onPlayAllPress?: () => void;
}

export const SectionHeader = ({ 
  title, 
  showPlayAll = false,
  onPlayAllPress 
}: SectionHeaderProps) => {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {showPlayAll && (
        <TouchableOpacity 
          style={styles.playAllButton} 
          onPress={onPlayAllPress}
          activeOpacity={0.7}
        >
          <Text style={styles.playAllText}>Play all</Text>
          <Ionicons name="play" size={14} color={COLORS.goldPrimary} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  playAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.goldPrimary,
  },
  playAllText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.goldPrimary,
    marginRight: 4,
  },
});