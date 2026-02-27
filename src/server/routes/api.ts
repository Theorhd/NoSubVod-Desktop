import { Router } from 'express';
import { generateMasterPlaylist, proxyVariantPlaylist, fetchUserInfo, fetchUserVods } from '../services/twitch.service';

const router = Router();

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