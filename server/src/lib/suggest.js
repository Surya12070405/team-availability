/**
 * Meeting-time suggestion engine (pure functions, no database).
 *
 * A "window" is `k = duration / slotMinutes` consecutive slots. A member counts as available for a
 * window only if they marked EVERY slot in it. Windows are ranked by:
 *   1. most available members            (the headline requirement)
 *   2. fewest available members who would meet at an awkward local hour (22:00-07:00)
 *   3. earliest start
 * and the top results are returned without overlapping each other, so the list offers genuinely
 * different options rather than the same hour shifted by 30 minutes.
 */
import { DateTime } from 'luxon';
import { toIso } from './slots.js';

const MINUTE = 60_000;
const AWKWARD_FROM = 22; // 22:00
const AWKWARD_UNTIL = 7; // 07:00

const awkwardCache = new Map();
function awkwardAt(ms, tz) {
  const key = `${tz}|${ms}`;
  let v = awkwardCache.get(key);
  if (v === undefined) {
    const h = DateTime.fromMillis(ms, { zone: tz }).hour;
    v = h < AWKWARD_UNTIL || h >= AWKWARD_FROM;
    if (awkwardCache.size > 50_000) awkwardCache.clear();
    awkwardCache.set(key, v);
  }
  return v;
}

/** True if any part of the window falls between 22:00 and 07:00 in the given timezone. */
export function windowIsAwkward(startMs, durationMinutes, tz) {
  for (let t = startMs; t < startMs + durationMinutes * MINUTE; t += 30 * MINUTE) {
    if (awkwardAt(t, tz)) return true;
  }
  return false;
}

/** Pre-computes lookups so many windows can be evaluated cheaply. */
export function prepare({ slots, slotMinutes, members }) {
  const n = slots.length;
  const step = slotMinutes * MINUTE;
  const slotMs = slots.map((s) => Date.parse(s));
  const indexByIso = new Map(slots.map((s, i) => [s, i]));

  // runLen[i] = how many consecutive slots (spaced exactly one step apart) start at i
  const runLen = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    runLen[i] = i < n - 1 && slotMs[i + 1] - slotMs[i] === step ? runLen[i + 1] + 1 : 1;
  }

  // prefix[m][i] = number of slots among the first i that member m marked available
  const prefixes = members.map((m) => {
    const set = new Set(m.availability || []);
    const p = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + (set.has(slots[i]) ? 1 : 0);
    return p;
  });

  return { slots, slotMinutes, step, slotMs, indexByIso, runLen, prefixes, members };
}

/** Index of the window starting at `startIso`, or null if it is not a valid window on this board. */
export function locateWindow(prep, startIso, durationMinutes) {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes % prep.slotMinutes !== 0) return null;
  const idx = prep.indexByIso.get(startIso);
  if (idx === undefined) return null;
  const k = durationMinutes / prep.slotMinutes;
  return prep.runLen[idx] >= k ? { idx, k } : null;
}

function describe(prep, idx, k) {
  const available = [];
  const unavailable = [];
  const offHours = [];
  const startMs = prep.slotMs[idx];
  const duration = k * prep.slotMinutes;
  prep.members.forEach((m, mi) => {
    const p = prep.prefixes[mi];
    if (p[idx + k] - p[idx] === k) {
      available.push({ id: m.id, name: m.name, timezone: m.timezone });
      if (windowIsAwkward(startMs, duration, m.timezone)) offHours.push({ id: m.id, name: m.name });
    } else {
      unavailable.push({ id: m.id, name: m.name });
    }
  });
  return {
    start: toIso(startMs),
    end: toIso(startMs + k * prep.step),
    durationMinutes: duration,
    count: available.length,
    total: prep.members.length,
    available,
    unavailable,
    offHours,
  };
}

/** Availability of one specific window (used to show conflicts on poll options). */
export function availabilityForWindow(prep, startIso, durationMinutes) {
  const w = locateWindow(prep, startIso, durationMinutes);
  return w ? describe(prep, w.idx, w.k) : null;
}

/**
 * Best windows of the requested length, most available people first.
 * Windows nobody can attend are never suggested.
 */
export function suggestWindows({ slots, slotMinutes, members, durationMinutes, limit = 5 }) {
  if (!members.length || !slots.length) return [];
  if (durationMinutes % slotMinutes !== 0) throw new RangeError('duration must be a multiple of the slot length');
  const prep = prepare({ slots, slotMinutes, members });
  const k = durationMinutes / slotMinutes;

  const candidates = [];
  for (let i = 0; i < slots.length; i++) {
    if (prep.runLen[i] < k) continue;
    const w = describe(prep, i, k);
    if (w.count > 0) candidates.push({ ...w, _start: prep.slotMs[i], _end: prep.slotMs[i] + k * prep.step });
  }

  candidates.sort((a, b) => b.count - a.count || a.offHours.length - b.offHours.length || a._start - b._start);

  const chosen = [];
  for (const c of candidates) {
    if (chosen.every((x) => c._start >= x._end || c._end <= x._start)) chosen.push(c);
    if (chosen.length >= limit) break;
  }
  return chosen.map(({ _start, _end, ...rest }) => rest);
}
