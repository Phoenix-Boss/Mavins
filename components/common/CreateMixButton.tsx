/**
 * Create Mix Button Component - Circular + button for mix creation
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
  goldShiny: '#FFD700',
  textTertiary: '#808080',
};

interface CreateMixButtonProps {
  onPress?: () => void;
}

export const CreateMixButton = ({ onPress }: CreateMixButtonProps) => {
  return (
    <View style={styles.createMixContainer}>
      <TouchableOpacity 
        style={styles.createMixCircleButton} 
        onPress={onPress}
        activeOpacity={0.7}
      >
        <Ionicons name="add" size={28} color={COLORS.goldShiny} />
      </TouchableOpacity>
      <Text style={styles.createMixLabel}>Create Mix</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  createMixContainer: {
    alignItems: 'center',
    marginRight: 16,
  },
  createMixCircleButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: COLORS.goldShiny,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.goldShiny,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  createMixLabel: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 6,
    textAlign: 'center',
  },
});