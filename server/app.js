const express = require('express');
const cors = require('cors');
const path = require('path');
const twitchApi = require('./api/twitch');

function startServer(port) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  
  // Serve static files for the portal
  app.use(express.static(path.join(__dirname, 'public')));

  // Master Playlist generation
  app.get('/api/vod/:vodId/master.m3u8', async (req, res) => {
    try {
      const vodId = req.params.vodId;
      const host = req.get('host'); // IP:PORT for proxy rewriting
      
      const playlist = await twitchApi.generateMasterPlaylist(vodId, host);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(playlist);
    } catch (err) {
      console.error(err);
      res.status(500).send('Error generating master playlist: ' + err.message);
    }
  });

  // Variant Playlist proxying
  app.get('/api/proxy/variant.m3u8', async (req, res) => {
    try {
      const targetUrl = req.query.url;
      if (!targetUrl) return res.status(400).send('Missing url parameter');
      
      const modifiedVariant = await twitchApi.proxyVariantPlaylist(targetUrl);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(modifiedVariant);
    } catch (err) {
      console.error(err);
      res.status(500).send('Error proxying variant: ' + err.message);
    }
  });

  // User Info
  app.get('/api/user/:username', async (req, res) => {
    try {
      const user = await twitchApi.fetchUserInfo(req.params.username);
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(404).json({ error: err.message });
    }
  });

  // User VODs
  app.get('/api/user/:username/vods', async (req, res) => {
    try {
      const vods = await twitchApi.fetchUserVods(req.params.username);
      res.json(vods);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
  });

  server.on('error', (err) => {
    console.error('Express server error:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use.`);
    }
  });
}

module.exports = { startServer };
