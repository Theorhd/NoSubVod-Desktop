export interface UserInfo {
  id: string;
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