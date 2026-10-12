import { FC, useEffect, useRef, useState } from 'react';
import { Image, Pressable, View, useWindowDimensions } from 'react-native';
import YoutubeIframe from 'react-native-youtube-iframe';
import { Text } from '@atomics/text';
import { Icon } from '@atomics/icon';
import { Play } from 'lucide-react-native';
import rpc from '@/utils/rpc';

/**
 * Click-to-play YouTube embed with automatic in-video promotion skipping.
 * The official IFrame player keeps YouTube's own pre-roll ads (they cannot be
 * removed from an embed); SponsorBlock community segments cover the in-video
 * sponsorships and subscribe-nags, which the player seeks past silently.
 * When `endSeconds` is set the player pauses at the segment boundary.
 */
export const VideoPlayerCard: FC<{
  videoId: string;
  title: string;
  channel?: string;
  startSeconds?: number;
  endSeconds?: number;
}> = ({ videoId, title, channel, startSeconds, endSeconds }) => {
  const { width } = useWindowDimensions();
  const height = Math.min(234, Math.round((width - 48) * (9 / 16)));
  const playerRef = useRef<any>(null);
  const [activated, setActivated] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [sponsors, setSponsors] = useState<{ startSeconds: number; endSeconds: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    rpc.video.sponsorSegments({ videoId }).then(
      (result) => {
        if (!cancelled) setSponsors(result.segments);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // Playback watchdog: skip sponsor segments (including manual seeks into
  // them) and pause at the clip's end boundary. The skip target guard
  // prevents seek→tick→seek loops.
  const skipGuard = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(async () => {
      const current = await playerRef.current?.getCurrentTime();
      if (typeof current !== 'number') return;
      const inside = sponsors.find(
        (segment) => current >= segment.startSeconds && current < segment.endSeconds,
      );
      if (inside && Math.abs(skipGuard.current - inside.endSeconds) > 0.5) {
        skipGuard.current = inside.endSeconds;
        playerRef.current?.seekTo(inside.endSeconds + 0.1, true);
        return;
      }
      if (endSeconds !== undefined && current >= endSeconds - 0.3) {
        playerRef.current?.pauseVideo();
        setPlaying(false);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [playing, sponsors, endSeconds]);

  return (
    <View className="gap-1">
      <View className="overflow-hidden rounded-lg bg-secondary">
        {activated ? (
          <YoutubeIframe
            ref={playerRef}
            videoId={videoId}
            height={height}
            width={width - 48}
            play={playing}
            onChangeState={(state: string) => {
              if (state === 'ended') setPlaying(false);
            }}
            initialPlayerParams={{
              startSeconds: startSeconds ?? 0,
              modestbranding: true,
              rel: false,
              playsinline: true,
              preventFullScreen: false,
            }}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Play video: ${title}`}
            className="items-center justify-center"
            style={{ height }}
            onPress={() => setActivated(true)}>
            <Image
              source={{ uri: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }}
              style={{ position: 'absolute', width: width - 48, height }}
            />
            <View className="size-12 items-center justify-center rounded-full bg-black/70">
              <Icon as={Play} size={22} className="translate-x-[1px] text-white" />
            </View>
          </Pressable>
        )}
      </View>
      <View className="px-1">
        <Text variant="body" numberOfLines={2}>
          {title}
        </Text>
        {channel ? (
          <Text variant="muted" className="text-[13px]">
            {channel}
            {startSeconds !== undefined
              ? ` · from ${Math.floor(startSeconds / 60)}:${String(Math.round(startSeconds % 60)).padStart(2, '0')}`
              : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
};
