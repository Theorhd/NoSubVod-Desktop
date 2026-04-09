import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { MediaPlayer, MediaProvider, useMediaRemote, useMediaStore } from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';
import Hls from 'hls.js/dist/hls.light.js';
import { safeStorageGet } from '../../../shared/utils/storage';

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
  abrEwmaDefaultEstimate: 12_000_000,
};

type QualityEntry = {
  idx: number;
  height: number;
};

function sortedQualitiesByHeightDesc(qualities: any[]): QualityEntry[] {
  return qualities
    .map((q, idx) => ({
      idx,
      height: Number((q as { height?: number }).height || 0),
    }))
    .filter((q) => q.height > 0)
    .sort((a, b) => b.height - a.height);
}

function resolveRequestedQuality(
  sorted: QualityEntry[],
  defaultQuality: string | undefined
): number {
  if (sorted.length === 0) {
    return -1;
  }

  if (!defaultQuality || defaultQuality === 'auto') {
    return -1;
  }

  const requestedHeight = Number.parseInt(defaultQuality, 10);
  if (Number.isNaN(requestedHeight)) {
    return -1;
  }

  const exact = sorted.find((quality) => quality.height === requestedHeight);
  if (exact) return exact.idx;

  const closestBelow = sorted.find((quality) => quality.height < requestedHeight);
  if (closestBelow) return closestBelow.idx;

  return sorted[sorted.length - 1]?.idx ?? -1;
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
  defaultQuality?: string;
  isMobileLayout?: boolean;
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
  if (token) params.push(`t=${encodeURIComponent(token)}`);
  if (deviceId) params.push(`d=${encodeURIComponent(deviceId)}`);
  if (params.length === 0) return url;

  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${params.join('&')}`;
}

const NSVPlayer = React.memo(
  ({
    source,
    title,
    poster,
    streamType = 'on-demand',
    autoPlay = false,
    muted = false,
    startTime,
    seekTo,
    defaultQuality,
    isMobileLayout: _isMobileLayout = false,
    className,
    textTracks = [],
    onTimeUpdate,
    onDurationChange,
    onPlayStateChange,
    onError,
  }: NSVPlayerProps) => {
    const playerRef = useRef<any>(null);
    const store = useMediaStore(playerRef);
    const remote = useMediaRemote(playerRef);

    const remoteRef = useRef(remote);
    const storeRef = useRef(store);
    useEffect(() => {
      remoteRef.current = remote;
      storeRef.current = store;
    }, [remote, store]);

    const didSeekOnStartRef = useRef(false);
    const lastExternalSeekRef = useRef<number | null>(null);
    const didApplyPreferredQualityRef = useRef(false);
    const userInteractedWithQualityRef = useRef(false);

    const src = useMemo(
      () => ({
        src: withAuthQuery(source.src),
        type: source.type,
      }),
      [source.src, source.type]
    );

    const lastTimeRef = useRef<number>(0);
    useEffect(() => {
      if (!onTimeUpdate) return;
      const next = store.currentTime || 0;
      // Throttle or guard: only update if change is significant (at least 0.2s)
      if (Math.abs(lastTimeRef.current - next) < 0.2 && next !== 0) return;
      lastTimeRef.current = next;
      onTimeUpdate(next);
    }, [store.currentTime, onTimeUpdate]);

    const lastDurationRef = useRef<number>(0);
    useEffect(() => {
      if (!onDurationChange) return;
      const next = store.duration || 0;
      if (Math.abs(lastDurationRef.current - next) < 0.1) return;
      lastDurationRef.current = next;
      onDurationChange(next);
    }, [store.duration, onDurationChange]);

    const lastPlayingStateRef = useRef<boolean | null>(null);

    useEffect(() => {
      if (!onPlayStateChange) return;
      const isPlaying = !store.paused;
      if (lastPlayingStateRef.current === isPlaying) return;
      lastPlayingStateRef.current = isPlaying;
      onPlayStateChange(isPlaying);
    }, [store.paused, onPlayStateChange]);

    useEffect(() => {
      if (!onError || !store.error) return;
      onError(store.error.message || 'Playback failed.');
    }, [store.error, onError]);

    useEffect(() => {
      if (!onError) return;
      const isHls = (src.type || '').toLowerCase().includes('mpegurl');
      if (!isHls) return;

      if (!canUseHlsJs() && !canPlayHlsNatively()) {
        onError('This browser cannot play HLS streams on this device.');
      }
    }, [onError, src.type]);

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
      userInteractedWithQualityRef.current = false;
    }, [src.src]);

    useEffect(() => {
      didApplyDefaultQualityRef.current = false;
    }, [defaultQuality, streamType]);

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

    // Track user quality changes, PiP and background playback
    useEffect(() => {
      const player = playerRef.current;
      if (!player) return;

      const onQualityChangeRequest = (event: any) => {
        if (event.origin === 'user' || event.isTrusted) {
          userInteractedWithQualityRef.current = true;
        }
      };

      const onHiddenResume = (event: any) => {
        if (event.detail === 'hidden') {
          remoteRef.current.play();
        }
      };

      player.addEventListener('quality-change-request', onQualityChangeRequest);
      player.addEventListener('auto-picture-in-picture-change', onHiddenResume);
      player.addEventListener('background-playback-change', onHiddenResume);

      return () => {
        player.removeEventListener('quality-change-request', onQualityChangeRequest);
        player.removeEventListener('auto-picture-in-picture-change', onHiddenResume);
        player.removeEventListener('background-playback-change', onHiddenResume);
      };
    }, []);

    const determineQualityIndex = useCallback(
      (
        qualities: any[],
        minQuality?: string,
        preferredQuality?: string,
        streamType: 'on-demand' | 'live' | 'll-live' = 'on-demand'
      ): number | null => {
        const sorted = sortedQualitiesByHeightDesc(qualities);
        if (sorted.length === 0) return null;

        const minHeight = parseHeight(minQuality);
        const allowed =
          minHeight === null ? sorted : sorted.filter((quality) => quality.height >= minHeight);

        // If we have a minHeight requirement but no qualities satisfy it yet, wait.
        if (minHeight !== null && allowed.length === 0 && sorted.length < 3) {
          return null;
        }

        if (allowed.length === 0) return -1;

        if (!preferredQuality || preferredQuality === 'auto') {
          return streamType === 'on-demand' || minHeight !== null ? allowed[0].idx : -1;
        }

        const preferredHeight = parseHeight(preferredQuality);
        if (preferredHeight === null) return -1;

        const exact = allowed.find((q) => q.height === preferredHeight);
        if (exact) return exact.idx;

        const closestBelow = allowed.find((q) => q.height < preferredHeight);
        if (closestBelow) return closestBelow.idx;

        const closestAbove = [...allowed].reverse().find((q) => q.height > preferredHeight);
        if (closestAbove) return closestAbove.idx;

        return -1;
      },
      []
    );

    useEffect(() => {
      if (
        userInteractedWithQualityRef.current ||
        didApplyPreferredQualityRef.current ||
        !store.canSetQuality ||
        !store.qualities ||
        store.qualities.length === 0
      ) {
        return;
      }

      const qualityIdx = determineQualityIndex(
        store.qualities as any[],
        minQuality || undefined,
        preferredQuality,
        streamType
      );

      if (qualityIdx !== null) {
        remote.changeQuality(qualityIdx);
        didApplyPreferredQualityRef.current = true;
      }
    }, [
      minQuality,
      preferredQuality,
      remote,
      store.canSetQuality,
      store.qualities,
      streamType,
      determineQualityIndex,
    ]);

    const handleRemoteControl = useCallback((event: any) => {
      const payload = event.payload;
      const cmd = payload.command;
      const val = payload.value ?? 0;

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

      let unlisten: (() => void) | undefined;
      const isTauri = (globalThis as any).__TAURI_INTERNALS__ || (globalThis as any).__TAURI__;

      if (isTauri) {
        const setupTauriListener = async () => {
          try {
            const { listen } = await import('@tauri-apps/api/event');
            unlisten = await listen('nsv-control', handleRemoteControl);
          } catch (err) {
            console.error('[NSVPlayer] Failed to load Tauri event API:', err);
          }
        };
        void setupTauriListener();
      }

      return () => {
        globalThis.removeEventListener('nsv-remote-play', onPlay);
        globalThis.removeEventListener('nsv-remote-pause', onPause);
        globalThis.removeEventListener('nsv-remote-seek', onSeek);
        globalThis.removeEventListener('nsv-remote-volume', onVolume);
        globalThis.removeEventListener('nsv-remote-mute', onMute);
        if (unlisten) unlisten();
      };
    }, [handleRemoteControl]);

    const onProviderChange = useCallback((provider: any) => {
      if (provider?.type === 'hls') {
        if (!canUseHlsJs()) return;
        provider.library = Hls;
        const hlsConfig = getHlsStabilityConfig();
        provider.config = provider.config ? { ...provider.config, ...hlsConfig } : hlsConfig;
      }
    }, []);

    const renderedTextTracks = useMemo(
      () =>
        textTracks.map((track) => (
          <track
            key={`${track.kind}-${track.language}-${track.label}`}
            src={withAuthQuery(track.src)}
            kind={track.kind as any}
            label={track.label}
            srcLang={track.language}
            default={track.default}
          />
        )),
      [textTracks]
    );

    return (
      <MediaPlayer
        onProviderChange={onProviderChange}
        onHlsInstance={handleHlsInstance}
        ref={playerRef}
        className={className}
        title={title}
        src={src as any}
        viewType="video"
        poster={poster}
        streamType={streamType}
        load={streamType === 'on-demand' ? 'eager' : 'visible'}
        preload="metadata"
        autoPlay={autoPlay}
        muted={effectiveMuted}
        playsInline
        fullscreenOrientation="none"
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
        <MediaProvider>{renderedTextTracks}</MediaProvider>
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>
    );
  }
);

NSVPlayer.displayName = 'NSVPlayer';
export default NSVPlayer;
