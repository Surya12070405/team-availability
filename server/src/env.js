// Loads configuration from server/.env and, when present, the repo-root .env.development.local
// (where the MongoDB Atlas integration injects MONGODB_URI). Real environment variables always win,
// and the first file to define a key wins over later ones.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: [path.join(serverDir, '.env'), path.join(serverDir, '..', '.env.development.local')], quiet: true });

export const DB_NAME = 'team_availability';
export const MONGODB_URI = process.env.MONGODB_URI || `mongodb://127.0.0.1:27017/${DB_NAME}`;

export function redactUri(uri) {
  return uri.replace(/\/\/[^@/]*@/, '//***@');
}
