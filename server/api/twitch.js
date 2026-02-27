const crypto = require('node:crypto');

async function fetchTwitchDataGQL(vodID) {
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

function createServingID() {
  const w = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');
  let id = '';
  for (let i = 0; i < 32; i++) id += w[Math.floor(Math.random() * w.length)];
  return id;
}

async function isValidQuality(url) {
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
  } catch (err) {
    console.warn(`Quality check failed for ${url}: ${err.message}`, err);
  }
  return null;
}

async function generateMasterPlaylist(vodId, host) {
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
  const resolutions = {
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
    const storyboardIndex = paths.findIndex(el => el.includes('storyboards'));
    if (storyboardIndex === -1) throw new Error('Cannot find storyboards in URL');
    vodSpecialID = paths[storyboardIndex - 1];
    if (!vodSpecialID) throw new Error('Cannot extract vodSpecialID');
  } catch (error) {
    throw new Error('Failed to parse seekPreviewsURL: ' + error.message);
  }
  
  let fakePlaylist = `#EXTM3U
#EXT-X-TWITCH-INFO:ORIGIN="s3",B="false",REGION="EU",USER-IP="127.0.0.1",SERVING-ID="${createServingID()}",CLUSTER="cloudfront_vod",USER-COUNTRY="BE",MANIFEST-CLUSTER="cloudfront_vod"`;

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
    
    // Validate quality with a timeout
    const valid = await Promise.race([
      isValidQuality(streamUrl),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000))
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

async function proxyVariantPlaylist(targetUrl) {
  console.log(`[NSV] Proxying variant playlist: ${targetUrl}`);
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch variant playlist from Twitch (${response.status})`);
  }
  
  let body = await response.text();
  
  // Patch unmuted segments to muted (to bypass Twitch's muted VOD restrictions/missing files)
  body = body.replace(/-unmuted/g, '-muted');
  
  // Determine the base path for absolute URLs
  const baseUrlMatch = targetUrl.match(/^(.*\/)/);
  if (!baseUrlMatch) return body;
  const baseUrl = baseUrlMatch[1];
  
  // Prepend base URL to segment URLs
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;
    
    // Replace relative URIs inside tags like #EXT-X-MAP:URI="init.mp4"
    if (line.startsWith('#') && line.includes('URI="') && !line.includes('URI="http')) {
      line = line.replace(/URI="([^"]+)"/, `URI="${baseUrl}$1"`);
      lines[i] = line;
      continue;
    }

    if (!line.startsWith('#') && !line.startsWith('http')) {
      // It's a relative path (e.g. 0.ts or 0-muted.ts)
      lines[i] = baseUrl + line;
    }
  }
  
  return lines.join('\n');
}

async function fetchUserInfo(username) {
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
  const data = await resp.json();
  if (!data || !data.data || !data.data.user) throw new Error('User not found');
  return data.data.user;
}

async function fetchUserVods(username) {
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
  const data = await resp.json();
  if (!data || !data.data || !data.data.user) throw new Error('User not found');
  return data.data.user.videos.edges.map(e => e.node);
}

module.exports = {
  generateMasterPlaylist,
  proxyVariantPlaylist,
  fetchUserInfo,
  fetchUserVods
};
