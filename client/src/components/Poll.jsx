import { useMemo, useState } from 'react';
import { api, errorText } from '../lib/api.js';
import { buildGrid, fmtDay, fmtTime, formatWhen } from '../lib/time.js';

export default function Poll({ slug, board, members, options, me, isAdmin, auth, viewTz, reload }) {
  const locked = !!board.meeting;
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const grid = useMemo(() => buildGrid(board.slots, viewTz), [board.slots, viewTz]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(board.slotMinutes);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const curDate = grid.dates.includes(date) ? date : grid.dates[0];
  const timesForDate = grid.rows.filter((r) => grid.cell.has(`${curDate}|${r.time}`));
  const curTime = timesForDate.some((r) => r.time === time) ? time : timesForDate[0]?.time;
  const durations = [30, 60, 90, 120, 180, 240].filter((d) => d % board.slotMinutes === 0);

  const sorted = [...options].sort((a, b) => b.votes.length - a.votes.length || a.start.localeCompare(b.start));
  const act = async (key, fn, okText) => {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      await reload();
      if (okText) setMessage({ type: 'success', text: okText });
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const propose = (e) => {
    e.preventDefault();
    const iso = grid.cell.get(`${curDate}|${curTime}`);
    if (!iso) return;
    act('propose', () => api.addOption(slug, { start: iso, durationMinutes: duration }, auth), 'Time added to the poll.');
  };

  const names = (ids) => ids.map((id) => byId.get(id)?.name).filter(Boolean);

  return (
    <section aria-label="Meeting poll">
      <h2>Meeting poll</h2>
      <p className="muted small">Propose times, then vote for the ones you can attend. Each option shows who is marked as unavailable, so you can spot conflicts before anyone commits.</p>

      {message && <p className={`banner ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      {!locked && (
        <form className="card form propose" onSubmit={propose}>
          <h3>Propose a time</h3>
          {!me ? <p className="muted">Join the board to propose times and vote.</p> : (
            <>
              <div className="row3">
                <div className="field">
                  <label htmlFor="p-date">Day</label>
                  <select id="p-date" value={curDate} onChange={(e) => setDate(e.target.value)}>
                    {grid.dates.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="p-time">Start</label>
                  <select id="p-time" value={curTime} onChange={(e) => setTime(e.target.value)}>
                    {timesForDate.map((r) => <option key={r.time} value={r.time}>{r.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="p-dur">Length</label>
                  <select id="p-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                    {durations.map((d) => <option key={d} value={d}>{d} min</option>)}
                  </select>
                </div>
              </div>
              <button className="btn secondary inline" type="submit" disabled={busy === 'propose' || !curTime}>{busy === 'propose' ? 'Adding…' : 'Add to poll'}</button>
              <p className="hint">Tip: the Best times tab can add the top suggestions for you.</p>
            </>
          )}
        </form>
      )}

      {sorted.length === 0 ? (
        <div className="card empty"><h3>No options yet</h3><p>Add a time above, or use the Best times tab.</p></div>
      ) : (
        <ul className="list">
          {sorted.map((o) => {
            const when = formatWhen(o.start, o.durationMinutes, viewTz);
            const voted = !!me && o.votes.includes(me.id);
            const pct = members.length ? Math.round((o.votes.length / members.length) * 100) : 0;
            const unavailable = names(o.unavailableIds);
            const offHours = names(o.offHoursIds);
            const isFinal = board.meeting?.optionId === o.id;
            const canRemove = !locked && (isAdmin || (me && o.proposedBy === me.id));
            const voterNames = names(o.votes);
            return (
              <li key={o.id} className={`card option${isFinal ? ' final' : ''}`}>
                <div className="sug-head">
                  <div>
                    <h3>{when.day}</h3>
                    <p className="when">{when.time} <span className="muted">({when.tz})</span></p>
                  </div>
                  {isFinal && <span className="badge">✓ Confirmed</span>}
                </div>

                <div className="bar" role="img" aria-label={`${o.votes.length} of ${members.length} people voted for this time`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p className="small"><strong>{o.votes.length}</strong> of {members.length} voted{voterNames.length ? `: ${voterNames.join(', ')}` : ''}</p>

                {unavailable.length === 0 ? (
                  <p className="ok-note small">✓ Everyone is marked free for this time.</p>
                ) : (
                  <p className="warn small">⚠ Marked not free: {unavailable.join(', ')}</p>
                )}
                {offHours.length > 0 && <p className="muted small">🌙 Late night / early morning for: {offHours.join(', ')}</p>}

                <div className="sug-actions">
                  {me && (
                    <button className={`btn small ${voted ? 'secondary' : 'primary'}`} disabled={locked || busy === o.id}
                      aria-pressed={voted} onClick={() => act(o.id, () => api.vote(slug, o.id, !voted, auth))}>
                      {voted ? 'Withdraw my vote' : 'I can make this'}
                    </button>
                  )}
                  {isAdmin && !locked && (confirm === o.id ? (
                    <>
                      <button className="btn small primary" onClick={() => act(o.id, () => api.finalize(slug, o.id, auth), 'Meeting confirmed.')}>Confirm: lock in this time</button>
                      <button className="btn small secondary" onClick={() => setConfirm(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn small secondary" onClick={() => setConfirm(o.id)}>Finalise</button>
                  ))}
                  {canRemove && <button className="btn small secondary" onClick={() => act(o.id, () => api.removeOption(slug, o.id, auth))} aria-label={`Remove option ${when.text}`}>Remove</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!isAdmin && !locked && sorted.length > 0 && <p className="muted small">Only the organiser can finalise the meeting.</p>}
      <p className="sr-only">{members.length} members, times shown in {viewTz}, first slot {fmtTime(board.slots[0], viewTz)}</p>
    </section>
  );
}
