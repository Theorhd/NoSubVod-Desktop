import React, { useEffect, useMemo, useRef } from 'react';
import { MediaPlayer, MediaProvider, useMediaRemote, useMediaStore } from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';
import Hls from 'hls.js';

export type NSVMediaSource = {
  src: string;
  type?: string;
};

export type NSVTextTrack = {
  src: string;
  kind: 'subtitles' | 'captions' | 'chapters' | 'descriptions' | 'metadata';
  label: string;
  language: string;
  default?: boolean;
};

type NSVPlayerProps = {
  source: NSVMediaSource;
  title: string;
  poster?: string;
  streamType?: 'on-demand' | 'live' | 'll-live';
  autoPlay?: boolean;
  muted?: boolean;
  startTime?: number;
  seekTo?: number | null;
  preferredQuality?: string;
  minQuality?: string;
  className?: string;
  textTracks?: NSVTextTrack[];
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onError?: (message: string) => void;
};

function safeStorageGet(storage: Storage, key: string): string {
  try {
    return storage.getItem(key) || '';
  } catch {
    return '';
  }
}

function withAuthQuery(url: string): string {
  if (!url) return url;
  if (!url.startsWith('/api/')) return url;

  const token = safeStorageGet(sessionStorage, 'nsv_token');
  const deviceId = safeStorageGet(localStorage, 'nsv_device_id');
  const params: string[] = [];
  if (token) {
    params.push(`t=${encodeURIComponent(token)}`);
  }
  if (deviceId) {
    params.push(`d=${encodeURIComponent(deviceId)}`);
  }
  if (params.length === 0) return url;

  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${params.join('&')}`;
}

function onProviderChange(provider: any) {
  if (provider?.type === 'hls') {
    provider.library = Hls;
  }
}

export default function NSVPlayer({
  source,
  title,
  poster,
  streamType = 'on-demand',
  autoPlay = false,
  muted = false,
  startTime,
  seekTo,
  preferredQuality,
  minQuality,
  className,
  textTracks = [],
  onTimeUpdate,
  onDurationChange,
  onPlayStateChange,
  onError,
}: Readonly<NSVPlayerProps>) {
  const playerRef = useRef<any>(null);
  const store = useMediaStore(playerRef);
  const remote = useMediaRemote(playerRef);

  const didSeekOnStartRef = useRef(false);
  const lastExternalSeekRef = useRef<number | null>(null);
  const didApplyPreferredQualityRef = useRef(false);

  const src = useMemo(
    () => ({
      src: withAuthQuery(source.src),
      type: source.type,
    }),
    [source.src, source.type]
  );

  useEffect(() => {
    if (!onTimeUpdate) return;
    onTimeUpdate(store.currentTime || 0);
  }, [store.currentTime, onTimeUpdate]);

  useEffect(() => {
    if (!onDurationChange) return;
    onDurationChange(store.duration || 0);
  }, [store.duration, onDurationChange]);

  useEffect(() => {
    if (!onPlayStateChange) return;
    onPlayStateChange(!store.paused);
  }, [store.paused, onPlayStateChange]);

  useEffect(() => {
    if (!onError || !store.error) return;
    onError(store.error.message || 'Playback failed.');
  }, [store.error, onError]);

  useEffect(() => {
    if (didSeekOnStartRef.current) return;
    if (!Number.isFinite(startTime) || (startTime || 0) <= 0) return;
    if (!store.canSeek || store.duration <= 0) return;

    didSeekOnStartRef.current = true;
    remote.seek(Math.max(0, startTime || 0));
  }, [startTime, store.canSeek, store.duration, remote]);

  useEffect(() => {
    didSeekOnStartRef.current = false;
    lastExternalSeekRef.current = null;
    didApplyPreferredQualityRef.current = false;
  }, [src.src]);

  useEffect(() => {
    if (!Number.isFinite(seekTo)) return;
    if (!store.canSeek || store.duration <= 0) return;

    const nextValue = Math.max(0, seekTo || 0);
    if (
      lastExternalSeekRef.current !== null &&
      Math.abs(lastExternalSeekRef.current - nextValue) < 0.01
    ) {
      return;
    }

    lastExternalSeekRef.current = nextValue;
    remote.seek(nextValue);
  }, [seekTo, store.canSeek, store.duration, remote]);

  useEffect(() => {
    if (didApplyPreferredQualityRef.current) return;
    if (!store.canSetQuality) return;
    if (!store.qualities || store.qualities.length === 0) return;

    didApplyPreferredQualityRef.current = true;

    if (!preferredQuality || preferredQuality === 'auto') {
      const minHeight = Number.parseInt(minQuality || 'none', 10);
      if (!Number.isNaN(minHeight)) {
        const minIndex = (store.qualities as any[])
          .map((q, idx) => ({
            idx,
            height: Number((q as { height?: number }).height || 0),
          }))
          .filter((q) => q.height >= minHeight)
          .sort((a, b) => a.height - b.height)[0]?.idx;

        if (typeof minIndex === 'number') {
          remote.changeQuality(minIndex);
          return;
        }
      }

      remote.changeQuality(-1);
      return;
    }

    const preferredHeight = Number.parseInt(preferredQuality, 10);
    if (Number.isNaN(preferredHeight)) {
      remote.changeQuality(-1);
      return;
    }

    const qualityIndex = (store.qualities as any[]).findIndex(
      (q) => Number((q as { height?: number }).height) === preferredHeight
    );

    if (qualityIndex >= 0) {
      remote.changeQuality(qualityIndex);
      return;
    }

    remote.changeQuality(-1);
  }, [minQuality, preferredQuality, remote, store.canSetQuality, store.qualities]);

  return (
    <MediaPlayer
      onProviderChange={onProviderChange}
      ref={playerRef}
      className={className}
      title={title}
      src={src as any}
      viewType="video"
      poster={poster}
      streamType={streamType}
      load="visible"
      autoPlay={autoPlay}
      muted={muted}
      playsInline
      keyTarget="player"
      keyShortcuts={{
        togglePaused: 'k Space',
        toggleMuted: 'm',
        toggleFullscreen: 'f',
        togglePictureInPicture: 'i',
        toggleCaptions: 'c',
        seekBackward: 'ArrowLeft',
        seekForward: 'ArrowRight',
        volumeUp: 'ArrowUp',
        volumeDown: 'ArrowDown',
      }}
      aspectRatio="16/9"
      crossOrigin="anonymous"
    >
      <MediaProvider>
        {textTracks.length > 0
          ? textTracks.map((track) => (
              <track
                key={`${track.kind}-${track.language}-${track.label}`}
                src={withAuthQuery(track.src)}
                kind={track.kind as any}
                label={track.label}
                srcLang={track.language}
                default={track.default}
              />
            ))
          : null}
      </MediaProvider>
      <DefaultVideoLayout icons={defaultLayoutIcons} />
    </MediaPlayer>
  );
}
