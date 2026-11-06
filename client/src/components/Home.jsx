import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorText } from '../lib/api.js';
import { addRecent, getRecent, getViewTz, removeRecent, setAdminKey } from '../lib/storage.js';
import { browserTz } from '../lib/time.js';
import TimezoneSelect from './TimezoneSelect.jsx';

const localToday = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const hourLabel = (h) => `${String(h % 24).padStart(2, '0')}:00`;

function validate(f) {
  const e = {};
  if (!f.title.trim()) e.title = 'Give the board a name, e.g. "Project sync"';
  else if (f.title.trim().length > 80) e.title = 'Name can be at most 80 characters';
  if (!f.startDate) e.startDate = 'Choose the first day';
  if (f.dayEndHour <= f.dayStartHour) e.dayEndHour = 'The day must end after it starts';
  return e;
}

export default function Home() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '', timezone: getViewTz() || browserTz(), startDate: localToday(), days: 7, dayStartHour: 8, dayEndHour: 20, slotMinutes: 60,
  });
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(null);
  const [recent, setRecent] = useState(getRecent());

  const set = (k) => (v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function create(e) {
    e.preventDefault();
    setBanner(null);
    const errs = validate(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    try {
      const res = await api.createBoard({ ...form, title: form.title.trim() });
      setAdminKey(res.board.slug, res.adminToken);
      addRecent({ slug: res.board.slug, title: res.board.title });
      navigate(`/b/${res.board.slug}`);
    } catch (err) {
      if (err.details?.length) {
        const fe = {};
        for (const d of err.details) fe[d.field.split('.')[0]] = d.message;
        setErrors(fe);
      }
      setBanner(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function openByCode(e) {
    e.preventDefault();
    const match = code.trim().toLowerCase().match(/([a-z0-9-]{3,32})\/?(?:[?#].*)?$/);
    if (!match) {
      setCodeError('Paste a board link or its code');
      return;
    }
    navigate(`/b/${match[1]}`);
  }

  return (
    <>
      <section className="hero">
        <h1>Find a time that works for the most people.</h1>
        <p>
          Everyone marks when they are free on a shared grid. The board shows overlaps in each person's own time zone
          and suggests the slots with the most people available.
        </p>
      </section>

      <div className="home-grid">
        <form className="card form" onSubmit={create} noValidate>
          <h2>Create a board</h2>

          <div className="field">
            <label htmlFor="title">Board name</label>
            <input id="title" type="text" maxLength={80} placeholder="e.g. Thesis group, Weekly sync" value={form.title}
              onChange={(e) => set('title')(e.target.value)} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'title-err' : undefined} />
            {errors.title && <p className="error-text" id="title-err">{errors.title}</p>}
          </div>

          <div className="field">
            <TimezoneSelect id="tz" label="Your time zone (the board's days and hours use this)" value={form.timezone} onChange={set('timezone')} />
            {errors.timezone && <p className="error-text">{errors.timezone}</p>}
          </div>

          <div className="row2">
            <div className="field">
              <label htmlFor="startDate">First day</label>
              <input id="startDate" type="date" min={localToday()} value={form.startDate} onChange={(e) => set('startDate')(e.target.value)} aria-invalid={!!errors.startDate} />
              {errors.startDate && <p className="error-text">{errors.startDate}</p>}
            </div>
            <div className="field">
              <label htmlFor="days">Number of days</label>
              <select id="days" value={form.days} onChange={(e) => set('days')(Number(e.target.value))}>
                {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? 'day' : 'days'}</option>
                ))}
              </select>
              {errors.days && <p className="error-text">{errors.days}</p>}
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label htmlFor="start">Day starts</label>
              <select id="start" value={form.dayStartHour} onChange={(e) => set('dayStartHour')(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => h).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="end">Day ends</label>
              <select id="end" value={form.dayEndHour} onChange={(e) => set('dayEndHour')(Number(e.target.value))} aria-invalid={!!errors.dayEndHour}>
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{hourLabel(h)}{h === 24 ? ' (midnight)' : ''}</option>)}
              </select>
              {errors.dayEndHour && <p className="error-text">{errors.dayEndHour}</p>}
            </div>
          </div>
          <p className="hint">
            Tip: for a team spread across time zones, choose a wide window (for example 06:00 to 22:00) so everyone's working hours fit.
          </p>

          <fieldset className="field">
            <legend>Slot length</legend>
            <div className="seg-group" role="radiogroup" aria-label="Slot length">
              {[30, 60].map((m) => (
                <label key={m} className={form.slotMinutes === m ? 'seg on' : 'seg'}>
                  <input type="radio" name="slot" checked={form.slotMinutes === m} onChange={() => set('slotMinutes')(m)} />
                  {m} minutes
                </label>
              ))}
            </div>
          </fieldset>

          {banner && <p className="banner error" role="alert">{banner}</p>}
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create board'}</button>
        </form>

        <div className="side">
          <form className="card form" onSubmit={openByCode} noValidate>
            <h2>Open a board</h2>
            <div className="field">
              <label htmlFor="code">Board link or code</label>
              <input id="code" type="text" placeholder="e.g. k7m2xq9a" value={code} onChange={(e) => { setCode(e.target.value); setCodeError(null); }} aria-invalid={!!codeError} />
              {codeError && <p className="error-text">{codeError}</p>}
            </div>
            <button className="btn secondary" type="submit">Open</button>
          </form>

          {recent.length > 0 && (
            <section className="card" aria-label="Your recent boards">
              <h2>Your boards</h2>
              <ul className="plain-list">
                {recent.map((b) => (
                  <li key={b.slug} className="recent">
                    <Link to={`/b/${b.slug}`}>{b.title}</Link>
                    <button className="btn small secondary" aria-label={`Forget ${b.title}`} onClick={() => { removeRecent(b.slug); setRecent(getRecent()); }}>✕</button>
                  </li>
                ))}
              </ul>
              <p className="hint">Stored in this browser only.</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
