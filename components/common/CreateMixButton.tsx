// components/common/CreateMixButton.tsx
import React from "react";
import { TouchableOpacity, StyleSheet, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { triggerHaptic } from "@/helpers/haptics";
import { useTheme } from "@/contexts/ThemeContext";

export const CreateMixButton = () => {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const handlePress = () => {
    triggerHaptic();
    router.push("/(player)/create-mix");
  };

  // Light mode: darker gold/brown for better contrast
  // Dark mode: bright gold for visibility
  const buttonColor = isDark ? colors.gold : "#B8860B";
  const iconColor = isDark ? "#000" : "#FFF";

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: buttonColor }]}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      <Ionicons name="add" size={24} color={iconColor} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
});
