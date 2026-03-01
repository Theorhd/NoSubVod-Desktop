import express from 'express';
import cors from 'cors';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import apiRoutes from './routes/api';
import pino from 'pino';
import { initHistoryService } from './services/history.service';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

export function startServer(port: number, isDev: boolean, userDataPath: string) {
  const app = express();

  const spaFallbackLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Initialize History Service asynchronously
  initHistoryService(userDataPath).catch((err) => {
    logger.error('Failed to initialize history service', err);
  });

  app.use(cors());
  app.use(express.json());

  // Routes
  app.use('/api', apiRoutes);

  // Serve static files for the portal (from dist/portal if built)
  if (isDev) {
    // In dev, Vite handles the portal, but we can have a fallback
    app.get('/', (req, res) => {
      res.send('Server is running in DEV mode. Use Vite on port 5173 for the portal.');
    });
  } else {
    const portalPath = path.join(__dirname, 'portal');
    app.use(express.static(portalPath));
    // Catch-all route for SPA
    app.get(/.*/, spaFallbackLimiter, (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(portalPath, 'index.html'));
    });
  }

  const server = app.listen(port, '0.0.0.0', () => {
    logger.info(`Server listening on port ${port}`);
  });

  server.on('error', (err: any) => {
    logger.error('Express server error:', err);
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${port} is already in use.`);
    }
  });

  return server;
}
