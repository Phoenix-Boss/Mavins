import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "@/libs/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_STORAGE_KEY = "@mavin:fcm_token";
const DEVICE_ID_KEY = "@mavin:device_id";

export async function registerForPushNotifications() {
  try {
    // Get existing token
    let token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);

    // Request permissions
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Failed to get push token for push notification!");
      return null;
    }

    // Get device ID
    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = await Notifications.getDevicePushTokenAsync().then(
        (t) => t.data,
      );
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    }

    // Get FCM token
    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({
      projectId: "ff9d3099-4364-4fb1-b6b9-587726f4c7e9",
    });

    // Save token
    await AsyncStorage.setItem(TOKEN_STORAGE_KEY, pushToken);

    // Register with backend
    await registerTokenWithBackend(pushToken, deviceId);

    return pushToken;
  } catch (error) {
    console.error("Failed to register for push notifications:", error);
    return null;
  }
}

async function registerTokenWithBackend(token: string, deviceId: string) {
  try {
    const { error } = await supabase.from("push_tokens").upsert(
      {
        token,
        device_id: deviceId,
        platform: Platform.OS,
        last_active: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

    if (error) console.error("Failed to register token:", error);
  } catch (error) {
    console.error("Failed to register token with backend:", error);
  }
}
