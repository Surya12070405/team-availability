// These tests need no database: validation, routing and error handling all run before any query.
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp({ rateLimitEnabled: false });
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const valid = (over = {}) => ({
  title: 'Study group', timezone: 'Asia/Kolkata', startDate: tomorrow(), days: 5, dayStartHour: 9, dayEndHour: 17, slotMinutes: 60, ...over,
});

describe('create board validation', () => {
  it.each([
    ['empty title', { title: '   ' }, 'title'],
    ['title too long', { title: 'x'.repeat(81) }, 'title'],
    ['title with markup characters', { title: '<script>' }, 'title'],
    ['unknown timezone', { timezone: 'Mars/Olympus' }, 'timezone'],
    ['bad date format', { startDate: '04/11/2026' }, 'startDate'],
    ['impossible date', { startDate: '2026-02-31' }, 'startDate'],
    ['date in the past', { startDate: '2020-01-01' }, 'startDate'],
    ['date too far ahead', { startDate: '2999-01-01' }, 'startDate'],
    ['zero days', { days: 0 }, 'days'],
    ['too many days', { days: 15 }, 'days'],
    ['fractional days', { days: 2.5 }, 'days'],
    ['days as text', { days: 'five' }, 'days'],
    ['negative start hour', { dayStartHour: -1 }, 'dayStartHour'],
    ['end hour not after start', { dayStartHour: 10, dayEndHour: 10 }, 'dayEndHour'],
    ['end hour past 24', { dayEndHour: 25 }, 'dayEndHour'],
    ['slot length of 45', { slotMinutes: 45 }, 'slotMinutes'],
  ])('rejects %s', async (_n, over, field) => {
    const res = await request(app).post('/api/boards').send(valid(over)).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d) => d.field.startsWith(field))).toBe(true);
  });

  it('lists every missing field', async () => {
    const res = await request(app).post('/api/boards').send({}).expect(400);
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'timezone', 'startDate', 'days', 'dayStartHour', 'dayEndHour', 'slotMinutes']));
  });

  it('rejects unknown fields (blocks operator injection)', async () => {
    await request(app).post('/api/boards').send(valid({ $where: '1' })).expect(400);
    await request(app).post('/api/boards').send(valid({ slug: 'mine' })).expect(400);
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const bad = await request(app).post('/api/boards').set('Content-Type', 'application/json').send('{oops').expect(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    const big = await request(app).post('/api/boards').send(valid({ title: 'x'.repeat(60_000) })).expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('routing and errors', () => {
  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('reports database unavailability on /api/health when not connected', async () => {
    const res = await request(app).get('/api/health').expect(503);
    expect(res.body.status).toBe('database_unavailable');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
