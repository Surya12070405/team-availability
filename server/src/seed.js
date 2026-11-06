// Creates a demo board at /b/demo-team with five teammates across five time zones.
//   npm run seed
import 'dotenv/config';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Board, Member, Option, ensureIndexes } from './models/index.js';
import { generateSlots } from './lib/slots.js';
import { hashToken } from './middleware/auth.js';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/team_availability';
const SLUG = 'demo-team';

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Everyone is free roughly 9-17 their local time on weekdays, with a few random gaps.
const TEAM = [
  { name: 'Asha', timezone: 'Asia/Kolkata', from: 9, to: 18 },
  { name: 'Ben', timezone: 'Europe/London', from: 9, to: 17 },
  { name: 'Carla', timezone: 'America/New_York', from: 9, to: 17 },
  { name: 'Dev', timezone: 'Asia/Singapore', from: 10, to: 19 },
  { name: 'Elena', timezone: 'Europe/Berlin', from: 9, to: 17 },
];

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await ensureIndexes();

  const old = await Board.findOne({ slug: SLUG });
  if (old) await Promise.all([Member.deleteMany({ boardId: old._id }), Option.deleteMany({ boardId: old._id }), Board.deleteOne({ _id: old._id })]);

  const timezone = 'Europe/London';
  const startDate = DateTime.now().setZone(timezone).plus({ days: 1 }).toISODate();
  const input = { startDate, days: 7, dayStartHour: 6, dayEndHour: 22, slotMinutes: 30, timezone };
  const slots = generateSlots(input);
  const adminToken = 'demo-organiser-key';

  const board = await Board.create({ slug: SLUG, title: 'Product sync (demo)', ...input, slots, adminTokenHash: hashToken(adminToken) });

  const members = [];
  for (const [i, t] of TEAM.entries()) {
    const rand = rng(100 + i);
    const availability = slots.filter((s) => {
      const local = DateTime.fromISO(s, { zone: t.timezone });
      if (local.weekday > 5) return false;
      if (local.hour < t.from || local.hour >= t.to) return false;
      return rand() > 0.12;
    });
    members.push(await Member.create({
      boardId: board._id, name: t.name, nameKey: t.name.toLowerCase(), timezone: t.timezone,
      tokenHash: hashToken(`demo-member-${t.name.toLowerCase()}`), availability,
    }));
  }

  console.log(`Demo board ready: /b/${SLUG}   (${slots.length} slots, ${members.length} members)`);
  console.log(`Organiser key for the demo board: ${adminToken}`);
  console.log(`Member keys: demo-member-<name> (e.g. demo-member-asha)`);
} catch (err) {
  console.error('Seeding failed:', err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
