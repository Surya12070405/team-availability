import mongoose from 'mongoose';
import { MONGODB_URI, DB_NAME, redactUri } from './env.js';
import { createApp } from './app.js';
import { ensureIndexes } from './models/index.js';

// Warm function instances reuse one connection; a failed attempt is cleared so the next request retries.
let connection;
function connect() {
  connection ??= mongoose
    .connect(MONGODB_URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 5000 })
    .then(ensureIndexes)
    .catch((err) => {
      connection = undefined;
      throw err;
    });
  return connection;
}

const app = createApp({ corsOrigin: process.env.CORS_ORIGIN, trustProxy: true });

export default async function handler(req, res) {
  try {
    await connect();
  } catch (err) {
    console.error(`Could not connect to MongoDB at ${redactUri(MONGODB_URI)}: ${err.message}`);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable. Please try again shortly.' } }));
    return;
  }
  return app(req, res);
}
