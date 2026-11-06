import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorText } from '../lib/api.js';
import { useBoard } from '../lib/useBoard.js';
import {
  addRecent, getAdminKey, getIdentity, getViewTz, removeRecent, setAdminKey, setIdentity, setViewTz,
} from '../lib/storage.js';
import { browserTz, downloadIcs, formatWhen } from '../lib/time.js';
import TimezoneSelect from './TimezoneSelect.jsx';
import AvailabilityGrid from './AvailabilityGrid.jsx';
import BestTimes from './BestTimes.jsx';
import Poll from './Poll.jsx';

const TABS = [
  { id: 'grid', label: 'Availability', icon: '🗓️' },
  { id: 'best', label: 'Best times', icon: '⭐' },
  { id: 'poll', label: 'Poll', icon: '🗳️' },
];

/** An organiser link looks like /b/abc123#key=SECRET: store the key, then clean the address bar. */
function takeAdminKeyFromUrl(slug) {
  try {
    const m = window.location.hash.match(/[#&]key=([\w-]+)/);
    if (m) {
      setAdminKey(slug, m[1]);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return m[1];
    }
  } catch {
    /* ignore */
  }
  return getAdminKey(slug);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

export default function BoardPage({ slug }) {
  const navigate = useNavigate();
  const [identity, setIdentityState] = useState(() => getIdentity(slug));
  const [adminToken, setAdminToken] = useState(() => takeAdminKeyFromUrl(slug));
  const [viewTz, setViewTzState] = useState(() => getViewTz() || browserTz());
  const [tab, setTab] = useState('grid');
  const [editSignal, setEditSignal] = useState(0);
  const [copied, setCopied] = useState(null);
  const [joinName, setJoinName] = useState('');
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adminMsg, setAdminMsg] = useState(null);

  const auth = useMemo(() => ({ memberToken: identity?.token, adminToken: adminToken || undefined }), [identity, adminToken]);
  const { state, error, loading, offline, version, reload, fetchedWith } = useBoard(slug, auth);

  const board = state?.board;
  const members = state?.members || [];
  const options = state?.options || [];
  const me = members.find((m) => m.id === state?.viewer.memberId) || null;
  const isAdmin = !!state?.viewer.isAdmin;

  // Remember boards you open; drop saved keys the server no longer accepts.
  useEffect(() => { if (board) addRecent({ slug, title: board.title }); }, [board?.title, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  // A key is only judged against data that was fetched WITH that key (right after joining, the data
  // on screen predates the new key and would wrongly make it look invalid).
  useEffect(() => {
    if (!state || !fetchedWith) return;
    if (identity && fetchedWith.memberToken === identity.token && state.viewer.memberId !== identity.memberId) {
      setIdentity(slug, null);
      setIdentityState(null);
    }
    if (adminToken && fetchedWith.adminToken === adminToken && !state.viewer.isAdmin) {
      setAdminKey(slug, null);
      setAdminToken(null);
    }
  }, [state, fetchedWith, identity, adminToken, slug]);

  const changeTz = (tz) => { setViewTzState(tz); setViewTz(tz); };
  const share = async (kind) => {
    const url = `${window.location.origin}/b/${slug}${kind === 'admin' ? `#key=${adminToken}` : ''}`;
    if (await copy(url)) { setCopied(kind); setTimeout(() => setCopied(null), 2000); }
  };

  async function join(e) {
    e.preventDefault();
    setJoinError(null);
    const name = joinName.trim();
    if (!name) { setJoinError('Enter your name so teammates can see who is who'); return; }
    setJoining(true);
    try {
      const res = await api.join(slug, { name, timezone: viewTz });
      const id = { memberId: res.member.id, token: res.token, name };
      setIdentity(slug, id);
      setIdentityState(id);
      setTab('grid');
      setEditSignal(Date.now());
    } catch (err) {
      setJoinError(errorText(err));
    } finally {
      setJoining(false);
    }
  }

  // After a key is saved, refetch so the server can confirm who we are.
  useEffect(() => { if (identity) reload(); }, [identity?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAvailability = async (slots) => {
    await api.saveAvailability(slug, me.id, slots, auth);
    await reload();
  };
  const addToPoll = async (start, durationMinutes) => {
    await api.addOption(slug, { start, durationMinutes }, auth);
    await reload();
  };

  async function removeMember(m) {
    setAdminMsg(null);
    try {
      await api.removeMember(slug, m.id, auth);
      if (me && m.id === me.id) { setIdentity(slug, null); setIdentityState(null); }
      await reload();
    } catch (err) { setAdminMsg(errorText(err)); }
  }

  async function deleteBoard() {
    try {
      await api.deleteBoard(slug, auth);
      setAdminKey(slug, null);
      setIdentity(slug, null);
      removeRecent(slug);
      navigate('/');
    } catch (err) { setAdminMsg(errorText(err)); setConfirmDelete(false); }
  }

  if (loading && !state) return <p className="muted center">Loading board…</p>;
  if (error && !state) {
    return (
      <div className="card empty">
        <h2>{error.status === 404 ? 'Board not found' : 'Could not load the board'}</h2>
        <p>{error.status === 404 ? 'Check the link, or ask the organiser to share it again.' : error.message}</p>
        <div className="actions center-actions">
          {error.status !== 404 && <button className="btn secondary" onClick={reload}>Try again</button>}
          <Link className="btn primary inline" to="/">Back to home</Link>
        </div>
      </div>
    );
  }
  if (!board) return null;

  const meeting = board.meeting;
  const meetingWhen = meeting ? formatWhen(meeting.start, meeting.durationMinutes, viewTz) : null;
  const attendees = meeting ? options.find((o) => o.id === meeting.optionId) : null;
  const full = members.length >= state.limits.maxMembers;

  return (
    <div className="board">
      <div className="board-head">
        <div>
          <h1>{board.title}</h1>
          <p className="muted small">
            {members.length} {members.length === 1 ? 'person' : 'people'} · board time zone {board.timezone}
            {isAdmin && <span className="badge small-badge">Organiser</span>}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn small secondary" onClick={() => share('link')}>{copied === 'link' ? '✓ Link copied' : '🔗 Copy invite link'}</button>
        </div>
      </div>

      {offline && <p className="banner warn" role="status">You appear to be offline. Showing the last data we received.</p>}

      <div className="tzbar">
        <TimezoneSelect id="view-tz" label="Show times in" value={viewTz} onChange={changeTz} />
      </div>

      {meeting && (
        <div className="card final-banner" role="status">
          <h2>✅ Meeting confirmed</h2>
          <p className="big">{meetingWhen.day}, {meetingWhen.time} <span className="muted">({meetingWhen.tz})</span></p>
          {attendees && attendees.unavailableIds.length > 0 && (
            <p className="warn small">⚠ Marked not free at this time: {attendees.unavailableIds.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean).join(', ')}</p>
          )}
          <div className="actions">
            <button className="btn small primary" onClick={() => downloadIcs({ title: board.title, start: meeting.start, durationMinutes: meeting.durationMinutes, slug })}>📅 Add to calendar (.ics)</button>
            {isAdmin && <button className="btn small secondary" onClick={async () => { try { await api.reopen(slug, auth); await reload(); } catch (err) { setAdminMsg(errorText(err)); } }}>Reopen poll</button>}
          </div>
        </div>
      )}

      {!me && (
        <form className="card form join" onSubmit={join} noValidate>
          <h2>Join this board</h2>
          {full ? (
            <p className="muted">This board is full ({state.limits.maxMembers} people).</p>
          ) : (
            <>
              <p className="muted small">Add your name to mark when you are free. Your time zone ({viewTz}) is taken from the selector above.</p>
              <div className="field">
                <label htmlFor="join-name">Your name</label>
                <input id="join-name" type="text" maxLength={40} autoComplete="given-name" value={joinName} onChange={(e) => { setJoinName(e.target.value); setJoinError(null); }} aria-invalid={!!joinError} />
                {joinError && <p className="error-text" role="alert">{joinError}</p>}
              </div>
              <button className="btn primary" type="submit" disabled={joining}>{joining ? 'Joining…' : 'Join and add my availability'}</button>
            </>
          )}
        </form>
      )}

      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="panel" className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            <span aria-hidden="true" className="tab-icon">{t.icon}</span>
            <span>{t.label}{t.id === 'poll' && options.length ? ` (${options.length})` : ''}</span>
          </button>
        ))}
      </nav>

      <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'grid' && (
          <>
            <AvailabilityGrid board={board} members={members} me={me} viewTz={viewTz} onSave={saveAvailability} editSignal={editSignal} />
            <section className="card" aria-label="People">
              <h3>People ({members.length})</h3>
              {members.length === 0 ? <p className="muted">Nobody has joined yet.</p> : (
                <ul className="people">
                  {members.map((m) => (
                    <li key={m.id}>
                      <span><strong>{m.name}</strong>{me && m.id === me.id ? ' (you)' : ''} <span className="muted small">· {m.timezone.replace(/_/g, ' ')}</span></span>
                      <span className="muted small">{m.availability.length ? `${m.availability.length} slot${m.availability.length === 1 ? '' : 's'}` : 'no availability yet'}</span>
                      {(isAdmin || (me && m.id === me.id)) && (
                        <button className="btn small secondary" onClick={() => removeMember(m)} aria-label={me && m.id === me.id ? 'Leave this board' : `Remove ${m.name}`}>{me && m.id === me.id ? 'Leave' : 'Remove'}</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {adminMsg && <p className="banner error" role="alert">{adminMsg}</p>}
            </section>
          </>
        )}
        {tab === 'best' && (
          <BestTimes slug={slug} board={board} members={members} options={options} version={version} viewTz={viewTz} me={me} locked={!!meeting} onAddToPoll={addToPoll} />
        )}
        {tab === 'poll' && (
          <Poll slug={slug} board={board} members={members} options={options} me={me} isAdmin={isAdmin} auth={auth} viewTz={viewTz} reload={reload} />
        )}
      </div>

      {isAdmin && (
        <details className="card admin">
          <summary>Organiser tools</summary>
          <p className="muted small">Open this board on another device as the organiser with the link below. Keep it private: anyone with it can finalise the meeting or delete the board.</p>
          <div className="actions">
            <button className="btn small secondary" onClick={() => share('admin')}>{copied === 'admin' ? '✓ Organiser link copied' : '🔑 Copy organiser link'}</button>
            {confirmDelete ? (
              <>
                <button className="btn small danger" onClick={deleteBoard}>Yes, delete this board for everyone</button>
                <button className="btn small secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn small secondary" onClick={() => setConfirmDelete(true)}>Delete board</button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
