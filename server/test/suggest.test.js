import { describe, expect, it } from 'vitest';
import { generateSlots } from '../src/lib/slots.js';
import { availabilityForWindow, prepare, suggestWindows, windowIsAwkward } from '../src/lib/suggest.js';

// Two London days, 09:00-13:00 in 30-minute slots (UTC in November).
const slots = generateSlots({ startDate: '2026-11-09', days: 2, dayStartHour: 9, dayEndHour: 13, slotMinutes: 30, timezone: 'Europe/London' });
const at = (day, hhmm) => `2026-11-${day}T${hhmm}:00Z`;
const range = (day, from, to) => slots.filter((s) => s >= at(day, from) && s < at(day, to));

const member = (id, availability, timezone = 'Europe/London') => ({ id, name: id.toUpperCase(), timezone, availability });

describe('suggestWindows', () => {
  it('ranks windows by the number of available members', () => {
    const members = [
      member('a', range('09', '09:00', '11:00')),
      member('b', range('09', '10:00', '12:00')),
      member('c', range('09', '10:00', '11:00')),
    ];
    const [best] = suggestWindows({ slots, slotMinutes: 30, members, durationMinutes: 60, limit: 3 });
    expect(best.start).toBe(at('09', '10:00'));
    expect(best.count).toBe(3);
    expect(best.total).toBe(3);
    expect(best.unavailable).toEqual([]);
  });

  it('only counts a member if they are free for the whole window', () => {
    const members = [member('a', range('09', '09:00', '10:00')), member('b', range('09', '09:00', '09:30'))];
    const out = suggestWindows({ slots, slotMinutes: 30, members, durationMinutes: 60 });
    expect(out).toHaveLength(1);
    expect(out[0].available.map((m) => m.id)).toEqual(['a']);
    expect(out[0].unavailable.map((m) => m.id)).toEqual(['b']);
  });

  it('never suggests a window that spans a gap between days', () => {
    const members = [member('a', [...range('09', '12:30', '13:00'), ...range('10', '09:00', '09:30')])];
    expect(suggestWindows({ slots, slotMinutes: 30, members, durationMinutes: 60 })).toEqual([]);
  });

  it('returns non-overlapping suggestions', () => {
    const members = [member('a', range('09', '09:00', '13:00'))];
    const out = suggestWindows({ slots, slotMinutes: 30, members, durationMinutes: 60, limit: 10 });
    expect(out).toHaveLength(4);
    const sorted = [...out].sort((x, y) => x.start.localeCompare(y.start));
    sorted.slice(1).forEach((w, i) => expect(w.start >= sorted[i].end).toBe(true));
  });

  it('breaks ties by the earliest time', () => {
    const members = [member('a', range('09', '09:00', '13:00'))];
    const [first] = suggestWindows({ slots, slotMinutes: 30, members, durationMinutes: 60 });
    expect(first.start).toBe(at('09', '09:00'));
  });

  it('prefers sociable hours when the headcount is equal', () => {
    // Same two attendees either way. 09:00Z is 04:00 for New York, 12:00Z is 07:00 for New York.
    const everyone = range('09', '09:00', '13:00');
    const members = [member('a', everyone), member('b', everyone, 'America/New_York')];
    const [best] = suggestWindows({ slots, slotMinutes: 30, members, durationMinutes: 60 });
    expect(best.count).toBe(2);
    expect(best.offHours).toEqual([]);
    expect(best.start >= at('09', '12:00')).toBe(true);
  });

  it('flags members who would meet at an awkward hour', () => {
    const members = [member('a', range('09', '09:00', '10:00'), 'America/New_York')];
    const [w] = suggestWindows({ slots, slotMinutes: 30, members, durationMinutes: 60 });
    expect(w.offHours.map((m) => m.id)).toEqual(['a']);
  });

  it('handles longer meetings and empty boards', () => {
    const members = [member('a', range('09', '09:00', '12:00'))];
    expect(suggestWindows({ slots, slotMinutes: 30, members, durationMinutes: 180 })[0].durationMinutes).toBe(180);
    expect(suggestWindows({ slots, slotMinutes: 30, members: [], durationMinutes: 60 })).toEqual([]);
    expect(suggestWindows({ slots, slotMinutes: 30, members, durationMinutes: 240 })).toEqual([]);
  });

  it('rejects durations that are not a multiple of the slot length', () => {
    expect(() => suggestWindows({ slots, slotMinutes: 30, members: [member('a', [])], durationMinutes: 45 })).toThrow(RangeError);
  });
});

describe('availabilityForWindow', () => {
  it('reports who is free for a specific proposed time', () => {
    const members = [member('a', range('09', '09:00', '10:00')), member('b', [])];
    const prep = prepare({ slots, slotMinutes: 30, members });
    const w = availabilityForWindow(prep, at('09', '09:00'), 60);
    expect(w.available.map((m) => m.id)).toEqual(['a']);
    expect(w.unavailable.map((m) => m.id)).toEqual(['b']);
    expect(availabilityForWindow(prep, at('09', '09:15'), 60)).toBeNull();
  });
});

describe('windowIsAwkward', () => {
  it('uses the viewer-local 22:00-07:00 range', () => {
    const t = Date.parse('2026-11-09T09:00:00Z');
    expect(windowIsAwkward(t, 60, 'Europe/London')).toBe(false);
    expect(windowIsAwkward(t, 60, 'America/New_York')).toBe(true); // 04:00
    expect(windowIsAwkward(Date.parse('2026-11-09T21:30:00Z'), 60, 'Europe/London')).toBe(true); // runs into 22:00
  });
});
