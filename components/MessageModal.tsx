/**
 * MessageModal - Fetches and displays a message from Firebase Firestore.
 * Uses @react-native-firebase for native Android offline support.
 * Follows project conventions: useTheme, useAlert, triggerHaptic.
 */

import { useTheme } from "@/contexts/ThemeContext";
import { useAlert } from "@/contexts/AlertContext";
import { triggerHaptic } from "@/helpers/haptics";
import { storage } from "@/storage";
import firestore from "@react-native-firebase/firestore";
import React, { useEffect, useState } from "react";
import { Linking, Modal, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { moderateScale, scale, verticalScale } from "react-native-size-matters/extend";

export const MessageModal = () => {
  const { colors, isDark } = useTheme();
  const { showAlert } = useAlert();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchMessage = async () => {
      try {
        const docSnap = await firestore()
          .collection("appData")
          .doc("activeMessage")
          .get();

        if (docSnap.exists) {
          const data = docSnap.data();
          const storedMessageId = await storage.getString("lastSeenMessageId");

          if (storedMessageId !== data?.id || !data?.showOnce) {
            setMessage(data?.content ?? null);
            setIsModalVisible(true);
            await storage.set("lastSeenMessageId", data?.id ?? "");
          }
        }
      } catch (error: any) {
        console.error("[MessageModal] Firestore fetch error:", error);
        // Silently fail — don't crash the app if offline
        // Optionally show alert for debugging:
        // showAlert("Connection Issue", "Could not load latest message. Please check your internet connection.");
      }
    };

    fetchMessage();
  }, []);

  const handleLinkPress = (url: string) => {
    triggerHaptic();
    Linking.openURL(url).catch((err) => {
      console.error("Failed to open URL:", err);
      showAlert("Error", "Could not open the link.");
    });
  };

  const handleDismiss = () => {
    triggerHaptic();
    setIsModalVisible(false);
  };

  if (!message) return null;

  return (
    <Modal
      visible={isModalVisible}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.modalContent,
            {
              backgroundColor: isDark ? colors.surface : colors.surface,
              borderColor: colors.borderGold,
              borderWidth: 0.5,
            },
          ]}
        >
          <View style={[styles.topAccent, { backgroundColor: colors.gold }]} />

          <Text style={[styles.modalText, { color: colors.text }]}>
            {message
              .replace(/\\n/g, "\n")
              .split(/(https?:\/\/\S+)/)
              .map((part, index) =>
                /^https?:\/\//.test(part) ? (
                  <Text
                    key={index}
                    style={[styles.linkText, { color: colors.gold }]}
                    onPress={() => handleLinkPress(part)}
                  >
                    {part}
                  </Text>
                ) : (
                  <Text key={index} style={{ color: colors.text }}>
                    {part}
                  </Text>
                ),
              )}
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.borderGold }]} />

          <TouchableOpacity
            style={[styles.modalButton, { backgroundColor: colors.goldFillStrong }]}
            onPress={handleDismiss}
            activeOpacity={0.7}
          >
            <Text style={[styles.modalButtonText, { color: colors.gold }]}>
              Dismiss
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    paddingHorizontal: moderateScale(28),
  },
  modalContent: {
    width: "100%",
    maxWidth: 340,
    borderRadius: moderateScale(20),
    overflow: "hidden",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 24,
  },
  topAccent: {
    height: verticalScale(3),
    width: "100%",
  },
  modalText: {
    fontSize: moderateScale(16),
    textAlign: "center",
    lineHeight: moderateScale(24),
    paddingHorizontal: moderateScale(20),
    paddingTop: verticalScale(22),
    paddingBottom: verticalScale(14),
  },
  linkText: {
    textDecorationLine: "underline",
    fontWeight: "600",
  },
  divider: {
    height: 0.5,
    width: "100%",
  },
  modalButton: {
    width: "100%",
    paddingVertical: verticalScale(16),
    alignItems: "center",
    justifyContent: "center",
  },
  modalButtonText: {
    fontSize: moderateScale(15),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});