// components/QuickPicksSection.tsx
/**
 * QuickPicksSection - expo-av version
 * 
 * Displays a horizontally scrollable list of recommended songs.
 * Uses useActiveTrack from expo-av hooks.
 */

import React, { useMemo } from "react";
import { Colors } from "@/constants/Colors";
import { triggerHaptic } from "@/helpers/haptics";
import { FlashList } from "@shopify/flash-list";
import { Image } from "@d11/react-native-fast-image";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Text, TouchableOpacity, View } from "react-native";
import LoaderKit from "react-native-loader-kit";
import { ScaledSheet } from "react-native-size-matters/extend";
import { useActiveTrack } from "@/hooks/useActiveTrack";
import type { Song } from "@/types/song";

export interface QuickPicksSectionProps {
  results: Song[];
  onItemClick: (item: Song) => void;
}

export const QuickPicksSection: React.FC<QuickPicksSectionProps> = ({
  results,
  onItemClick,
}) => {
  const router = useRouter();
  const activeTrack = useActiveTrack();

  const renderItem = (item: Song) => (
    <TouchableOpacity
      key={item.id}
      style={styles.itemContainer}
      onPress={() => {
        triggerHaptic();
        onItemClick(item);
      }}
      onLongPress={() => {
        const songData = JSON.stringify({
          id: item.id,
          title: item.title,
          artist: item.artist,
          thumbnail: item.thumbnail,
        });

        triggerHaptic(Haptics.AndroidHaptics.Long_Press);

        router.push({
          pathname: "/(modals)/menu",
          params: { songData: songData, type: "song" },
        });
      }}
    >
      <View style={styles.imageContainer}>
        <FastImage source={{ uri: item.thumbnail }} style={styles.thumbnail} />
        {activeTrack?.id === item.id && (
          <LoaderKit
            style={styles.trackPlayingIconIndicator}
            name="LineScalePulseOutRapid"
            color="white"
          />
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.artist} numberOfLines={1}>
        {item.artist}
      </Text>
    </TouchableOpacity>
  );

  const data = useMemo(() => {
    const mid = Math.ceil(results.length / 2);
    return results.slice(0, mid).map((top, idx) => ({
      top,
      bottom: results.slice(mid)[idx],
    }));
  }, [results]);

  if (results.length === 0) {
    return null;
  }

  return (
    <View>
      <Text style={styles.header}>Quick Picks</Text>
      <View style={styles.listContainer}>
        <FlashList
          data={data}
          horizontal
          showsHorizontalScrollIndicator={false}
          extraData={activeTrack}
          contentContainerStyle={{ paddingLeft: 13 }}
          keyExtractor={(col) => `${col.top.id}-${col.bottom?.id || "none"}`}
          renderItem={({ item }) => (
            <View style={styles.column}>
              {renderItem(item.top)}
              {item.bottom && renderItem(item.bottom)}
            </View>
          )}
        />
      </View>
    </View>
  );
};

const styles = ScaledSheet.create({
  header: {
    color: "white",
    fontSize: "20@ms",
    fontWeight: "bold",
    paddingHorizontal: 15,
    paddingBottom: 12,
  },
  listContainer: {
    height: "300@ms",
  },
  column: {
    flexDirection: "column",
  },
  itemContainer: {
    marginRight: "10@ms",
    width: "100@ms",
    height: "145@ms",
    marginBottom: "10@vs",
  },
  imageContainer: {
    position: "relative",
  },
  thumbnail: {
    borderRadius: 12,
    width: "100@ms",
    height: "100@ms",
  },
  trackPlayingIconIndicator: {
    position: "absolute",
    top: "35@ms",
    left: "35@ms",
    width: "30@ms",
    height: "30@ms",
  },
  title: {
    color: Colors.text,
    fontSize: "14@ms",
    fontWeight: "bold",
    marginTop: 5,
  },
  artist: {
    fontSize: "12@ms",
    color: "#888",
  },
});