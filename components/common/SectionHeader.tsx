// components/common/SectionHeader.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { triggerHaptic } from "@/helpers/haptics";
import { useTheme } from "@/contexts/ThemeContext";

interface SectionHeaderProps {
  title: string;
  showPlayAll?: boolean;
  onPlayAllPress?: () => void;
}

export const SectionHeader = ({ title, showPlayAll = false, onPlayAllPress }: SectionHeaderProps) => {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {showPlayAll && (
        <TouchableOpacity 
          onPress={() => { triggerHaptic(); onPlayAllPress?.(); }} 
          activeOpacity={0.7}
        >
          <Text style={[styles.playAllText, { color: colors.gold }]}>Play All</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
  },
  playAllText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
