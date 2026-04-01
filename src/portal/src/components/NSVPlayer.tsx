import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { MediaPlayer, MediaProvider, useMediaRemote, useMediaStore } from '@vidstack/react';
import { defaultLayoutIcons, DefaultVideoLayout } from '@vidstack/react/player/layouts/default';
import Hls from 'hls.js';
import { safeStorageGet } from '../../../shared/utils/storage';

function getHlsStabilityConfig(isMobileLayout: boolean, forceHighQuality: boolean) {
  if (forceHighQuality) {
    return {
      enableWorker: true,
      lowLatencyMode: false,
      startLevel: -1,
      capLevelToPlayerSize: false,
      maxBufferLength: 12,
      maxMaxBufferLength: 16,
      backBufferLength: 3,
      maxBufferSize: 16 * 1000 * 1000,
      maxBufferHole: 0.5,
      manifestLoadingTimeOut: 20000,
      levelLoadingTimeOut: 20000,
      fragLoadingTimeOut: 25000,
      nudgeMaxRetry: 8,
      abrEwmaDefaultEstimate: 24_000_000,
    };
  }

  if (isMobileLayout) {
    return {
      enableWorker: true,
      lowLatencyMode: false,
      startLevel: 2,
      capLevelToPlayerSize: true,
      maxBufferLength: 6,
      maxMaxBufferLength: 8,
      backBufferLength: 1,
      maxBufferSize: 6 * 1000 * 1000,
      maxBufferHole: 0.5,
      manifestLoadingTimeOut: 20000,
      levelLoadingTimeOut: 20000,
      fragLoadingTimeOut: 25000,
      nudgeMaxRetry: 8,
      abrEwmaDefaultEstimate: 8_000_000,
    };
  }

  return {
    enableWorker: true,
    lowLatencyMode: false,
    startLevel: -1,
    capLevelToPlayerSize: false,
    maxBufferLength: 8,
    maxMaxBufferLength: 10,
    backBufferLength: 2,
    maxBufferSize: 10 * 1000 * 1000,
    maxBufferHole: 0.5,
    manifestLoadingTimeOut: 20000,
    levelLoadingTimeOut: 20000,
    fragLoadingTimeOut: 25000,
    nudgeMaxRetry: 8,
    abrEwmaDefaultEstimate: 24_000_000,
  };
}

type QualityEntry = {
  idx: number;
  height: number;
};

type QualitySelectionDecision = {
  applied: boolean;
  qualityIdx: number;
  lockedHeight: number | null;
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

function isIosFamilyRuntime(): boolean {
  const nav = globalThis.navigator;
  if (!nav) return false;

  const ua = (nav.userAgent || '').toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    return true;
  }

  // iPadOS desktop UA reports Macintosh + touch support.
  return ua.includes('macintosh') && (nav.maxTouchPoints || 0) > 1;
}

function resolveHighQualityTarget(allowed: QualityEntry[]): QualityEntry {
  const atLeast1080 = allowed.find((quality) => quality.height >= 1080);
  if (atLeast1080) return atLeast1080;

  const atLeast720 = allowed.find((quality) => quality.height >= 720);
  if (atLeast720) return atLeast720;

  return allowed[0];
}

function resolveAutoQualitySelection(
  allowed: QualityEntry[],
  streamType: NSVPlayerProps['streamType'],
  minHeight: number | null,
  isMobileLayout: boolean,
  forceHighQuality: boolean
): QualitySelectionDecision {
  if (forceHighQuality) {
    const highTarget = resolveHighQualityTarget(allowed);
    return {
      applied: true,
      qualityIdx: highTarget.idx,
      lockedHeight: highTarget.height,
    };
  }

  const startupAllowed = isMobileLayout ? allowed.filter((q) => q.height <= 720) : allowed;
  const startupTarget = startupAllowed.length > 0 ? startupAllowed[0] : allowed[0];

  if (streamType === 'on-demand' || minHeight !== null) {
    return {
      applied: true,
      qualityIdx: startupTarget.idx,
      lockedHeight: null,
    };
  }

  return {
    applied: true,
    qualityIdx: -1,
    lockedHeight: null,
  };
}

function resolveManualQualitySelection(
  allowed: QualityEntry[],
  preferredHeight: number | null
): QualitySelectionDecision {
  if (preferredHeight === null) {
    return {
      applied: false,
      qualityIdx: -1,
      lockedHeight: null,
    };
  }

  const exact = allowed.find((q) => q.height === preferredHeight);
  if (exact) {
    return {
      applied: true,
      qualityIdx: exact.idx,
      lockedHeight: exact.height,
    };
  }

  const closestBelow = allowed.find((q) => q.height < preferredHeight);
  if (closestBelow) {
    return {
      applied: true,
      qualityIdx: closestBelow.idx,
      lockedHeight: closestBelow.height,
    };
  }

  const closestAbove = [...allowed].reverse().find((q) => q.height > preferredHeight);
  if (closestAbove) {
    return {
      applied: true,
      qualityIdx: closestAbove.idx,
      lockedHeight: closestAbove.height,
    };
  }

  return {
    applied: false,
    qualityIdx: -1,
    lockedHeight: null,
  };
}

function resolveQualitySelection(
  sorted: QualityEntry[],
  minQuality: string | undefined,
  preferredQuality: string | undefined,
  streamType: NSVPlayerProps['streamType'],
  isMobileLayout: boolean,
  forceHighQuality: boolean
): QualitySelectionDecision {
  if (sorted.length === 0) {
    return {
      applied: false,
      qualityIdx: -1,
      lockedHeight: null,
    };
  }

  const effectiveMinQuality = forceHighQuality ? '720' : minQuality;
  let effectivePreferredQuality = preferredQuality;
  if (forceHighQuality && (!effectivePreferredQuality || effectivePreferredQuality === 'auto')) {
    effectivePreferredQuality = '1080';
  }

  const minHeight = parseHeight(effectiveMinQuality);
  const allowed = minHeight === null ? sorted : sorted.filter((q) => q.height >= minHeight);

  if (allowed.length === 0) {
    return {
      applied: false,
      qualityIdx: -1,
      lockedHeight: null,
    };
  }

  if (!effectivePreferredQuality || effectivePreferredQuality === 'auto') {
    return resolveAutoQualitySelection(
      allowed,
      streamType,
      minHeight,
      isMobileLayout,
      forceHighQuality
    );
  }

  const preferredHeight = parseHeight(effectivePreferredQuality);
  return resolveManualQualitySelection(allowed, preferredHeight);
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
    preferredQuality,
    minQuality,
    isMobileLayout = false,
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
    const lockedQualityHeightRef = useRef<number | null>(null);
    const hlsInstanceRef = useRef<Hls | null>(null);
    const isIosFamily = useMemo(() => isIosFamilyRuntime(), []);
    const forceHighQuality = isIosFamily && isMobileLayout;

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
      lockedQualityHeightRef.current = null;

      if (hlsInstanceRef.current) {
        try {
          hlsInstanceRef.current.stopLoad();
          hlsInstanceRef.current.detachMedia();
        } catch {
          // Ignore cleanup failures on stale instances.
        }
        hlsInstanceRef.current = null;
      }
    }, [src.src]);

    useEffect(() => {
      didApplyPreferredQualityRef.current = false;
    }, [preferredQuality, minQuality, streamType]);

    const qualityConfigKey = useMemo(
      () => `${preferredQuality || 'auto'}|${minQuality || 'none'}|${streamType}`,
      [preferredQuality, minQuality, streamType]
    );

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

      try {
        const sorted = sortedQualitiesByHeightDesc(store.qualities as any[]);
        const decision = resolveQualitySelection(
          sorted,
          minQuality,
          preferredQuality,
          streamType,
          isMobileLayout,
          forceHighQuality
        );

        didApplyPreferredQualityRef.current = decision.applied;
        lockedQualityHeightRef.current = decision.lockedHeight;
        remote.changeQuality(decision.qualityIdx);
      } catch (error) {
        didApplyPreferredQualityRef.current = false;
        console.error('[NSVPlayer] Failed to apply preferred quality', error);
      }
    }, [
      qualityConfigKey,
      minQuality,
      preferredQuality,
      remote,
      isMobileLayout,
      forceHighQuality,
      store.canSetQuality,
      store.qualities,
      streamType,
    ]);

    useEffect(() => {
      if (!forceHighQuality) return;
      if (!store.canSetQuality) return;
      if (!store.qualities || store.qualities.length === 0) return;

      const reapplyTargetQuality = () => {
        try {
          const sorted = sortedQualitiesByHeightDesc(store.qualities as any[]);
          if (sorted.length === 0) return;
          const target = resolveHighQualityTarget(sorted);
          lockedQualityHeightRef.current = target.height;
          remote.changeQuality(target.idx);
        } catch (error) {
          console.warn('[NSVPlayer] Failed to enforce iOS high quality mode', error);
        }
      };

      reapplyTargetQuality();
      const timer = globalThis.setInterval(reapplyTargetQuality, 4000);
      return () => globalThis.clearInterval(timer);
    }, [forceHighQuality, remote, store.canSetQuality, store.qualities]);

    const handleHlsInstance = useCallback((instance: Hls) => {
      hlsInstanceRef.current = instance;
    }, []);

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
        provider.library = Hls;
        const hlsConfig = getHlsStabilityConfig(isMobileLayout, forceHighQuality);
        provider.config = provider.config
          ? { ...provider.config, ...hlsConfig }
          : hlsConfig;
      }
    }, [isMobileLayout, forceHighQuality]);

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
        <MediaProvider>{renderedTextTracks}</MediaProvider>
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>
    );
  }
);

NSVPlayer.displayName = 'NSVPlayer';
export default NSVPlayer;
