// All times travel as UTC ISO strings. These helpers turn them into what a person in a given
// time zone sees, and build the day-by-time grid for that viewer.

export const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const partsFormatters = new Map();

/** Local calendar date (YYYY-MM-DD) and clock time (HH:mm) of an instant in a time zone. */
export function localParts(iso, tz) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    partsFormatters.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(iso))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const fmtTime = (when, tz) => new Date(when).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz });

export const fmtDay = (dateStr) =>
  new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export const fmtDayLong = (dateStr) =>
  new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export function tzAbbr(when, tz) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(when)).find((p) => p.type === 'timeZoneName')?.value || tz;
  } catch {
    return tz;
  }
}

/** "Tuesday 10 November", "10:00 AM – 11:00 AM", "GMT+5:30" for a meeting window, as seen in `tz`. */
export function formatWhen(startIso, durationMinutes, tz) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const sd = localParts(start, tz).date;
  const ed = localParts(end, tz).date;
  const day = fmtDayLong(sd);
  const time = sd === ed ? `${fmtTime(start, tz)} – ${fmtTime(end, tz)}` : `${fmtTime(start, tz)} – ${fmtDay(ed)} ${fmtTime(end, tz)}`;
  return { day, time, tz: tzAbbr(start, tz), text: `${day}, ${time}` };
}

/**
 * Lays the board's slots out as columns (viewer's local dates) and rows (viewer's local clock times).
 * Slots from a board in another zone may land on half-hour rows or split across midnight; rows and
 * columns are derived from the data so any zone combination works. Missing combinations stay empty.
 */
export function buildGrid(slots, tz) {
  const cell = new Map();
  const dateSet = new Set();
  const rowSample = new Map();
  const byDate = new Map();
  const byTime = new Map();
  for (const iso of slots) {
    const { date, time } = localParts(iso, tz);
    dateSet.add(date);
    if (!rowSample.has(time)) rowSample.set(time, iso);
    cell.set(`${date}|${time}`, iso);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(iso);
    if (!byTime.has(time)) byTime.set(time, []);
    byTime.get(time).push(iso);
  }
  const dates = [...dateSet].sort();
  const times = [...rowSample.keys()].sort();
  return { dates, rows: times.map((t) => ({ time: t, label: fmtTime(rowSample.get(t), tz) })), cell, byDate, byTime };
}

let zoneList;
/** All IANA zones the browser knows, with a "GMT+5:30" style label. Computed once. */
export function timezoneOptions(extra = []) {
  if (!zoneList) {
    let names = [];
    try {
      names = Intl.supportedValuesOf('timeZone');
    } catch {
      names = ['UTC', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York', 'America/Chicago', 'America/Los_Angeles'];
    }
    if (!names.includes('UTC')) names = ['UTC', ...names];
    const now = new Date();
    zoneList = names.map((name) => {
      let off = '';
      try {
        off = new Intl.DateTimeFormat('en-US', { timeZone: name, timeZoneName: 'shortOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || '';
      } catch {
        /* label without offset */
      }
      return { name, label: `${name.replace(/_/g, ' ')}${off ? ` (${off})` : ''}` };
    });
  }
  const known = new Set(zoneList.map((z) => z.name));
  const added = extra.filter((n) => n && !known.has(n)).map((name) => ({ name, label: name }));
  return [...added, ...zoneList];
}

// ---- calendar file ----
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

export function downloadIcs({ title, start, durationMinutes, slug }) {
  const end = new Date(new Date(start).getTime() + durationMinutes * 60_000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TeamAvailability Board//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${slug}-${icsDate(start)}@teamavailability`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(title)}`, 'END:VEVENT', 'END:VCALENDAR',
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}-meeting.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
