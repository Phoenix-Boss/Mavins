/**
 * This file provides wrapper functions for the `expo-haptics` library,
 * making it easier to trigger different types of haptic feedback consistently
 * across the application.
 */

import * as Haptics from "expo-haptics";

type HapticStrength = "light" | "medium" | "heavy";

/**
 * Triggers haptic feedback with a simple string-based API.
 * 
 * @param {HapticStrength} [strength="light"] - The intensity of haptic feedback
 * @example
 * triggerHaptic("light")   // For subtle feedback (button presses)
 * triggerHaptic("medium")  // For moderate feedback (swipe actions)
 * triggerHaptic("heavy")   // For strong feedback (important actions)
 */
export const triggerHaptic = async (
  strength: HapticStrength = "light"
) => {
  try {
    const map = {
      light: Haptics.ImpactFeedbackStyle.Light,
      medium: Haptics.ImpactFeedbackStyle.Medium,
      heavy: Haptics.ImpactFeedbackStyle.Heavy,
    };

    await Haptics.impactAsync(map[strength]);
  } catch (error) {
    // Fail silently in development, no user impact
    if (__DEV__) {
      console.warn("Haptic feedback unavailable:", error);
    }
  }
};

/**
 * Triggers a notification-style haptic feedback for status events.
 * 
 * @param {Haptics.NotificationFeedbackType} [type=Haptics.NotificationFeedbackType.Success] - 
 *   The type of notification feedback
 * @example
 * triggerNotificationHaptic(Haptics.NotificationFeedbackType.Success)  // For success actions
 * triggerNotificationHaptic(Haptics.NotificationFeedbackType.Warning)  // For warnings
 * triggerNotificationHaptic(Haptics.NotificationFeedbackType.Error)    // For errors
 */
export const triggerNotificationHaptic = async (
  type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success
) => {
  try {
    await Haptics.notificationAsync(type);
  } catch (error) {
    if (__DEV__) {
      console.warn("Notification haptic error:", error);
    }
  }
};