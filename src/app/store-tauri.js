// A store in a folder of the Mac app's data folder, over Tauri's file plugin and the app's own commands (see
// files-tauri.js): the vault's (vault/), and the same calls keep the remembered forms (templates/) and the settings.
// It does what src/lib/stores/node.js does. One file per name, written whole to a hidden file beside it, written
// through to the disk, and renamed into place, so a stop mid-write leaves the old file whole; the copy before is kept
// as "<name>.prev" unless the put says not to. clear() removes every file the store could have written there (its
// names, their kept copies, its half-written files), and then the folder itself if nothing else is in it: a restore
// takes anything at a place for taken, an empty folder too, so a vault forgotten must leave none behind. A file or
// folder whose name the store could not have written is left where it is.
import { hex } from '../lib/hash.js';
import { call } from './files-tauri.js';

const PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/, TEMP = /^\.[0-9a-f]{16}\.tmp$/;

export function tauriStore({ fs, invoke }, folder) {
  const base = String(folder).replace(/\/+$/, '');
  if (!base.startsWith('/')) throw new Error('Not a folder on this computer: ' + JSON.stringify(folder));
  const at = name => {
    if (typeof name !== 'string' || !name || name.split('/').some(part => !PART.test(part))) throw new Error('Not a name in the vault: ' + JSON.stringify(name));
    return base + '/' + name;
  };
  const dirOf = path => path.slice(0, path.lastIndexOf('/'));
  const temp = path => dirOf(path) + '/.' + hex(globalThis.crypto.getRandomValues(new Uint8Array(8))) + '.tmp';
  const drop = path => call(() => fs.remove(path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const settled = async (scratch, path) => {
    try { await call(() => invoke('settle', { path: scratch })); await call(() => fs.rename(scratch, path)); }
    catch (error) { await drop(scratch).catch(() => {}); throw error; }
  };
  // Every file under the folder: [path inside the folder, kind] for the store's names, their kept copies and its own
  // half-written files; anything else in the folder is not the store's and is left out.
  const walk = async (inner = '') => {
    const found = [];
    let entries;
    try { entries = await call(() => fs.readDir(inner ? base + '/' + inner : base)); } catch (error) { if (error.code === 'ENOENT') return found; throw error; }
    for (const entry of entries) {
      const name = inner ? inner + '/' + entry.name : entry.name;
      if (entry.isSymlink) continue;
      if (entry.isDirectory && PART.test(entry.name)) found.push(...await walk(name), [name, 'folder']);
      else if (entry.isFile && TEMP.test(entry.name)) found.push([name, 'temp']);
      else if (entry.isFile && PART.test(entry.name)) found.push([name, name.endsWith('.prev') ? 'kept' : 'file']);
    }
    return found;
  };
  return {
    async get(name) {
      try { return new Uint8Array(await call(() => fs.readFile(at(name)))); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
    },
    async put(name, bytes, { prev = true } = {}) {
      const path = at(name);
      await call(() => fs.mkdir(dirOf(path), { recursive: true }));
      if (prev) {
        const kept = temp(path);
        try { await call(() => fs.copyFile(path, kept)); await settled(kept, path + '.prev'); }
        catch (error) { await drop(kept).catch(() => {}); if (error.code !== 'ENOENT') throw error; }
      }
      const scratch = temp(path);
      try { await call(() => fs.writeFile(scratch, bytes, { createNew: true })); }
      catch (error) { if (error.code !== 'EEXIST') await drop(scratch).catch(() => {}); throw error; }
      await settled(scratch, path);
      if (!prev) await drop(path + '.prev');
    },
    async list(prefix = '') { return (await walk()).filter(([name, kind]) => kind === 'file' && name.startsWith(prefix)).map(([name]) => name).sort(); },
    async clear() {
      for (const [name, kind] of await walk()) {
        // A folder goes only if it is empty: something that is not the store's may be in it.
        if (kind === 'folder') await call(() => fs.remove(base + '/' + name)).catch(() => {});
        else await drop(base + '/' + name);
      }
      const own = await call(() => fs.lstat(base)).catch(() => null);
      if (own?.isDirectory && !own.isSymlink) await call(() => fs.remove(base)).catch(() => {});
    },
  };
}
