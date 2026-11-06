// Browser storage can be unavailable (private mode, blocked cookies), so every access is guarded
// and the app still works without it, you just have to rejoin after a reload.
const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

export const getIdentity = (slug) => read(`ta:member:${slug}`, null);
export const setIdentity = (slug, v) => write(`ta:member:${slug}`, v);
export const getAdminKey = (slug) => read(`ta:admin:${slug}`, null);
export const setAdminKey = (slug, v) => write(`ta:admin:${slug}`, v);
export const getViewTz = () => read('ta:viewTz', null);
export const setViewTz = (tz) => write('ta:viewTz', tz);

export const getRecent = () => read('ta:recent', []);
export function addRecent({ slug, title }) {
  const list = getRecent().filter((b) => b.slug !== slug);
  write('ta:recent', [{ slug, title, at: Date.now() }, ...list].slice(0, 12));
}
export function removeRecent(slug) {
  write('ta:recent', getRecent().filter((b) => b.slug !== slug));
}
