import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const POLL_MS = 15_000;

/**
 * Loads a board and keeps it fresh so teammates see each other's changes without reloading.
 * `version` only changes when the data actually changed, so effects can depend on it cheaply.
 */
export function useBoard(slug, auth) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [version, setVersion] = useState(0);
  // Which keys the current data was fetched with, so callers only judge a key against data fetched using it.
  const [fetchedWith, setFetchedWith] = useState(null);
  const last = useRef('');
  const authRef = useRef(auth);
  const stateRef = useRef(null);
  authRef.current = auth;

  const load = useCallback(
    async (silent = false) => {
      try {
        const used = authRef.current || {};
        const data = await api.getBoard(slug, used);
        setFetchedWith((prev) =>
          prev && prev.memberToken === used.memberToken && prev.adminToken === used.adminToken
            ? prev
            : { memberToken: used.memberToken, adminToken: used.adminToken },
        );
        const key = JSON.stringify(data);
        if (key !== last.current) {
          last.current = key;
          stateRef.current = data;
          setState(data);
          setVersion((v) => v + 1);
        }
        setError(null);
        setOffline(false);
      } catch (e) {
        if (silent && stateRef.current) setOffline(true);
        else setError(e);
      } finally {
        setLoading(false);
      }
    },
    [slug],
  );

  useEffect(() => {
    last.current = '';
    stateRef.current = null;
    setState(null);
    setLoading(true);
    setError(null);
    load();
    const tick = () => !document.hidden && load(true);
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [slug, load]);

  const reload = useCallback(() => load(false), [load]);
  return { state, error, loading, offline, version, reload, fetchedWith };
}
