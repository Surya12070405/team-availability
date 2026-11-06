import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { buildGrid, fmtDay, formatWhen } from '../lib/time.js';
import { errorText } from '../lib/api.js';

/**
 * The shared grid. Everyone sees how many people are free in each slot (darker = more people),
 * in their own time zone. "Edit my availability" turns each cell into a toggle: click, drag or tap.
 */
export default function AvailabilityGrid({ board, members, me, viewTz, onSave, editSignal }) {
  const grid = useMemo(() => buildGrid(board.slots, viewTz), [board.slots, viewTz]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => new Set());
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const paint = useRef(null);
  const ignoreClick = useRef(false);
  const handledSignal = useRef(0);

  const saved = useMemo(() => new Set(me?.availability || []), [me]);
  const dirty = editing && (draft.size !== saved.size || [...draft].some((s) => !saved.has(s)));

  const startEdit = () => {
    setDraft(new Set(saved));
    setMessage(null);
    setSelected(null);
    setEditing(true);
  };

  // After joining, jump straight into editing.
  useEffect(() => {
    if (editSignal && editSignal !== handledSignal.current && me) {
      handledSignal.current = editSignal;
      startEdit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSignal, me?.id]);

  // Stop painting when the pointer is released anywhere; warn before leaving with unsaved changes.
  useEffect(() => {
    const up = () => {
      paint.current = null;
      setTimeout(() => { ignoreClick.current = false; }, 0);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Who is free in each slot (using the live draft for the current user while editing).
  const { counts, total } = useMemo(() => {
    const map = new Map();
    for (const m of members) {
      const avail = editing && me && m.id === me.id ? draft : null;
      const list = avail ? [...avail] : m.availability;
      for (const iso of list) {
        if (!map.has(iso)) map.set(iso, []);
        map.get(iso).push(m);
      }
    }
    return { counts: map, total: members.length };
  }, [members, editing, draft, me]);

  const apply = (iso, value) =>
    setDraft((prev) => {
      if (prev.has(iso) === value) return prev;
      const next = new Set(prev);
      if (value) next.add(iso); else next.delete(iso);
      return next;
    });

  const toggleGroup = (isos) =>
    setDraft((prev) => {
      const next = new Set(prev);
      const all = isos.every((s) => next.has(s));
      for (const s of isos) { if (all) next.delete(s); else next.add(s); }
      return next;
    });

  const onPointerDown = (e, iso) => {
    if (!editing || e.pointerType === 'touch' || e.button !== 0) return;
    e.preventDefault();
    const value = !draft.has(iso);
    paint.current = value;
    ignoreClick.current = true;
    apply(iso, value);
  };
  const onPointerEnter = (e, iso) => {
    if (editing && paint.current !== null && (e.buttons & 1)) apply(iso, paint.current);
  };
  const onClick = (iso) => {
    if (editing) {
      if (ignoreClick.current) { ignoreClick.current = false; return; }
      apply(iso, !draft.has(iso));
    } else {
      setSelected((s) => (s === iso ? null : iso));
    }
  };

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await onSave([...draft].sort());
      setEditing(false);
      setMessage({ type: 'success', text: 'Availability saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  const detail = selected && !editing ? { iso: selected, free: counts.get(selected) || [] } : null;
  const detailWhen = detail ? formatWhen(detail.iso, board.slotMinutes, viewTz) : null;
  const freeIds = detail ? new Set(detail.free.map((m) => m.id)) : null;

  return (
    <section aria-label="Availability grid">
      <div className="toolbar">
        <h2>Who is free when</h2>
        {!editing && me && <button className="btn primary inline" onClick={startEdit}>✏️ Edit my availability</button>}
        {!editing && !me && <p className="muted small">Join the board to add your availability.</p>}
      </div>

      {editing ? (
        <div className="edit-bar" role="region" aria-label="Editing your availability">
          <p>
            Click, drag or tap the slots when <strong>you</strong> are free. Use a day or time heading to select a whole column or row.
            {dirty && <span className="dirty"> Unsaved changes</span>}
          </p>
          <div className="edit-actions">
            <button className="btn small secondary" onClick={() => setDraft(new Set(board.slots))}>Select all</button>
            <button className="btn small secondary" onClick={() => setDraft(new Set())}>Clear all</button>
            <button className="btn small secondary" onClick={() => { setEditing(false); setMessage(null); }} disabled={saving}>Cancel</button>
            <button className="btn small primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save availability'}</button>
          </div>
        </div>
      ) : (
        <p className="muted small">Darker cells mean more people are free. Select a cell to see who.</p>
      )}
      {message && <p className={`banner ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      <div className="grid-wrap" tabIndex={0} aria-label="Scrollable availability grid">
        <div className="grid" style={{ gridTemplateColumns: `72px repeat(${grid.dates.length}, minmax(58px, 1fr))` }}>
          <div className="gh corner" />
          {grid.dates.map((d) => (
            <div className="gh" key={d}>
              {editing ? <button className="hbtn" onClick={() => toggleGroup(grid.byDate.get(d))} aria-label={`Toggle all of ${fmtDay(d)}`}>{fmtDay(d)}</button> : fmtDay(d)}
            </div>
          ))}
          {grid.rows.map((r) => (
            <Fragment key={r.time}>
              <div className="gt">
                {editing ? <button className="hbtn" onClick={() => toggleGroup(grid.byTime.get(r.time))} aria-label={`Toggle all ${r.label} slots`}>{r.label}</button> : r.label}
              </div>
              {grid.dates.map((d) => {
                const iso = grid.cell.get(`${d}|${r.time}`);
                if (!iso) return <div className="cell none" key={`${d}|${r.time}`} aria-hidden="true" />;
                const free = counts.get(iso) || [];
                const n = free.length;
                const mine = editing ? draft.has(iso) : !!me && saved.has(iso);
                const p = total ? n / total : 0;
                const label = `${fmtDay(d)} ${r.label}: ${n} of ${total} free${mine ? ', including you' : ''}`;
                return (
                  <button
                    key={iso}
                    className={['cell', n ? 'has' : '', p >= 0.55 ? 'strong' : '', mine ? 'mine' : '', selected === iso && !editing ? 'sel' : ''].join(' ')}
                    style={{ '--p': n ? Math.max(0.14, p) : 0 }}
                    aria-label={label}
                    aria-pressed={editing ? mine : selected === iso}
                    onPointerDown={(e) => onPointerDown(e, iso)}
                    onPointerEnter={(e) => onPointerEnter(e, iso)}
                    onClick={() => onClick(iso)}
                  >
                    <span className="count">{n || ''}</span>
                    {mine && <span className="tick" aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="legend" aria-hidden="true">
        <span>Nobody</span><span className="ramp" /><span>Everyone</span>
        <span className="legend-mine"><span className="tick">✓</span> you are free</span>
      </div>

      {detail && (
        <div className="card detail" role="status">
          <h3>{detailWhen.day}, {detailWhen.time} <span className="muted">({detailWhen.tz})</span></h3>
          <p><strong>{detail.free.length} of {total}</strong> free</p>
          {detail.free.length > 0 && <p className="chips"><span className="chip ok">Free:</span>{detail.free.map((m) => <span className="chip ok" key={m.id}>✓ {m.name}</span>)}</p>}
          {members.length - detail.free.length > 0 && (
            <p className="chips"><span className="chip no">Not free:</span>{members.filter((m) => !freeIds.has(m.id)).map((m) => <span className="chip no" key={m.id}>✕ {m.name}</span>)}</p>
          )}
        </div>
      )}
    </section>
  );
}
