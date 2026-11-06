import { DateTime, IANAZone } from 'luxon';

export const isValidTimezone = (tz) => typeof tz === 'string' && tz.length > 0 && tz.length <= 64 && IANAZone.isValidZone(tz);

/** Canonical UTC ISO string for an instant, e.g. 2026-11-04T03:30:00Z (no milliseconds). */
export const toIso = (ms) => DateTime.fromMillis(ms, { zone: 'utc' }).toISO({ suppressMilliseconds: true });

/**
 * All bookable slot start times of a board, as sorted UTC ISO strings.
 * Days and hours are interpreted in the board's own timezone, so DST changes are handled:
 * a "9:00-17:00" day is always 9-5 local time even if the UTC offset changes mid-range.
 */
export function generateSlots({ startDate, days, dayStartHour, dayEndHour, slotMinutes, timezone }) {
  const out = new Set();
  const first = DateTime.fromISO(startDate, { zone: timezone });
  for (let d = 0; d < days; d++) {
    const day = first.plus({ days: d });
    for (let m = dayStartHour * 60; m < dayEndHour * 60; m += slotMinutes) {
      const dt = day.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 });
      out.add(toIso(dt.toMillis()));
    }
  }
  return [...out].sort();
}
