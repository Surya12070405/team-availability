import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import boardsRouter from './routes/boards.js';
import { errorHandler, notFound } from './middleware/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const limiter = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message } }),
  });

export function createApp({ corsOrigin, rateLimitEnabled = true, trustProxy = false } = {}) {
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: (corsOrigin || '').split(',').map((s) => s.trim()).filter(Boolean) }));
  app.use(express.json({ limit: '50kb' }));

  if (rateLimitEnabled) {
    app.use('/api', limiter(60_000, 600, 'Too many requests. Please slow down a little.'));
    app.post('/api/boards', limiter(60 * 60_000, 30, 'Too many boards created from this network. Try again later.'));
    app.post('/api/boards/:slug/members', limiter(60 * 60_000, 80, 'Too many people joined from this network. Try again later.'));
  }

  app.get('/api/health', (_req, res) => {
    const ok = mongoose.connection.readyState === 1;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'database_unavailable' });
  });
  app.use('/api/boards', boardsRouter);
  app.use('/api', notFound);

  // Production: serve the built React app (and let the client router handle /b/:slug links).
  const dist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
