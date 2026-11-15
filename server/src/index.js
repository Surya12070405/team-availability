import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { ensureIndexes } from './models/index.js';

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/team_availability';

async function main() {
  try {
    await mongoose.connect(MONGODB_URI, {
      dbName: 'team_availability',
      serverSelectionTimeoutMS: 5000,
    });
    await ensureIndexes();
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error(`Could not connect to MongoDB at ${MONGODB_URI}: ${err.message}`);
    console.error('Start MongoDB (or set MONGODB_URI in server/.env) and try again.');
    process.exit(1);
  }

  const app = createApp({ corsOrigin: process.env.CORS_ORIGIN, trustProxy: process.env.TRUST_PROXY === '1' });
  const server = app.listen(PORT, () => console.log(`TeamAvailability API listening on http://localhost:${PORT}`));

  const shutdown = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
