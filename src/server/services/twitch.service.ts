import NodeCache from 'node-cache';
import { UserInfo, VOD } from '../../shared/types';

// TTL of 1 hour for users and VODs
const cache = new NodeCache({ stdTTL: 3600 });

async function fetchTwitchDataGQL(vodID: string) {
  const resp = await fetch("https://gql.twitch.tv/gql", {
    method: 'POST',
    body: JSON.stringify({
      query: `query { video(id: "${vodID}") { broadcastType, createdAt, seekPreviewsURL, owner { login } }}`
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
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

export async function generateMasterPlaylist(vodId: string, host: string): Promise<string> {
  console.log(`[NSV] Generating Master Playlist for VOD: ${vodId}`);
  const data = await fetchTwitchDataGQL(vodId);
  
  if (!data || !data.data || !data.data.video) {
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
    chunked: { res: '1920x1080', fps: 60 }
  };
  const keys = Object.keys(resolutions).reverse();
  
  let domain, vodSpecialID;
  try {
    const currentURL = new URL(vodData.seekPreviewsURL);
    domain = currentURL.host;
    const paths = currentURL.pathname.split('/');
    const storyboardIndex = paths.findIndex((el: string) => el.includes('storyboards'));
    if (storyboardIndex === -1) throw new Error('Cannot find storyboards in URL');
    vodSpecialID = paths[storyboardIndex - 1];
    if (!vodSpecialID) throw new Error('Cannot extract vodSpecialID');
  } catch (error: any) {
    throw new Error('Failed to parse seekPreviewsURL: ' + error.message);
  }
  
  let fakePlaylist = `#EXTM3U\n#EXT-X-TWITCH-INFO:ORIGIN="s3",B="false",REGION="EU",USER-IP="127.0.0.1",SERVING-ID="${createServingID()}",CLUSTER="cloudfront_vod",USER-COUNTRY="BE",MANIFEST-CLUSTER="cloudfront_vod"`;

  const now = new Date();
  const created = new Date(vodData.createdAt);
  const daysDiff = (now.getTime() - created.getTime()) / 86400000;
  const broadcastType = vodData.broadcastType.toLowerCase();
  let startBandwidth = 8534030;

  for (const resKey of keys) {
    let streamUrl;
    if (broadcastType === 'highlight') {
      streamUrl = `https://${domain}/${vodSpecialID}/${resKey}/highlight-${vodId}.m3u8`;
    } else if (broadcastType === 'upload' && daysDiff > 7) {
      streamUrl = `https://${domain}/${channelData.login}/${vodId}/${vodSpecialID}/${resKey}/index-dvr.m3u8`;
    } else {
      streamUrl = `https://${domain}/${vodSpecialID}/${resKey}/index-dvr.m3u8`;
    }
    
    const valid = await Promise.race([
      isValidQuality(streamUrl),
      new Promise<{ codec: string } | null>((resolve) => setTimeout(() => resolve(null), 5000))
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
  body = body.replace(/-unmuted/g, '-muted');
  
  const baseUrlMatch = targetUrl.match(/^(.*\/)/);
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

  const resp = await fetch("https://gql.twitch.tv/gql", {
    method: 'POST',
    body: JSON.stringify({
      query: `query { user(login: "${username}") { id, login, displayName, profileImageURL(width: 300) } }`
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data || !data.data || !data.data.user) throw new Error('User not found');
  
  const user = data.data.user;
  cache.set(cacheKey, user);
  return user;
}

export async function fetchUserVods(username: string): Promise<VOD[]> {
  const cacheKey = `vods_${username}`;
  const cached = cache.get<VOD[]>(cacheKey);
  if (cached) return cached;

  const resp = await fetch("https://gql.twitch.tv/gql", {
    method: 'POST',
    body: JSON.stringify({
      query: `query { user(login: "${username}") { videos(first: 30) { edges { node { id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, game { name } } } } } }`
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data || !data.data || !data.data.user) throw new Error('User not found');
  
  const vods = data.data.user.videos.edges.map((e: any) => e.node);
  cache.set(cacheKey, vods, 600); // 10 minutes cache for VODs
  return vods;
}

export async function searchChannels(query: string): Promise<UserInfo[]> {
  const resp = await fetch("https://gql.twitch.tv/gql", {
    method: 'POST',
    body: JSON.stringify({
      query: `query { searchFor(userQuery: "${query}", platform: "web") { channels { edges { item { ... on User { id, login, displayName, profileImageURL(width: 300) } } } } } }`
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data || !data.data || !data.data.searchFor || !data.data.searchFor.channels) return [];
  
  return data.data.searchFor.channels.edges.map((e: any) => e.item).filter((n: any) => n && n.login);
}

export async function fetchTrendingVODs(): Promise<VOD[]> {
  const cacheKey = `trending_vods`;
  const cached = cache.get<VOD[]>(cacheKey);
  if (cached) return cached;

  const fetchVods = async (langs?: string[]) => {
    const langFilter = langs ? `, languages: ${JSON.stringify(langs)}` : '';
    const resp = await fetch("https://gql.twitch.tv/gql", {
      method: 'POST',
      body: JSON.stringify({
        query: `query { game(name: "Just Chatting") { videos(first: 20, sort: VIEWS${langFilter}) { edges { node { id, title, lengthSeconds, previewThumbnailURL(width: 320, height: 180), createdAt, viewCount, game { name }, owner { login, displayName, profileImageURL(width: 50) } } } } } }`
      }),
      headers: {
        'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    if (!data || !data.data || !data.data.game || !data.data.game.videos) return [];
    return data.data.game.videos.edges.map((e: any) => e.node);
  };

  try {
    const [frVods, globalVods] = await Promise.all([
      fetchVods(["fr"]),
      fetchVods()
    ]);

    const seenIds = new Set<string>();
    const combined: VOD[] = [];

    // Prioritize French VODs
    for (const vod of frVods) {
      if (!seenIds.has(vod.id)) {
        combined.push(vod);
        seenIds.add(vod.id);
      }
    }

    // Add some global VODs
    let globalAdded = 0;
    for (const vod of globalVods) {
      if (!seenIds.has(vod.id) && globalAdded < 10) {
        combined.push(vod);
        seenIds.add(vod.id);
        globalAdded++;
      }
    }

    cache.set(cacheKey, combined, 1800); // 30 minutes cache
    return combined;
  } catch (err) {
    console.error('Error fetching trending VODs:', err);
    throw new Error('Failed to fetch trending VODs');
  }
}

export async function searchGlobalContent(query: string): Promise<any> {
  const resp = await fetch("https://gql.twitch.tv/gql", {
    method: 'POST',
    body: JSON.stringify({
      query: `query { searchFor(userQuery: "${query}", platform: "web") { channels { edges { item { ... on User { id, login, displayName, profileImageURL(width: 300), __typename } } } }, games { edges { item { ... on Game { id, name, boxArtURL(width: 150, height: 200), __typename } } } } } }`
    }),
    headers: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) throw new Error('Twitch API request failed: ' + resp.status);
  const data: any = await resp.json();
  if (!data || !data.data || !data.data.searchFor) return [];
  
  const channels = data.data.searchFor.channels?.edges?.map((e: any) => e.item) || [];
  const games = data.data.searchFor.games?.edges?.map((e: any) => e.item) || [];
  
  return [...channels, ...games].filter((n: any) => n);
}