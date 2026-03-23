export interface UserInfo {
  id: string;
  login: string;
  displayName: string;
  profileImageURL: string;
}

export interface SubEntry {
  login: string;
  displayName: string;
  profileImageURL: string;
}

export interface VOD {
  id: string;
  title: string;
  lengthSeconds: number;
  previewThumbnailURL: string;
  createdAt: string;
  viewCount: number;
  language?: string;
  game: { name: string } | null;
  owner?: {
    login: string;
    displayName: string;
    profileImageURL: string;
  };
}

export interface ServerInfo {
  ip: string;
  port: number;
  url: string;
  qrcode: string;
}

export interface HistoryEntry {
  vodId: string;
  timecode: number;
  duration: number;
  updatedAt: number;
}

export interface HistoryVodEntry extends HistoryEntry {
  vod: VOD | null;
}

export interface ChatMessage {
  id: string;
  commenter: {
    displayName: string;
    login: string;
    profileImageURL: string;
  };
  message: {
    fragments: Array<{ text: string; emote: { id: string } | null }>;
  };
  contentOffsetSeconds: number;
  createdAt: string;
}

export interface VideoMarker {
  id: string;
  displayTime: number;
  description: string;
  type: string;
  url?: string | null;
}

export interface WatchlistEntry {
  vodId: string;
  title: string;
  previewThumbnailURL: string;
  lengthSeconds: number;
  addedAt: number;
}

export interface ExperienceSettings {
  oneSync: boolean;
  adblockEnabled?: boolean;
  adblockProxy?: string;
  adblockProxyMode?: 'auto' | 'manual';
  minVideoQuality?: string;
  preferredVideoQuality?: string;
  downloadLocalPath?: string;
  downloadNetworkSharedPath?: string;
  twitchImportFollows?: boolean;
  launchAtLogin?: boolean;
}

export interface TwitchStatus {
  linked: boolean;
  clientConfigured: boolean;
  userId?: string;
  userLogin?: string;
  userDisplayName?: string;
  userAvatar?: string;
  importFollows?: boolean;
}

export interface ProxyInfo {
  url: string;
  country: string;
  ping: number;
}

export interface TrustedDevice {
  deviceId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastIp?: string;
  userAgent?: string;
  trusted: boolean;
}

export interface LiveStream {
  id: string;
  title: string;
  previewImageURL: string;
  viewerCount: number;
  language?: string;
  startedAt: string;
  broadcaster: {
    id: string;
    login: string;
    displayName: string;
    profileImageURL: string;
  };
  game: {
    id?: string;
    name: string;
    boxArtURL?: string;
  } | null;
}

export interface LiveStreamsPage {
  items: LiveStream[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type LiveStatusMap = Record<string, LiveStream>;

export type ScreenShareSourceType = 'browser' | 'application';

export type ScreenShareSessionState = {
  active: boolean;
  sessionId: string | null;
  sourceType: ScreenShareSourceType | null;
  sourceLabel: string | null;
  startedAt: number | null;
  interactive: boolean;
  maxViewers: number;
  currentViewers: number;
  streamReady: boolean;
  streamMessage: string | null;
};

export type SignalPayload = {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export type RemoteInputPayload = {
  kind: 'pointer' | 'keyboard';
  action: 'move' | 'down' | 'up' | 'wheel';
  x?: number;
  y?: number;
  button?: 'left' | 'middle' | 'right';
  key?: string;
  deltaX?: number;
  deltaY?: number;
};

export type WsMessage = {
  type?: string;
  state?: ScreenShareSessionState;
  message?: string;
  clientId?: string;
  hostClientId?: string | null;
  role?: string;
  from?: string;
  target?: string;
  payload?: SignalPayload;
};
