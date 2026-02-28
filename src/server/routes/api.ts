import { Router } from 'express';
import { generateMasterPlaylist, proxyVariantPlaylist, fetchUserInfo, fetchUserVods, searchChannels, fetchTrendingVODs, searchGlobalContent } from '../services/twitch.service';
import { getAllHistory, getHistoryByVodId, updateHistory } from '../services/history.service';

const router = Router();

// Search & Trends
router.get('/search/channels', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json([]);
    const results = await searchChannels(q);
    res.json(results);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/search/global', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json([]);
    const results = await searchGlobalContent(q);
    res.json(results);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/trends', async (req, res) => {
  try {
    const results = await fetchTrendingVODs();
    res.json(results);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// History
router.get('/history', (req, res) => {
  res.json(getAllHistory());
});

router.get('/history/:vodId', (req, res) => {
  const entry = getHistoryByVodId(req.params.vodId);
  if (entry) {
    res.json(entry);
  } else {
    res.status(404).json({ error: 'History not found' });
  }
});

router.post('/history', async (req, res) => {
  const { vodId, timecode, duration } = req.body;
  if (!vodId || typeof timecode !== 'number') {
    res.status(400).json({ error: 'Invalid parameters' });
    return;
  }
  
  try {
    const updated = await updateHistory(vodId, timecode, duration || 0);
    res.json(updated);
  } catch (err: any) {
    console.error('Error updating history:', err);
    res.status(500).json({ error: 'Failed to update history' });
  }
});

// Master Playlist generation
router.get('/vod/:vodId/master.m3u8', async (req, res) => {
  try {
    const vodId = req.params.vodId;
    const host = req.get('host') || 'localhost'; 
    
    const playlist = await generateMasterPlaylist(vodId, host);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(playlist);
  } catch (err: any) {
    console.error(err);
    res.status(500).send('Error generating master playlist: ' + err.message);
  }
});

// Variant Playlist proxying
router.get('/proxy/variant.m3u8', async (req, res) => {
  try {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      res.status(400).send('Missing url parameter');
      return;
    }
    
    const modifiedVariant = await proxyVariantPlaylist(targetUrl);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(modifiedVariant);
  } catch (err: any) {
    console.error(err);
    res.status(500).send('Error proxying variant: ' + err.message);
  }
});

// User Info
router.get('/user/:username', async (req, res) => {
  try {
    const user = await fetchUserInfo(req.params.username);
    res.json(user);
  } catch (err: any) {
    console.error(err);
    res.status(404).json({ error: err.message });
  }
});

// User VODs
router.get('/user/:username/vods', async (req, res) => {
  try {
    const vods = await fetchUserVods(req.params.username);
    res.json(vods);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;