// Where the page is running: on the web, or inside the Mac app (src-tauri), which hands the page its own API as
// window.__TAURI__. On the web nothing here does anything: `shell` is false, and none of the app's code is loaded.
// In the app, what the page keeps goes into the app's data folder instead of the browser's storage:
//
//   vault/                 your details, your signature and the locker (src/lib/vault.js), through vaultStore()
//   templates/<sha>.json   each form's remembered blanks, through pageStore()
//   settings.json          the page's few settings, where the archive is, and where the backups go
//
// so that a backup carries all of it (src/lib/backup.js takes vault/, templates/ and settings.json from that folder).
const api = globalThis.__TAURI__;
export const shell = Boolean(api?.core?.invoke && api?.fs?.readDir && api?.dialog?.open);
// The dialogs are read each time they are used, not kept: the checks that run inside the app put their own in.
export const tauri = shell ? { fs: api.fs, invoke: (command, args) => api.core.invoke(command, args), get dialog() { return api.dialog; } } : null;

const encoder = new TextEncoder(), decoder = new TextDecoder();
const HASH = /^[0-9a-f]{64}$/;
let whereabouts = null;
// { data, home, archive }: the app's data folder, your home folder, and the archive's usual place in it. Asked of the
// app once; an answer that fails is not kept, so the next thing that needs it asks again.
export const places = () => whereabouts ??= import('./files-tauri.js').then(({ call }) => call(() => tauri.invoke('places'))).catch(error => { whereabouts = null; throw error; });
const storeAt = async folder => { const [where, { tauriStore }] = await Promise.all([places(), import('./store-tauri.js')]); return tauriStore(tauri, where.data + folder); };

// The vault's store in the app's data folder. It is made when it is first used: only the app can say where that
// folder is, and every call of a store waits anyway.
export function vaultStore() {
  let ready = null;
  const made = () => ready ??= storeAt('/vault').catch(error => { ready = null; throw error; });
  const through = name => async (...args) => (await made())[name](...args);
  return { get: through('get'), put: through('put'), remove: through('remove'), list: through('list'), clear: through('clear') };
}

// What the page keeps besides your details, with the three calls the page's own store has (get, set, drop), answered
// at once from memory and written to the data folder behind them: a form's blanks as templates/<sha256>.json, and
// anything else under "page" in settings.json. Until `ready` has resolved a get gives its fallback. `settings()` and
// `change()` are for the rest of settings.json (where the archive is, where the backups go); fields this version does
// not know are kept as they are. A write that fails is told to `onProblem`.
export function pageStore({ onProblem = () => {} } = {}) {
  const templates = new Map();
  let settings = {}, stores = null, writing = Promise.resolve();
  const later = work => { writing = writing.then(() => ready).then(work).catch(error => onProblem(error.message || String(error))); return writing; };
  const writeSettings = () => later(() => stores.top.put('settings.json', encoder.encode(JSON.stringify(settings, null, 2) + '\n')));
  // What the data folder holds now, read into memory. A settings file that cannot be read counts as none, and the
  // next change replaces it (the store keeps the old one as settings.json.prev); a template that cannot be read is
  // as if its form had not been seen.
  const read = async () => {
    const kept = await stores.top.get('settings.json');
    let found = {};
    try { const parsed = kept ? JSON.parse(decoder.decode(kept)) : {}; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) found = parsed; } catch { found = {}; }
    settings = found;
    templates.clear();
    for (const name of await stores.templates.list()) {
      const hash = name.replace(/\.json$/, '');
      if (!HASH.test(hash) || !name.endsWith('.json')) continue;
      try { templates.set(hash, JSON.parse(decoder.decode(await stores.templates.get(name)))); } catch { /* not remembered */ }
    }
  };
  const ready = (async () => { stores = { top: await storeAt(''), templates: await storeAt('/templates') }; await read(); })();
  ready.catch(error => onProblem(error.message || String(error)));
  const hashOf = key => key.startsWith('template:') && HASH.test(key.slice(9)) ? key.slice(9) : null;
  return {
    ready,
    get(key, fallback) {
      const hash = hashOf(key);
      if (hash) return templates.has(hash) ? templates.get(hash) : fallback;
      const page = settings.page;
      return page && typeof page === 'object' && key in page ? page[key] : fallback;
    },
    set(key, value) {
      const hash = hashOf(key);
      if (hash) { templates.set(hash, value); later(() => stores.templates.put(hash + '.json', encoder.encode(JSON.stringify(value, null, 1) + '\n'), { prev: false })); }
      else { settings = { ...settings, page: { ...(settings.page && typeof settings.page === 'object' ? settings.page : {}), [key]: value } }; writeSettings(); }
      return true;
    },
    // A remembered form dropped is forgotten for now; its file is written over when the form is remembered again.
    drop(key) {
      const hash = hashOf(key);
      if (hash) templates.delete(hash);
      else if (settings.page && typeof settings.page === 'object' && key in settings.page) { const { [key]: gone, ...page } = settings.page; settings = { ...settings, page }; writeSettings(); }
    },
    settings: () => settings,
    change(patch) { settings = { ...settings, ...patch }; return writeSettings(); },
    // Everything asked for so far has been written (or has failed, and been told).
    settled: () => writing,
    // Read again from the data folder, once what was asked for has been written: after a restore has put a
    // settings file or remembered forms there, so that what is in memory is what is on the disk.
    reload: () => { writing = writing.then(() => ready).then(read); return writing; },
  };
}
