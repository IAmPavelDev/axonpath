import { FC } from 'react';
import { useIsFocused } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Text } from '@atomics/text';
import { Button } from '@atomics/button';
import { Skeleton } from '@atomics/skeleton';
import { VideoPlayerCard } from '@components/video/VideoPlayerCard';
import rpc from '@/utils/rpc';

/**
 * The skill page's recommended-videos body: top-10 whole videos for the
 * skill topic. PENDING renders generating skeletons (the skill itself is
 * usable without this); FAILED offers a quiet retry; READY renders the list
 * or an honest empty state.
 */
export const RecommendationsList: FC<{ skillId: number }> = ({ skillId }) => {
  // The skill page stays mounted under pushed routes; poll only while it is
  // the focused screen, and only while generating (stops on READY/FAILED).
  const isFocused = useIsFocused();
  const query = useQuery({
    queryKey: ['recommendations', skillId],
    queryFn: () => rpc.video.recommendations.list({ skillId }),
    refetchInterval: (q) =>
      isFocused && q.state.data?.status === 'PENDING' ? 5_000 : false,
  });

  const refresh = () => {
    void rpc.video.recommendations.refresh({ skillId }).finally(() => query.refetch());
  };

  if (query.isLoading || query.data?.status === 'PENDING') {
    return (
      <View className="gap-4 px-6 py-4">
        {[0, 1, 2].map((row) => (
          <View key={row} className="gap-2">
            <Skeleton className="h-[180px] w-full rounded-lg" />
            <Skeleton className="h-4 w-4/5 rounded-sm" />
            <Skeleton className="h-[18px] w-2/5 rounded-sm" />
          </View>
        ))}
        <Text variant="muted" className="text-center">
          Generating…
        </Text>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View className="items-center gap-3 px-6 py-10">
        <Text variant="muted" className="text-center">
          Could not load video recommendations right now.
        </Text>
        <Button size="sm" onPress={() => void query.refetch()}>
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }

  if (query.data?.status === 'FAILED') {
    return (
      <View className="items-center gap-3 px-6 py-10">
        <Text variant="muted" className="text-center">
          Could not load video recommendations right now.
        </Text>
        <Button size="sm" onPress={refresh}>
          <Text>Try again</Text>
        </Button>
      </View>
    );
  }

  const videos = query.data?.videos ?? [];

  return (
    <FlatList
      data={videos}
      keyExtractor={(video) => video.videoId}
      className="px-6 py-4"
      ItemSeparatorComponent={() => <View className="h-5" />}
      renderItem={({ item }) => (
        <View className="gap-2">
          <VideoPlayerCard
            videoId={item.videoId}
            title={item.title}
            channel={item.channel}
          />
          {item.rank === videos.length && (
            <Pressable onPress={refresh} className="items-center py-2">
              <Text variant="muted" className="text-[13px] underline">
                Refresh recommendations
              </Text>
            </Pressable>
          )}
        </View>
      )}
      ListEmptyComponent={
        <View className="items-center py-10">
          <Text variant="muted">No good videos found for this topic yet.</Text>
          <Button variant="ghost" size="sm" onPress={refresh}>
            <Text>Try again</Text>
          </Button>
        </View>
      }
    />
  );
};
