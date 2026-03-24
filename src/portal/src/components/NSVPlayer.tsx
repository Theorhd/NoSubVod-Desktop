import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { MediaPlayer, MediaProvider, useMediaRemote, useMediaStore } from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';
import Hls from 'hls.js';
import { safeStorageGet } from '../utils/storage.ts';

const HLS_STABILITY_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  startLevel: -1,
  capLevelToPlayerSize: false,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  backBufferLength: 30,
  maxBufferHole: 0.5,
  manifestLoadingTimeOut: 20000,
  levelLoadingTimeOut: 20000,
  fragLoadingTimeOut: 25000,
  nudgeMaxRetry: 8,
  abrEwmaDefaultEstimate: 8_000_000,
};

type QualityEntry = {
  idx: number;
  height: number;
};

function parseHeight(value: string | undefined): number | null {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function sortedQualitiesByHeightDesc(qualities: any[]): QualityEntry[] {
  return qualities
    .map((q, idx) => ({
      idx,
      height: Number((q as { height?: number }).height || 0),
    }))
    .filter((q) => q.height > 0)
    .sort((a, b) => b.height - a.height);
}

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
    provider.config = provider.config
      ? {
          ...provider.config,
          ...HLS_STABILITY_CONFIG,
        }
      : HLS_STABILITY_CONFIG;
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

  // Stable references to avoid re-subscribing every second when store.currentTime changes
  const remoteRef = useRef(remote);
  const storeRef = useRef(store);
  useEffect(() => {
    remoteRef.current = remote;
    storeRef.current = store;
  }, [remote, store]);

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
    didApplyPreferredQualityRef.current = false;
  }, [preferredQuality, minQuality, streamType]);

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

    const sorted = sortedQualitiesByHeightDesc(store.qualities as any[]);
    if (sorted.length === 0) {
      remote.changeQuality(-1);
      return;
    }

    const minHeight = parseHeight(minQuality || undefined);
    const allowed =
      minHeight === null ? sorted : sorted.filter((quality) => quality.height >= minHeight);

    if (allowed.length === 0) {
      remote.changeQuality(-1);
      return;
    }

    if (!preferredQuality || preferredQuality === 'auto') {
      // For VOD we prioritize max available quality, while still respecting a minimum floor.
      if (streamType === 'on-demand' || minHeight !== null) {
        remote.changeQuality(allowed[0].idx);
      } else {
        remote.changeQuality(-1);
      }
      return;
    }

    const preferredHeight = parseHeight(preferredQuality);
    if (preferredHeight === null) {
      remote.changeQuality(-1);
      return;
    }

    const exact = allowed.find((q) => q.height === preferredHeight);
    if (exact) {
      remote.changeQuality(exact.idx);
      return;
    }

    // Pick the closest available quality to the user's preferred setting.
    const closestBelow = allowed.find((q) => q.height < preferredHeight);
    if (closestBelow) {
      remote.changeQuality(closestBelow.idx);
      return;
    }

    const closestAbove = [...allowed].reverse().find((q) => q.height > preferredHeight);
    if (closestAbove) {
      remote.changeQuality(closestAbove.idx);
      return;
    }

    remote.changeQuality(-1);
  }, [minQuality, preferredQuality, remote, store.canSetQuality, store.qualities, streamType]);

  // Stable handler for remote control events to keep useEffect clean
  const handleRemoteControl = useCallback((event: any) => {
    const payload = event.payload;
    const cmd = payload.command;
    const val = payload.value ?? 0;
    console.log('[NSVPlayer] Received Tauri control event:', cmd, val);

    const r = remoteRef.current;
    const s = storeRef.current;

    switch (cmd) {
      case 'play':
        r.play();
        break;
      case 'pause':
        r.pause();
        break;
      case 'seek':
        r.seek(Math.max(0, Math.min(s.duration, (s.currentTime || 0) + val)));
        break;
      case 'volume':
        r.changeVolume(val);
        break;
      case 'mute':
        r.toggleMuted();
        break;
    }
  }, []);

  useEffect(() => {
    const onPlay = () => remoteRef.current.play();
    const onPause = () => remoteRef.current.pause();
    const onSeek = (e: any) => {
      const val = e.detail?.value || 0;
      const s = storeRef.current;
      remoteRef.current.seek(Math.max(0, Math.min(s.duration, (s.currentTime || 0) + val)));
    };
    const onVolume = (e: any) => remoteRef.current.changeVolume(e.detail?.value ?? 1);
    const onMute = () => remoteRef.current.toggleMuted();

    globalThis.addEventListener('nsv-remote-play', onPlay);
    globalThis.addEventListener('nsv-remote-pause', onPause);
    globalThis.addEventListener('nsv-remote-seek', onSeek);
    globalThis.addEventListener('nsv-remote-volume', onVolume);
    globalThis.addEventListener('nsv-remote-mute', onMute);

    // native tauri event
    let unlisten: (() => void) | undefined;
    const isTauri = (globalThis as any).__TAURI_INTERNALS__ || (globalThis as any).__TAURI__;

    if (isTauri) {
      const setupTauriListener = async () => {
        try {
          const { listen } = await import('@tauri-apps/api/event');
          unlisten = await listen('nsv-control', handleRemoteControl);
          console.log('[NSVPlayer] Remote control listener registered.');
        } catch (err) {
          console.error('[NSVPlayer] Failed to load Tauri event API:', err);
        }
      };
      setupTauriListener();
    }

    return () => {
      globalThis.removeEventListener('nsv-remote-play', onPlay);
      globalThis.removeEventListener('nsv-remote-pause', onPause);
      globalThis.removeEventListener('nsv-remote-seek', onSeek);
      globalThis.removeEventListener('nsv-remote-volume', onVolume);
      globalThis.removeEventListener('nsv-remote-mute', onMute);
      if (unlisten) unlisten();
    };
  }, [handleRemoteControl]); // Only once, refs are used inside

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
      load={streamType === 'on-demand' ? 'eager' : 'visible'}
      preload="auto"
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
