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
  game: { name: string } | null;
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

export interface ChatMessage {
  id: string;
  commenter: {
    displayName: string;
    login: string;
    profileImageURL: string;
  };
  content: {
    text: string;
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
}
