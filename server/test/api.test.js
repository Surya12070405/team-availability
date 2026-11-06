// Database-backed API tests. Uses TEST_MONGODB_URI if set (the database is EMPTIED), otherwise a throwaway
// in-memory MongoDB via mongodb-memory-server.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { Board, Member, Option, ensureIndexes } from '../src/models/index.js';

let mongod;
let app;

beforeAll(async () => {
  const uri = process.env.TEST_MONGODB_URI;
  if (uri) {
    await mongoose.connect(uri);
  } else {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }
  await ensureIndexes();
  app = createApp({ rateLimitEnabled: false });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([Board.deleteMany({}), Member.deleteMany({}), Option.deleteMany({})]);
});

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const boardInput = (over = {}) => ({
  title: 'Study group', timezone: 'Europe/London', startDate: tomorrow(), days: 2, dayStartHour: 9, dayEndHour: 13, slotMinutes: 30, ...over,
});

async function makeBoard(over) {
  const res = await request(app).post('/api/boards').send(boardInput(over)).expect(201);
  return { slug: res.body.board.slug, adminToken: res.body.adminToken, slots: res.body.board.slots, state: res.body };
}

async function join(slug, name, timezone = 'Europe/London') {
  const res = await request(app).post(`/api/boards/${slug}/members`).send({ name, timezone }).expect(201);
  return { id: res.body.member.id, token: res.body.token };
}

const setAvail = (slug, m, slots) =>
  request(app).put(`/api/boards/${slug}/members/${m.id}/availability`).set('X-Member-Token', m.token).send({ slots });

describe('boards', () => {
  it('creates a board with generated slots and returns the organiser key once', async () => {
    const { state, slug } = await makeBoard();
    expect(slug).toMatch(/^[a-z0-9]{8}$/);
    expect(state.board.slots).toHaveLength(2 * 4 * 2);
    expect(state.adminToken.length).toBeGreaterThan(20);
    expect(state.viewer).toEqual({ memberId: null, isAdmin: false });

    const stored = await Board.findOne({ slug });
    expect(stored.adminTokenHash).not.toBe(state.adminToken); // only a hash is stored
    const got = await request(app).get(`/api/boards/${slug}`).expect(200);
    expect(JSON.stringify(got.body)).not.toMatch(/adminTokenHash|tokenHash/);
    expect(got.body.adminToken).toBeUndefined();
  });

  it('returns 404 for unknown or malformed slugs', async () => {
    const a = await request(app).get('/api/boards/doesnotexist').expect(404);
    expect(a.body.error.code).toBe('BOARD_NOT_FOUND');
    await request(app).get('/api/boards/%24where').expect(404);
  });

  it('recognises the viewer from saved keys', async () => {
    const { slug, adminToken } = await makeBoard();
    const m = await join(slug, 'Asha');
    const res = await request(app).get(`/api/boards/${slug}`).set('X-Member-Token', m.token).set('X-Admin-Token', adminToken).expect(200);
    expect(res.body.viewer).toEqual({ memberId: m.id, isAdmin: true });
    const stale = await request(app).get(`/api/boards/${slug}`).set('X-Member-Token', 'nope').expect(200);
    expect(stale.body.viewer.memberId).toBeNull();
  });

  it('lets only the organiser delete a board, which removes its members and options', async () => {
    const { slug, adminToken, slots } = await makeBoard();
    const m = await join(slug, 'Asha');
    await request(app).post(`/api/boards/${slug}/options`).set('X-Member-Token', m.token).send({ start: slots[0], durationMinutes: 30 }).expect(201);

    await request(app).delete(`/api/boards/${slug}`).expect(401);
    await request(app).delete(`/api/boards/${slug}`).set('X-Admin-Token', m.token).expect(403);
    await request(app).delete(`/api/boards/${slug}`).set('X-Admin-Token', adminToken).expect(204);
    await request(app).get(`/api/boards/${slug}`).expect(404);
    expect(await Member.countDocuments()).toBe(0);
    expect(await Option.countDocuments()).toBe(0);
  });
});

describe('members and availability', () => {
  it('joins, rejects duplicate names case-insensitively, and enforces the member limit', async () => {
    const { slug } = await makeBoard();
    await join(slug, 'Asha');
    const dup = await request(app).post(`/api/boards/${slug}/members`).send({ name: ' asha ', timezone: 'Asia/Kolkata' }).expect(409);
    expect(dup.body.error.code).toBe('NAME_TAKEN');
    await request(app).post(`/api/boards/${slug}/members`).send({ name: '', timezone: 'Asia/Kolkata' }).expect(400);
    await request(app).post(`/api/boards/${slug}/members`).send({ name: 'Bob', timezone: 'Nowhere/Land' }).expect(400);

    for (let i = 0; i < 24; i++) await join(slug, `Member ${i}`);
    const full = await request(app).post(`/api/boards/${slug}/members`).send({ name: 'One too many', timezone: 'UTC' }).expect(409);
    expect(full.body.error.code).toBe('BOARD_FULL');
  });

  it('saves availability as a sorted, de-duplicated set and shows it to everyone', async () => {
    const { slug, slots } = await makeBoard();
    const m = await join(slug, 'Asha');
    const res = await setAvail(slug, m, [slots[3], slots[1], slots[1]]).expect(200);
    expect(res.body.availability).toEqual([slots[1], slots[3]]);

    const state = await request(app).get(`/api/boards/${slug}`).expect(200);
    expect(state.body.members[0].availability).toEqual([slots[1], slots[3]]);

    await setAvail(slug, m, []).expect(200); // clearing is allowed
  });

  it('rejects slots outside the board, malformed slots, and other people\'s edits', async () => {
    const { slug, slots } = await makeBoard();
    const asha = await join(slug, 'Asha');
    const ben = await join(slug, 'Ben');

    const outside = await setAvail(slug, asha, ['2030-01-01T00:00:00Z']).expect(400);
    expect(outside.body.error.details[0].field).toBe('slots');
    await setAvail(slug, asha, ['tomorrow-ish']).expect(400);
    await request(app).put(`/api/boards/${slug}/members/${asha.id}/availability`).send({ slots: [slots[0]] }).expect(401);
    await request(app).put(`/api/boards/${slug}/members/${asha.id}/availability`).set('X-Member-Token', ben.token).send({ slots: [slots[0]] }).expect(403);
    await request(app).put(`/api/boards/${slug}/members/not-an-id/availability`).set('X-Member-Token', asha.token).send({ slots: [] }).expect(400);
    await request(app).put(`/api/boards/${slug}/members/${new mongoose.Types.ObjectId()}/availability`).set('X-Member-Token', asha.token).send({ slots: [] }).expect(404);
  });

  it('lets people leave and the organiser remove anyone; votes are cleaned up', async () => {
    const { slug, adminToken, slots } = await makeBoard();
    const asha = await join(slug, 'Asha');
    const ben = await join(slug, 'Ben');
    const opt = await request(app).post(`/api/boards/${slug}/options`).set('X-Member-Token', asha.token).send({ start: slots[0], durationMinutes: 30 }).expect(201);
    await request(app).put(`/api/boards/${slug}/options/${opt.body.option.id}/vote`).set('X-Member-Token', ben.token).send({ vote: true }).expect(200);

    await request(app).delete(`/api/boards/${slug}/members/${ben.id}`).set('X-Member-Token', asha.token).expect(403);
    await request(app).delete(`/api/boards/${slug}/members/${ben.id}`).set('X-Member-Token', ben.token).expect(204);
    const state = await request(app).get(`/api/boards/${slug}`).expect(200);
    expect(state.body.options[0].votes).toEqual([asha.id]);
    await request(app).delete(`/api/boards/${slug}/members/${asha.id}`).set('X-Admin-Token', adminToken).expect(204);
  });
});

describe('suggestions', () => {
  it('ranks times by how many people can attend and names who cannot', async () => {
    const { slug, slots } = await makeBoard();
    const a = await join(slug, 'Asha');
    const b = await join(slug, 'Ben');
    const c = await join(slug, 'Carla');
    const day1 = slots.slice(0, 8); // 09:00-13:00 on day one
    await setAvail(slug, a, day1.slice(0, 6)).expect(200); // 09:00-12:00
    await setAvail(slug, b, day1.slice(2, 6)).expect(200); // 10:00-12:00
    await setAvail(slug, c, day1.slice(2, 4)).expect(200); // 10:00-11:00

    const res = await request(app).get(`/api/boards/${slug}/suggestions?duration=60&limit=3`).expect(200);
    expect(res.body.totalMembers).toBe(3);
    const best = res.body.suggestions[0];
    expect(best.start).toBe(day1[2]);
    expect(best.count).toBe(3);
    expect(best.unavailable).toEqual([]);
    expect(best.available.every((m) => m.timezone === 'Europe/London')).toBe(true); // lets the UI show local times without a second lookup
    expect(res.body.suggestions.map((s) => s.count)).toEqual([...res.body.suggestions.map((s) => s.count)].sort((x, y) => y - x));
    // 10:30-11:30 also has two people but overlaps the best slot, so the runner-up is 11:00-12:00 (Carla cannot).
    const second = res.body.suggestions[1];
    expect(second.start).toBe(day1[4]);
    expect(second.count).toBe(2);
    expect(second.unavailable.map((m) => m.name)).toEqual(['Carla']);
  });

  it('is empty when nobody has marked anything, and validates the duration', async () => {
    const { slug } = await makeBoard();
    await join(slug, 'Asha');
    const res = await request(app).get(`/api/boards/${slug}/suggestions`).expect(200);
    expect(res.body.suggestions).toEqual([]);
    await request(app).get(`/api/boards/${slug}/suggestions?duration=45`).expect(400);
    await request(app).get(`/api/boards/${slug}/suggestions?duration=10`).expect(400);
    await request(app).get(`/api/boards/${slug}/suggestions?limit=500`).expect(400);
    await request(app).get(`/api/boards/${slug}/suggestions?duration=abc`).expect(400);
  });
});

describe('poll', () => {
  it('proposes a time (auto-voting), shows conflicts, toggles votes, and removes options', async () => {
    const { slug, slots } = await makeBoard();
    const asha = await join(slug, 'Asha');
    const ben = await join(slug, 'Ben');
    await setAvail(slug, asha, slots.slice(0, 4)).expect(200);

    const created = await request(app).post(`/api/boards/${slug}/options`).set('X-Member-Token', asha.token).send({ start: slots[0], durationMinutes: 60 }).expect(201);
    const optId = created.body.option.id;

    let state = await request(app).get(`/api/boards/${slug}`).expect(200);
    const opt = state.body.options[0];
    expect(opt.votes).toEqual([asha.id]);
    expect(opt.availableIds).toEqual([asha.id]);
    expect(opt.unavailableIds).toEqual([ben.id]); // conflict is visible before anyone commits

    await request(app).put(`/api/boards/${slug}/options/${optId}/vote`).set('X-Member-Token', ben.token).send({ vote: true }).expect(200);
    await request(app).put(`/api/boards/${slug}/options/${optId}/vote`).set('X-Member-Token', ben.token).send({ vote: true }).expect(200); // idempotent
    state = await request(app).get(`/api/boards/${slug}`);
    expect(state.body.options[0].votes.sort()).toEqual([asha.id, ben.id].sort());
    await request(app).put(`/api/boards/${slug}/options/${optId}/vote`).set('X-Member-Token', ben.token).send({ vote: false }).expect(200);
    state = await request(app).get(`/api/boards/${slug}`);
    expect(state.body.options[0].votes).toEqual([asha.id]);

    await request(app).delete(`/api/boards/${slug}/options/${optId}`).set('X-Member-Token', ben.token).expect(403);
    await request(app).delete(`/api/boards/${slug}/options/${optId}`).expect(401);
    await request(app).delete(`/api/boards/${slug}/options/${optId}`).set('X-Member-Token', asha.token).expect(204);
    await request(app).delete(`/api/boards/${slug}/options/${optId}`).set('X-Member-Token', asha.token).expect(404);
  });

  it('validates proposed times and blocks duplicates and strangers', async () => {
    const { slug, slots } = await makeBoard();
    const asha = await join(slug, 'Asha');
    const post = (body, token = asha.token) => request(app).post(`/api/boards/${slug}/options`).set('X-Member-Token', token).send(body);

    await post({ start: slots[0], durationMinutes: 45 }).expect(400); // not a multiple of the slot
    await post({ start: '2026-01-01T00:00:00Z', durationMinutes: 30 }).expect(400); // not on the board
    await post({ start: slots[7], durationMinutes: 60 }).expect(400); // runs past the end of the day
    await post({ start: slots[0], durationMinutes: 600 }).expect(400); // too long
    await post({ start: slots[0] }).expect(400);
    await post({ start: slots[0], durationMinutes: 30 }, 'bogus').expect(401);
    await request(app).post(`/api/boards/${slug}/options`).send({ start: slots[0], durationMinutes: 30 }).expect(401);

    await post({ start: slots[0], durationMinutes: 30 }).expect(201);
    const dup = await post({ start: slots[0], durationMinutes: 30 }).expect(409);
    expect(dup.body.error.code).toBe('DUPLICATE_OPTION');
  });

  it('limits the number of options', async () => {
    const { slug, slots } = await makeBoard({ days: 2, dayStartHour: 0, dayEndHour: 24 });
    const asha = await join(slug, 'Asha');
    for (let i = 0; i < 20; i++) {
      await request(app).post(`/api/boards/${slug}/options`).set('X-Member-Token', asha.token).send({ start: slots[i], durationMinutes: 30 }).expect(201);
    }
    const res = await request(app).post(`/api/boards/${slug}/options`).set('X-Member-Token', asha.token).send({ start: slots[20], durationMinutes: 30 }).expect(409);
    expect(res.body.error.code).toBe('TOO_MANY_OPTIONS');
  });

  it('lets the organiser finalise and reopen; polling is locked while finalised', async () => {
    const { slug, adminToken, slots } = await makeBoard();
    const asha = await join(slug, 'Asha');
    const created = await request(app).post(`/api/boards/${slug}/options`).set('X-Member-Token', asha.token).send({ start: slots[0], durationMinutes: 30 }).expect(201);
    const optionId = created.body.option.id;

    await request(app).post(`/api/boards/${slug}/meeting`).send({ optionId }).expect(401);
    await request(app).post(`/api/boards/${slug}/meeting`).set('X-Admin-Token', asha.token).send({ optionId }).expect(403);
    await request(app).post(`/api/boards/${slug}/meeting`).set('X-Admin-Token', adminToken).send({ optionId: 'xyz' }).expect(400);
    await request(app).post(`/api/boards/${slug}/meeting`).set('X-Admin-Token', adminToken).send({ optionId: String(new mongoose.Types.ObjectId()) }).expect(404);
    await request(app).post(`/api/boards/${slug}/meeting`).set('X-Admin-Token', adminToken).send({ optionId }).expect(200);

    const state = await request(app).get(`/api/boards/${slug}`).expect(200);
    expect(state.body.board.meeting).toMatchObject({ start: slots[0], durationMinutes: 30, optionId });

    const locked = await request(app).put(`/api/boards/${slug}/options/${optionId}/vote`).set('X-Member-Token', asha.token).send({ vote: false }).expect(409);
    expect(locked.body.error.code).toBe('MEETING_FINALIZED');
    await request(app).post(`/api/boards/${slug}/options`).set('X-Member-Token', asha.token).send({ start: slots[1], durationMinutes: 30 }).expect(409);

    await request(app).delete(`/api/boards/${slug}/meeting`).set('X-Admin-Token', adminToken).expect(204);
    const reopened = await request(app).get(`/api/boards/${slug}`);
    expect(reopened.body.board.meeting).toBeNull();
    await request(app).put(`/api/boards/${slug}/options/${optionId}/vote`).set('X-Member-Token', asha.token).send({ vote: false }).expect(200);
  });
});

describe('abuse resistance', () => {
  it('does not treat query operators in the body or headers as database operators', async () => {
    const { slug } = await makeBoard();
    await request(app).post(`/api/boards/${slug}/members`).send({ name: { $ne: null }, timezone: 'UTC' }).expect(400);
    const res = await request(app).get(`/api/boards/${slug}`).set('X-Member-Token', '{"$ne":null}').expect(200);
    expect(res.body.viewer.memberId).toBeNull();
  });

  it('rate limits board creation when enabled', async () => {
    const limited = createApp({ rateLimitEnabled: true });
    let last;
    for (let i = 0; i < 31; i++) last = await request(limited).post('/api/boards').send(boardInput());
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('RATE_LIMITED');
  });
});
