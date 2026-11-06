import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api.js';
import { fmtTime, formatWhen, tzAbbr } from '../lib/time.js';

const durationLabel = (d) => (d < 60 ? `${d} min` : d === 60 ? '1 hour' : `${d / 60} hours`);

export default function BestTimes({ slug, board, members, options, version, viewTz, me, locked, onAddToPoll }) {
  const step = board.slotMinutes;
  const durations = [30, 60, 90, 120, 180, 240].filter((d) => d % step === 0);
  const [duration, setDuration] = useState(60);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .suggestions(slug, { duration, limit: 6 })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(errorText(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, duration, version]);

  const byId = new Map(members.map((m) => [m.id, m]));
  const inPoll = (s) => options.some((o) => o.start === s.start && o.durationMinutes === s.durationMinutes);

  async function add(s) {
    setBusy(s.start);
    setNotice(null);
    try {
      await onAddToPoll(s.start, s.durationMinutes);
      setNotice({ type: 'success', text: 'Added to the poll. Open the Poll tab to vote.' });
    } catch (err) {
      setNotice({ type: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Best times">
      <div className="toolbar">
        <h2>Best times to meet</h2>
        <div className="field inline-field">
          <label htmlFor="duration">Meeting length</label>
          <select id="duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {durations.map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}
          </select>
        </div>
      </div>
      <p className="muted small">
        Ranked by the most people free for the whole meeting, then by fewer people meeting between 10 PM and 7 AM their time, then by the earliest time.
      </p>

      {error && <p className="banner error" role="alert">{error}</p>}
      {notice && <p className={`banner ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      {loading && !data && <p className="muted center">Finding the best times…</p>}

      {data && members.length === 0 && (
        <div className="card empty"><h3>No one has joined yet</h3><p>Share the link, join the board, and mark when you are free.</p></div>
      )}
      {data && members.length > 0 && data.suggestions.length === 0 && (
        <div className="card empty">
          <h3>No overlapping time yet</h3>
          <p>Nobody is free for a full {duration}-minute stretch. Try a shorter meeting, or ask people to add more availability.</p>
        </div>
      )}

      {data && (
        <ol className="suggestions">
          {data.suggestions.map((s, i) => {
            const when = formatWhen(s.start, s.durationMinutes, viewTz);
            const orgWhen = board.timezone !== viewTz ? formatWhen(s.start, s.durationMinutes, board.timezone) : null;
            const added = inPoll(s);
            const everyone = s.count === s.total;
            return (
              <li key={s.start} className={`card suggestion${i === 0 ? ' top' : ''}`}>
                <div className="sug-head">
                  <span className="rank" aria-label={`Rank ${i + 1}`}>{i + 1}</span>
                  <div>
                    <h3>{when.day}</h3>
                    <p className="when">{when.time} <span className="muted">({when.tz})</span></p>
                    {orgWhen && <p className="muted small">Board time: {orgWhen.text} ({orgWhen.tz})</p>}
                  </div>
                  <p className={everyone ? 'score all' : 'score'}>
                    <strong>{s.count}</strong> of {s.total} free{everyone ? ' ✓' : ''}
                  </p>
                </div>

                <p className="chips">
                  {s.available.map((m) => <span className="chip ok" key={m.id}>✓ {m.name}</span>)}
                  {s.unavailable.map((m) => <span className="chip no" key={m.id} title="Not free for this whole time">✕ {m.name}</span>)}
                </p>
                {s.unavailable.length > 0 && <p className="warn small">⚠ Not free: {s.unavailable.map((m) => m.name).join(', ')}</p>}

                <details className="locals">
                  <summary>Local time for each person{s.offHours.length ? ` (${s.offHours.length} at an awkward hour)` : ''}</summary>
                  <ul className="plain-list">
                    {s.available.map((a) => {
                      // The response carries each attendee's zone; the local member list may lag a poll behind.
                      const tz = a.timezone || byId.get(a.id)?.timezone || viewTz;
                      const late = s.offHours.some((o) => o.id === a.id);
                      return (
                        <li key={a.id}>
                          <strong>{a.name}</strong>: {fmtTime(s.start, tz)} – {fmtTime(s.end, tz)} {tzAbbr(s.start, tz)}
                          {late && <span className="late"> 🌙 late night / early morning</span>}
                        </li>
                      );
                    })}
                  </ul>
                </details>

                <div className="sug-actions">
                  <button className="btn small primary" disabled={!me || locked || added || busy === s.start} onClick={() => add(s)}>
                    {added ? 'In the poll ✓' : busy === s.start ? 'Adding…' : 'Add to poll'}
                  </button>
                  {!me && <span className="muted small">Join the board to add this to the poll.</span>}
                  {locked && <span className="muted small">The meeting is finalised.</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
