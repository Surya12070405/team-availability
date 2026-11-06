import { describe, expect, it } from 'vitest';
import { generateSlots, isValidTimezone, toIso } from '../src/lib/slots.js';
import { locateWindow, prepare } from '../src/lib/suggest.js';

const base = { startDate: '2026-11-09', days: 2, dayStartHour: 9, dayEndHour: 12, slotMinutes: 30, timezone: 'Europe/London' };

describe('generateSlots', () => {
  it('creates the right number of sorted, unique UTC slots', () => {
    const s = generateSlots(base);
    expect(s).toHaveLength(2 * 3 * 2);
    expect(s).toEqual([...s].sort());
    expect(new Set(s).size).toBe(s.length);
    expect(s[0]).toBe('2026-11-09T09:00:00Z'); // London is UTC in November
    expect(s.every((x) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(x))).toBe(true);
  });

  it('interprets hours in the board timezone (India is UTC+5:30)', () => {
    const s = generateSlots({ ...base, timezone: 'Asia/Kolkata', days: 1, slotMinutes: 60 });
    expect(s).toEqual(['2026-11-09T03:30:00Z', '2026-11-09T04:30:00Z', '2026-11-09T05:30:00Z']);
  });

  it('keeps local working hours across a daylight-saving change', () => {
    // US clocks go forward on 2027-03-14: 9:00 local is 14:00Z before and 13:00Z after.
    const s = generateSlots({ startDate: '2027-03-13', days: 2, dayStartHour: 9, dayEndHour: 10, slotMinutes: 60, timezone: 'America/New_York' });
    expect(s).toEqual(['2027-03-13T14:00:00Z', '2027-03-14T13:00:00Z']);
  });

  it('supports a full 24-hour day', () => {
    expect(generateSlots({ ...base, days: 1, dayStartHour: 0, dayEndHour: 24, slotMinutes: 60 })).toHaveLength(24);
  });

  it('formats instants without milliseconds', () => {
    expect(toIso(Date.UTC(2026, 10, 4, 3, 30))).toBe('2026-11-04T03:30:00Z');
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(42)).toBe(false);
  });
});

describe('locateWindow', () => {
  const slots = generateSlots(base);
  const prep = prepare({ slots, slotMinutes: 30, members: [] });

  it('accepts a window of consecutive slots', () => {
    expect(locateWindow(prep, '2026-11-09T09:00:00Z', 90)).toEqual({ idx: 0, k: 3 });
  });
  it('rejects windows that run past the end of a day', () => {
    expect(locateWindow(prep, '2026-11-09T11:00:00Z', 90)).toBeNull();
  });
  it('rejects unknown starts and durations that are not a multiple of the slot', () => {
    expect(locateWindow(prep, '2026-11-09T09:15:00Z', 30)).toBeNull();
    expect(locateWindow(prep, '2026-11-09T09:00:00Z', 45)).toBeNull();
    expect(locateWindow(prep, '2026-11-09T09:00:00Z', 0)).toBeNull();
  });
});
