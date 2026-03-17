// app/(modals)/queue.tsx

import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import TrackPlayer, {
  Track,
  useActiveTrack,
} from "react-native-track-player";
import { Image } from "expo-image";

export default function QueueModal() {
  const [queue, setQueue] = useState<Track[]>([]);
  const activeTrack = useActiveTrack();

  useEffect(() => {
    const loadQueue = async () => {
      const tracks = await TrackPlayer.getQueue();
      setQueue(tracks);
    };

    loadQueue();
  }, []);

  const renderItem = ({ item, index }: { item: Track; index: number }) => {
    const isActive = activeTrack?.id === item.id;

    return (
      <TouchableOpacity
        style={[styles.itemContainer, isActive && styles.activeItem]}
        onPress={async () => {
          await TrackPlayer.skip(index);
          await TrackPlayer.play();
        }}
      >
        <Image
          source={{ uri: item.artwork as string }}
          style={styles.artwork}
          contentFit="cover"
          transition={200}
        />

        <View style={styles.textContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {item.artist}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Up Next</Text>

      <FlatList
        data={queue}
        keyExtractor={(item, index) =>
          item.id ? item.id.toString() : index.toString()
        }
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    padding: 20,
  },
  header: {
    fontSize: 20,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 20,
  },
  itemContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    padding: 10,
    borderRadius: 12,
  },
  activeItem: {
    backgroundColor: "#1e1e1e",
  },
  artwork: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: "#222",
  },
  textContainer: {
    marginLeft: 14,
    flex: 1,
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  artist: {
    color: "#aaa",
    fontSize: 14,
    marginTop: 4,
  },
});