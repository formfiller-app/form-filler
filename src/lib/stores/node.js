// A vault store in a folder of its own: for the tests and the command line now, and the model for the Mac app's (its
// vault/ folder in the app's data folder). One file per name, written whole to a hidden file beside it and renamed
// into place, so a stop mid-write leaves the old file whole; the copy before is kept as "<name>.prev" unless the put
// says not to. The calls are the same as every store's (stores/memory.js says what they do). clear() removes every
// file the vault could have written there (its names, their kept copies, its half-written files); a file or folder
// whose name the vault could not have written is left where it is.
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, open, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/, TEMP = /^\.[0-9a-f]{16}\.tmp$/;

export function nodeStore(folder) {
  const base = resolve(folder);
  const at = name => {
    if (typeof name !== 'string' || !name || name.split('/').some(part => !PART.test(part))) throw new Error('Not a name in the vault: ' + JSON.stringify(name));
    return join(base, ...name.split('/'));
  };
  const temp = path => join(dirname(path), '.' + randomBytes(8).toString('hex') + '.tmp');
  const writeWhole = async (path, bytes) => {
    const scratch = temp(path), handle = await open(scratch, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); await handle.close(); await rename(scratch, path); }
    catch (error) { await handle.close().catch(() => {}); await rm(scratch, { force: true }); throw error; }
  };
  // Every file under the folder: [path inside the folder, kind] for the vault's names, their kept copies and its own
  // half-written files; anything else in the folder is not the vault's and is left out.
  const walk = async (at = '') => {
    const found = [];
    let entries;
    try { entries = await readdir(join(base, ...at.split('/').filter(Boolean)), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return found; throw error; }
    for (const entry of entries) {
      const name = at ? at + '/' + entry.name : entry.name;
      if (entry.isDirectory() && PART.test(entry.name)) found.push(...await walk(name), [name, 'folder']);
      else if (entry.isFile() && TEMP.test(entry.name)) found.push([name, 'temp']);
      else if (entry.isFile() && PART.test(entry.name)) found.push([name, name.endsWith('.prev') ? 'kept' : 'file']);
    }
    return found;
  };
  return {
    async get(name) {
      try { return new Uint8Array(await readFile(at(name))); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async put(name, bytes, { prev = true } = {}) {
      const path = at(name);
      await mkdir(dirname(path), { recursive: true });
      if (prev) {
        const kept = temp(path);
        try { await copyFile(path, kept); await rename(kept, path + '.prev'); }
        catch (error) { await rm(kept, { force: true }); if (error.code !== 'ENOENT') throw error; }
      }
      await writeWhole(path, bytes);
      if (!prev) await rm(path + '.prev', { force: true });
    },
    async remove(name) {
      const path = at(name);
      await rm(path, { force: true });
      await rm(path + '.prev', { force: true });
    },
    async list(prefix = '') { return (await walk()).filter(([name, kind]) => kind === 'file' && name.startsWith(prefix)).map(([name]) => name).sort(); },
    async clear() {
      for (const [name, kind] of await walk()) {
        const path = join(base, ...name.split('/'));
        if (kind === 'folder') await rmdir(path).catch(() => { /* not empty: something that is not the vault's is in it */ });
        else await rm(path, { force: true });
      }
    },
  };
}
