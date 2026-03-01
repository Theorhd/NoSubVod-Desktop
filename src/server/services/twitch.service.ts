import NodeCache from 'node-cache';
import {
  HistoryEntry,
  LiveStream,
  LiveStreamsPage,
  SubEntry,
  UserInfo,
  VOD,
} from '../../shared/types';

// TTL of 1 hour for users and VODs
const cache = new NodeCache({ stdTTL: 3600 });

async function fetchTwitchDataGQL(vodID: string) {
  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { video(id: "${vodID}") { broadcastType, createdAt, seekPreviewsURL, owner { login } }}`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  return resp.json();
}

function createServingID(): string {
  const w = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');
  let id = '';
  for (let i = 0; i < 32; i++) id += w[Math.floor(Math.random() * w.length)];
  return id;
}

function gqlEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function createSimpleHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash << 5) - hash + (value.codePointAt(index) || 0);
    hash = Math.trunc(hash);
  }
  return Math.abs(hash).toString(36);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeLanguage(language?: string): string {
  return (language || '').trim().toLowerCase();
}

function getWatchWeight(entry: HistoryEntry): number {
  if (!entry.duration || entry.duration <= 0) {
    return clamp(entry.timecode / 1800, 0.05, 1);
  }
  return clamp(entry.timecode / entry.duration, 0.05, 1);
}

type PreferenceProfile = {
  gameScores: Map<string, number>;
  channelScores: Map<string, number>;
  languageScores: Map<string, number>;
};

type ScoredVod = VOD & {
  __score: number;
};

async function fetchGameVods(
  gameName: string,
  languages?: string[],
  first: number = 20
): Promise<VOD[]> {
  const languageFilter = languages ? `, languages: ${JSON.stringify(languages)}` : '';
  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { game(name: "${gqlEscape(gameName)}") { videos(first: ${first}, sort: VIEWS${languageFilter}) { edges { node { id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, language, game { name }, owner { login, displayName, profileImageURL(width: 50) } } } } } }`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) return [];
  const data: any = await resp.json();
  if (!data?.data?.game?.videos?.edges) return [];
  return data.data.game.videos.edges.map((edge: any) => edge.node).filter(Boolean);
}

export async function fetchGameVodsByName(gameName: string, first: number = 24): Promise<VOD[]> {
  const [frenchFirst, globalPool] = await Promise.all([
    fetchGameVods(gameName, ['fr'], first),
    fetchGameVods(gameName, undefined, first),
  ]);

  const deduped = new Map<string, VOD>();
  for (const vod of [...frenchFirst, ...globalPool]) {
    if (vod?.id && !deduped.has(vod.id)) {
      deduped.set(vod.id, vod);
    }
  }

  return [...deduped.values()].slice(0, first);
}

async function fetchWatchedVodMetadata(vodIds: string[]): Promise<VOD[]> {
  if (vodIds.length === 0) return [];

  const safeIds = vodIds
    .map((vodId) => vodId.trim())
    .filter(Boolean)
    .filter((vodId) => /^\d+$/.test(vodId))
    .slice(0, 30);

  if (safeIds.length === 0) return [];

  const queryBody = safeIds
    .map(
      (vodId, index) =>
        `v${index}: video(id: "${vodId}") { id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, language, game { name }, owner { login, displayName, profileImageURL(width: 50) } }`
    )
    .join(' ');

  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { ${queryBody} }`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) return [];
  const data: any = await resp.json();
  const payload = data?.data || {};
  return Object.values(payload).filter(Boolean) as VOD[];
}

export async function fetchVodsByIds(vodIds: string[]): Promise<VOD[]> {
  return fetchWatchedVodMetadata(vodIds);
}

function buildPreferenceProfile(
  history: Record<string, HistoryEntry>,
  watchedVods: VOD[],
  subs: SubEntry[]
): PreferenceProfile {
  const gameScores = new Map<string, number>();
  const channelScores = new Map<string, number>();
  const languageScores = new Map<string, number>();

  const historyByVodId = new Map<string, HistoryEntry>(
    Object.values(history).map((entry) => [entry.vodId, entry])
  );

  for (const watchedVod of watchedVods) {
    const historyEntry = historyByVodId.get(watchedVod.id);
    if (!historyEntry) continue;

    const watchWeight = getWatchWeight(historyEntry);
    const recencyPenalty = clamp(
      1 - (Date.now() - historyEntry.updatedAt) / (1000 * 60 * 60 * 24 * 45),
      0.35,
      1
    );
    const weighted = watchWeight * recencyPenalty;

    const gameName = watchedVod.game?.name || '';
    if (gameName) {
      gameScores.set(gameName, (gameScores.get(gameName) || 0) + weighted);
    }

    const channelLogin = watchedVod.owner?.login?.toLowerCase() || '';
    if (channelLogin) {
      channelScores.set(channelLogin, (channelScores.get(channelLogin) || 0) + weighted);
    }

    const language = normalizeLanguage(watchedVod.language);
    if (language) {
      languageScores.set(language, (languageScores.get(language) || 0) + weighted);
    }
  }

  for (const sub of subs) {
    const login = sub.login.toLowerCase();
    channelScores.set(login, (channelScores.get(login) || 0) + 1.75);
  }

  if ((languageScores.get('fr') || 0) < 1.2) {
    languageScores.set('fr', (languageScores.get('fr') || 0) + 1.2);
  }

  return {
    gameScores,
    channelScores,
    languageScores,
  };
}

function scoreCandidateVod(vod: VOD, profile: PreferenceProfile, subsSet: Set<string>): number {
  const gameName = vod.game?.name || '';
  const channelLogin = vod.owner?.login?.toLowerCase() || '';
  const language = normalizeLanguage(vod.language);

  const popularityScore = Math.log10((vod.viewCount || 0) + 10) * 1.15;
  const gameAffinity = (profile.gameScores.get(gameName) || 0) * 2.1;
  const channelAffinity = (profile.channelScores.get(channelLogin) || 0) * 2.4;
  const languageAffinity = (profile.languageScores.get(language) || 0) * 1.15;
  const frBoost = language === 'fr' ? 2.3 : 0;
  const subBoost = subsSet.has(channelLogin) ? 3.2 : 0;

  const vodAgeDays = clamp(
    (Date.now() - new Date(vod.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    0,
    60
  );
  const recencyScore = clamp(2.1 - vodAgeDays / 9, 0, 2.1);

  return (
    popularityScore +
    gameAffinity +
    channelAffinity +
    languageAffinity +
    frBoost +
    subBoost +
    recencyScore
  );
}

function interleaveLocalizedFeed(
  candidates: ScoredVod[],
  foreignRatio: number,
  maxItems: number
): VOD[] {
  const french = candidates
    .filter((vod) => normalizeLanguage(vod.language) === 'fr')
    .sort((left, right) => right.__score - left.__score);

  const foreign = candidates
    .filter((vod) => normalizeLanguage(vod.language) !== 'fr')
    .sort((left, right) => right.__score - left.__score);

  const feed: ScoredVod[] = [];
  let frenchIndex = 0;
  let foreignIndex = 0;
  let foreignAdded = 0;

  while (feed.length < maxItems && (frenchIndex < french.length || foreignIndex < foreign.length)) {
    const lastFour = feed.slice(-4);
    const frenchStreak = lastFour.every((vod) => normalizeLanguage(vod.language) === 'fr');
    const foreignStreak =
      lastFour.length > 0 && lastFour.every((vod) => normalizeLanguage(vod.language) !== 'fr');
    const targetForeignCount = Math.floor((feed.length + 1) * foreignRatio);

    const shouldPickForeign =
      !foreignStreak &&
      foreignIndex < foreign.length &&
      (foreignAdded < targetForeignCount || frenchIndex >= french.length || frenchStreak);

    if (shouldPickForeign) {
      feed.push(foreign[foreignIndex++]);
      foreignAdded++;
      continue;
    }

    if (frenchIndex < french.length) {
      feed.push(french[frenchIndex++]);
      continue;
    }

    if (foreignIndex < foreign.length) {
      feed.push(foreign[foreignIndex++]);
      foreignAdded++;
    }
  }

  return feed.map((vod) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { __score, ...cleanVod } = vod;
    return cleanVod as VOD;
  });
}

async function isValidQuality(url: string): Promise<{ codec: string } | null> {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.text();
      if (data.includes('.ts')) {
        return { codec: 'avc1.4D001E' };
      }
      if (data.includes('.mp4')) {
        const mp4Req = await fetch(url.replace('index-dvr.m3u8', 'init-0.mp4'));
        if (mp4Req.ok) {
          const content = await mp4Req.text();
          return { codec: content.includes('hev1') ? 'hev1.1.6.L93.B0' : 'avc1.4D001E' };
        }
        return { codec: 'hev1.1.6.L93.B0' };
      }
    }
  } catch (err: any) {
    console.warn(`Quality check failed for ${url}: ${err.message}`);
  }
  return null;
}

function parseVodUrlInfo(seekPreviewsURL: string): { domain: string; vodSpecialID: string } {
  try {
    const currentURL = new URL(seekPreviewsURL);
    const domain = currentURL.host;
    const paths = currentURL.pathname.split('/');
    const storyboardIndex = paths.findIndex((el: string) => el.includes('storyboards'));
    if (storyboardIndex === -1) throw new Error('Cannot find storyboards in URL');
    const vodSpecialID = paths[storyboardIndex - 1];
    if (!vodSpecialID) throw new Error('Cannot extract vodSpecialID');
    return { domain, vodSpecialID };
  } catch (error: any) {
    throw new Error('Failed to parse seekPreviewsURL: ' + error.message);
  }
}

function buildStreamUrl(
  domain: string,
  vodSpecialID: string,
  resKey: string,
  vodId: string,
  broadcastType: string,
  daysDiff: number,
  channelLogin: string
): string {
  if (broadcastType === 'highlight') {
    return `https://${domain}/${vodSpecialID}/${resKey}/highlight-${vodId}.m3u8`;
  }
  if (broadcastType === 'upload' && daysDiff > 7) {
    return `https://${domain}/${channelLogin}/${vodId}/${vodSpecialID}/${resKey}/index-dvr.m3u8`;
  }
  return `https://${domain}/${vodSpecialID}/${resKey}/index-dvr.m3u8`;
}

export async function generateMasterPlaylist(vodId: string, host: string): Promise<string> {
  console.log(`[NSV] Generating Master Playlist for VOD: ${vodId}`);
  const data = await fetchTwitchDataGQL(vodId);

  if (!data?.data?.video) {
    throw new Error('Video not found or invalid response');
  }

  const vodData = data.data.video;
  if (!vodData.owner || !vodData.seekPreviewsURL) {
    throw new Error('Invalid VOD data (missing owner or seekPreviewsURL)');
  }

  const channelData = vodData.owner;
  const resolutions: Record<string, { res: string; fps: number }> = {
    '160p30': { res: '284x160', fps: 30 },
    '360p30': { res: '640x360', fps: 30 },
    '480p30': { res: '854x480', fps: 30 },
    '720p60': { res: '1280x720', fps: 60 },
    '1080p60': { res: '1920x1080', fps: 60 },
    chunked: { res: '1920x1080', fps: 60 },
  };
  const keys = Object.keys(resolutions).reverse();

  const { domain, vodSpecialID } = parseVodUrlInfo(vodData.seekPreviewsURL);

  let fakePlaylist = `#EXTM3U\n#EXT-X-TWITCH-INFO:ORIGIN="s3",B="false",REGION="EU",USER-IP="127.0.0.1",SERVING-ID="${createServingID()}",CLUSTER="cloudfront_vod",USER-COUNTRY="BE",MANIFEST-CLUSTER="cloudfront_vod"`;

  const now = new Date();
  const created = new Date(vodData.createdAt);
  const daysDiff = (now.getTime() - created.getTime()) / 86400000;
  const broadcastType = vodData.broadcastType.toLowerCase();
  let startBandwidth = 8534030;

  for (const resKey of keys) {
    const streamUrl = buildStreamUrl(
      domain,
      vodSpecialID,
      resKey,
      vodId,
      broadcastType,
      daysDiff,
      channelData.login
    );

    const valid = await Promise.race([
      isValidQuality(streamUrl),
      new Promise<{ codec: string } | null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    if (valid) {
      const quality = resKey === 'chunked' ? `${resolutions[resKey].res.split('x')[1]}p` : resKey;
      const enabled = resKey === 'chunked' ? 'YES' : 'NO';
      const proxyUrl = `http://${host}/api/proxy/variant.m3u8?url=${encodeURIComponent(streamUrl)}`;

      fakePlaylist += `\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="${quality}",NAME="${quality}",AUTOSELECT=${enabled},DEFAULT=${enabled}\n#EXT-X-STREAM-INF:BANDWIDTH=${startBandwidth},CODECS="${valid.codec},mp4a.40.2",RESOLUTION=${resolutions[resKey].res},VIDEO="${quality}",FRAME-RATE=${resolutions[resKey].fps}\n${proxyUrl}`;
      startBandwidth -= 100;
    }
  }

  return fakePlaylist;
}

export async function proxyVariantPlaylist(targetUrl: string): Promise<string> {
  console.log(`[NSV] Proxying variant playlist: ${targetUrl}`);
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch variant playlist from Twitch (${response.status})`);
  }

  let body = await response.text();
  body = body.replaceAll('-unmuted', '-muted');

  const baseUrlMatch = /^(.*\/)/.exec(targetUrl);
  if (!baseUrlMatch) return body;
  const baseUrl = baseUrlMatch[1];

  // FIXED regex here:
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#') && line.includes('URI="') && !line.includes('URI="http')) {
      line = line.replace(/URI="([^"]+)"/, `URI="${baseUrl}$1"`);
      lines[i] = line;
      continue;
    }

    if (!line.startsWith('#') && !line.startsWith('http')) {
      lines[i] = baseUrl + line;
    }
  }

  return lines.join('\n');
}

export async function fetchUserInfo(username: string): Promise<UserInfo> {
  const cacheKey = `user_${username}`;
  const cached = cache.get<UserInfo>(cacheKey);
  if (cached) return cached;

  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { user(login: "${username}") { id, login, displayName, profileImageURL(width: 300) } }`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data?.data?.user) throw new Error('User not found');

  const user = data.data.user;
  cache.set(cacheKey, user);
  return user;
}

export async function fetchUserVods(username: string): Promise<VOD[]> {
  const cacheKey = `vods_${username}`;
  const cached = cache.get<VOD[]>(cacheKey);
  if (cached) return cached;

  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { user(login: "${username}") { videos(first: 30) { edges { node { id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, language, game { name }, owner { login, displayName, profileImageURL(width: 50) } } } } } }`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data?.data?.user) throw new Error('User not found');

  const vods = data.data.user.videos.edges.map((e: any) => e.node);
  cache.set(cacheKey, vods, 600); // 10 minutes cache for VODs
  return vods;
}

export async function searchChannels(query: string): Promise<UserInfo[]> {
  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { searchFor(userQuery: "${query}", platform: "web") { channels { edges { item { ... on User { id, login, displayName, profileImageURL(width: 300) } } } } } }`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data?.data?.searchFor?.channels) return [];

  return data.data.searchFor.channels.edges.map((e: any) => e.item).filter((n: any) => n?.login);
}

export async function fetchTrendingVODs(
  history: Record<string, HistoryEntry> = {},
  subs: SubEntry[] = []
): Promise<VOD[]> {
  const historyEntries = Object.values(history)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 35);

  const profileFingerprint = createSimpleHash(
    JSON.stringify({
      history: historyEntries.map((entry) => ({
        vodId: entry.vodId,
        timecode: Math.floor(entry.timecode),
        duration: Math.floor(entry.duration),
        updatedAt: Math.floor(entry.updatedAt / (1000 * 60 * 10)),
      })),
      subs: subs
        .map((sub) => sub.login.toLowerCase())
        .sort((left, right) => left.localeCompare(right)),
    })
  );

  const cacheKey = `trending_vods_${profileFingerprint}`;
  const cached = cache.get<VOD[]>(cacheKey);
  if (cached) return cached;

  try {
    const watchedVodIds = historyEntries.map((entry) => entry.vodId);
    const watchedVods = await fetchWatchedVodMetadata(watchedVodIds);
    const profile = buildPreferenceProfile(history, watchedVods, subs);
    const subsSet = new Set(subs.map((sub) => sub.login.toLowerCase()));

    const topGames = [...profile.gameScores.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([gameName]) => gameName)
      .slice(0, 3);

    if (!topGames.includes('Just Chatting')) {
      topGames.push('Just Chatting');
    }

    const uniqueTopGames = [...new Set(topGames)].slice(0, 4);

    const gameFetches = uniqueTopGames.flatMap((gameName) => [
      fetchGameVods(gameName, ['fr'], 18),
      fetchGameVods(gameName, undefined, 18),
    ]);

    const subFetches = subs.slice(0, 10).map((sub) => fetchUserVods(sub.login));

    const [gamePools, subPools] = await Promise.all([
      Promise.all(gameFetches),
      Promise.all(subFetches).catch(() => []),
    ]);

    const allCandidates = [...gamePools.flat(), ...subPools.flat()].filter(Boolean);
    const deduped = new Map<string, VOD>();

    for (const candidate of allCandidates) {
      if (!candidate?.id || deduped.has(candidate.id)) continue;
      deduped.set(candidate.id, candidate);
    }

    const scored: ScoredVod[] = [...deduped.values()]
      .map((vod) => ({
        ...vod,
        __score: scoreCandidateVod(vod, profile, subsSet),
      }))
      .sort((left, right) => right.__score - left.__score)
      .slice(0, 120);

    const languageEntries = [...profile.languageScores.entries()];
    const totalLangWeight = languageEntries.reduce((sum, [, value]) => sum + value, 0);
    const foreignWeight = languageEntries
      .filter(([language]) => language !== 'fr')
      .reduce((sum, [, value]) => sum + value, 0);
    const foreignAffinity = totalLangWeight > 0 ? foreignWeight / totalLangWeight : 0;

    const foreignRatio = clamp(0.16 + foreignAffinity * 0.35, 0.16, 0.4);
    const personalizedFeed = interleaveLocalizedFeed(scored, foreignRatio, 40);

    cache.set(cacheKey, personalizedFeed, 900); // 15 minutes cache per profile
    return personalizedFeed;
  } catch (err) {
    console.error('Error fetching trending VODs:', err);
    throw new Error('Failed to fetch trending VODs');
  }
}

export async function searchGlobalContent(query: string): Promise<any> {
  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { searchFor(userQuery: "${query}", platform: "web") { channels { edges { item { ... on User { id, login, displayName, profileImageURL(width: 300), stream { id title viewersCount previewImageURL(width: 640, height: 360) }, __typename } } } }, games { edges { item { ... on Game { id, name, boxArtURL(width: 150, height: 200), __typename } } } } } }`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data?.data?.searchFor) return [];

  const channels = data.data.searchFor.channels?.edges?.map((e: any) => e.item) || [];
  const games = data.data.searchFor.games?.edges?.map((e: any) => e.item) || [];

  return [...channels, ...games].filter(Boolean);
}

export async function fetchVideoChat(
  vodId: string,
  contentOffsetSeconds: number = 0
): Promise<any> {
  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { video(id: "${vodId}") { comments(contentOffsetSeconds: ${Math.floor(contentOffsetSeconds)}) { edges { node { id, commenter { displayName, login, profileImageURL(width: 50) }, message { fragments { text, emote { id, setID } } }, contentOffsetSeconds, createdAt } }, pageInfo { hasNextPage } } } }`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data?.data?.video?.comments) return { messages: [], hasNextPage: false };

  return {
    messages: data.data.video.comments.edges.map((e: any) => e.node),
    hasNextPage: data.data.video.comments.pageInfo.hasNextPage,
  };
}
export async function fetchVideoMarkers(vodId: string): Promise<any[]> {
  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { video(id: "${vodId}") { markers { id, displayTime, description, type } } }`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data?.data?.video?.markers) return [];

  return data.data.video.markers;
}

export async function fetchLiveStreams(
  first: number = 24,
  after?: string
): Promise<LiveStreamsPage> {
  const safeFirst = clamp(Math.floor(first || 24), 8, 48);
  const safeAfter = (after || '').trim();
  const cacheKey = `live_streams_${safeFirst}_${safeAfter || 'first'}`;
  const cached = cache.get<LiveStreamsPage>(cacheKey);
  if (cached) return cached;

  const paginationArgs = safeAfter ? `, after: ${JSON.stringify(safeAfter)}` : '';
  const resp = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    body: JSON.stringify({
      query: `query { streams(first: ${safeFirst}${paginationArgs}) { edges { cursor node { id title type viewersCount previewImageURL(width: 640, height: 360) createdAt language game { id name boxArtURL(width: 110, height: 147) } broadcaster { id login displayName profileImageURL(width: 70) } } } pageInfo { hasNextPage } } }`,
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    throw new Error('Twitch API request failed: ' + resp.status);
  }

  const data: any = await resp.json();
  const edges = data?.data?.streams?.edges;
  if (!Array.isArray(edges)) {
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
    };
  }

  const items: LiveStream[] = edges
    .map((edge: any) => {
      const node = edge?.node;
      if (!node?.id || !node?.broadcaster?.login) {
        return null;
      }

      return {
        id: String(node.id),
        title: node.title || 'Live stream',
        previewImageURL: node.previewImageURL || '',
        viewerCount: Number(node.viewersCount) || 0,
        language: node.language || '',
        startedAt: node.createdAt || new Date().toISOString(),
        broadcaster: {
          id: String(node.broadcaster.id || ''),
          login: node.broadcaster.login,
          displayName: node.broadcaster.displayName || node.broadcaster.login,
          profileImageURL: node.broadcaster.profileImageURL || '',
        },
        game: node.game
          ? {
              id: node.game.id,
              name: node.game.name,
              boxArtURL: node.game.boxArtURL,
            }
          : null,
      } as LiveStream;
    })
    .filter(Boolean) as LiveStream[];

  const lastCursor = (edges.at(-1)?.cursor as string | undefined) || null;
  const hasNextPage = Boolean(data?.data?.streams?.pageInfo?.hasNextPage);

  const payload: LiveStreamsPage = {
    items,
    nextCursor: hasNextPage ? lastCursor : null,
    hasMore: hasNextPage && Boolean(lastCursor),
  };

  cache.set(cacheKey, payload, 25);
  return payload;
}
