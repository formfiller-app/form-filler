// The archive's file interface in the Mac app: the same calls as src/lib/files/node.js, with the same promises, over
// Tauri's file plugin (`fs`, which the app gives the page as window.__TAURI__.fs) and the few commands the app adds
// to it (`invoke`; src-tauri/src/lib.rs). The archive and the backups are handed nothing else, so what this cannot do
// they cannot do: it reads, lists, makes a file or a folder that does not exist yet, and renames to a name not yet
// taken. It has no delete and no overwrite, with the same three exceptions, all Form Filler's own: the index cache,
// the lock, and a staging folder a backup or a restore made.
//
// What is different underneath, and why:
// - The plugin never writes a file through to the disk, and its rename replaces whatever has the new name. So a new
//   file is written under a hidden name, written through to the disk by the app's `settle`, and given its real name
//   by the app's `name_file`, which the system refuses if anything has that name. On a disk that cannot give a file a
//   second name (many USB drives), the real name is held with an empty file made in one step, and the hidden file
//   renamed onto it: as files/node.js does there.
// - Bytes go to the plugin whole, as the request's own body (writeFile with a Uint8Array), never through a file
//   handle, which would send them as a list of numbers: 2 GB took 1 second one way and 135 the other
//   (docs/SHELL_SPIKE.md). A file that comes as a stream is gathered into pieces of 8 MiB, each appended.
// - The plugin follows every link before it checks that a path is in a folder the page was granted, so a link that
//   leads out of them all is refused by the app itself. One that leads into another granted folder is refused here,
//   by asking the app for the folder's real path, as files/node.js asks the system.
// - A link is looked for just before a file is opened to be read, not in the same step as the opening.
//
// Every path is relative to the interface's folder and written with "/". A name that is taken fails with an error
// whose code is "EEXIST", by the disk's own idea of "the same name". The plugin reports an error as text; `fault`
// turns it into an Error with the system's code ("ENOENT", "EEXIST" …), or "EFORBIDDEN" for a path outside every
// granted folder.
//
// `links: false` behaves as a disk that cannot give a file a second name, for the tests.
import { sha256 as hasher } from '@noble/hashes/sha2.js';
import { hex } from '../lib/hash.js';

// The system's error numbers on a Mac, as the plugin's text carries them: "… (os error 17)".
const ERRNO = { 1: 'EPERM', 2: 'ENOENT', 5: 'EIO', 13: 'EACCES', 17: 'EEXIST', 18: 'EXDEV', 20: 'ENOTDIR', 21: 'EISDIR', 28: 'ENOSPC', 30: 'EROFS', 31: 'EMLINK', 45: 'ENOTSUP', 62: 'ELOOP', 63: 'ENAMETOOLONG', 66: 'ENOTEMPTY', 78: 'ENOSYS', 102: 'EOPNOTSUPP' };
export function fault(error) {
  if (error instanceof Error && error.code) return error;
  const said = typeof error === 'string' ? error : error?.message || String(error);
  // The system's number is the last thing the text says: a path earlier in it may itself hold "(os error 2)".
  const bare = /^E[A-Z]+$/.exec(said), system = [...said.matchAll(/\(os error (\d+)\)/g)].at(-1);
  const code = bare ? bare[0] : system ? ERRNO[system[1]] || 'EIO' : /^forbidden (path|name)\b/.test(said) ? 'EFORBIDDEN' : null;
  return Object.assign(error instanceof Error ? error : new Error(said), code ? { code } : {});
}
// One call to the app, with what it says went wrong turned into an Error with a code.
export const call = async work => { try { return await work(); } catch (error) { throw fault(error); } };

const taken = path => Object.assign(new Error('The name is taken: ' + path), { code: 'EEXIST' });
const STAGING = /^\.ff-staging-[0-9a-f]{16}$/;
const CHUNK = 8 * 1024 * 1024, PIECE = 1024 * 1024, WHOLE = 32 * 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const tempName = () => '.ff-new-' + hex(globalThis.crypto.getRandomValues(new Uint8Array(8))) + '.tmp';
// One for each loading of the page. The lock names the app's process, but it is the page that holds it, and the
// process outlives a page that is loaded again: a lock this process wrote under another token was left by a page
// that is gone.
const PAGE = hex(globalThis.crypto.getRandomValues(new Uint8Array(8)));
const dirOf = full => full.slice(0, full.lastIndexOf('/'));
const nameOf = path => path.slice(path.lastIndexOf('/') + 1);
const kindOf = info => info.isSymlink ? 'other' : info.isFile ? 'file' : info.isDirectory ? 'folder' : 'other';
const pause = ms => new Promise(done => setTimeout(done, ms));
// A stream or any other source of pieces, read one piece at a time. (WebKit's streams are read through a reader.)
const piecesOf = source => {
  if (typeof source?.getReader !== 'function') return source[Symbol.asyncIterator]();
  const reader = source.getReader();
  return { next: () => reader.read(), return: reason => reader.cancel(reason) };
};

export function tauriFiles({ fs, invoke }, root, { links = true, chunk = CHUNK, piece = PIECE } = {}) {
  const base = String(root).replace(/\/+$/, '');
  if (!base.startsWith('/')) throw new Error('Not a folder on this computer: ' + JSON.stringify(root));
  const at = path => {
    if (path === '') return base;
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('Not a path inside the archive: ' + JSON.stringify(path));
    return base + '/' + path;
  };
  const drop = path => call(() => fs.remove(path)).catch(() => {});
  // A folder about to be written in must really be inside the archive, not reached through a link that leads out.
  let realBase;
  const inside = async folder => {
    realBase ??= await call(() => invoke('real_path', { path: base }));
    const real = await call(() => invoke('real_path', { path: folder }));
    if (real !== realBase && !real.startsWith(realBase + '/')) throw new Error('Not inside the archive: ' + folder);
  };
  // What is at a path, a link itself and not what it leads to. The app will not look at a link that leads out of
  // every granted folder; its folder's listing still says it is one.
  const look = async full => {
    try { return await call(() => fs.lstat(full)); }
    catch (error) {
      if (error.code !== 'EFORBIDDEN' || full === base) throw error;
      const entry = (await call(() => fs.readDir(dirOf(full))).catch(() => [])).find(item => item.name === nameOf(full));
      if (!entry?.isSymlink) throw error;
      return { isFile: false, isDirectory: false, isSymlink: true, size: 0, mtime: null };
    }
  };
  // Bytes into a new hidden file in `folder`, written through to the disk before anyone can see them by name.
  // If it cannot be written whole, what was written of it goes (unless the hidden name itself was taken: then the
  // file there is not this one's).
  const staged = async (folder, bytes) => {
    const temp = folder + '/' + tempName();
    try { await call(() => fs.writeFile(temp, bytes, { createNew: true })); await call(() => invoke('settle', { path: temp })); }
    catch (error) { if (error.code !== 'EEXIST') await drop(temp); throw error; }
    return temp;
  };
  // An empty file at a name not yet taken, made in one step, that a rename then replaces: how a name is held on a disk
  // without second names, so a stop leaves an empty file or nothing, never half a document.
  const hold = async (full, path) => { try { await call(() => fs.writeFile(full, new Uint8Array(0), { createNew: true })); } catch (error) { throw error.code === 'EEXIST' ? taken(path) : error; } };
  // A file given a name not yet taken: as a second name, refused if anything has it, before the first name goes; or,
  // on a disk without second names, with the name held by an empty file that the file is then renamed onto.
  const give = async (from, full, path) => {
    if (links) {
      try { await call(() => invoke('name_file', { from, to: full })); return; }
      catch (error) { if (error.code !== 'ENOLINK') throw error.code === 'EEXIST' ? taken(path) : error; }
    }
    await hold(full, path);
    await call(() => fs.rename(from, full));
  };
  // A hidden file, written whole, given its real name. If it cannot be named, the hidden file goes.
  const named = async (temp, full, path) => { try { await give(temp, full, path); } catch (error) { await drop(temp); throw error; } };
  // Form Filler's own folder, made if missing, and refused if it is anything but a plain folder (a link, say).
  const books = async () => {
    const folder = at('.formfiller');
    await call(() => fs.mkdir(folder)).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if (kindOf(await look(folder)) !== 'folder') throw new Error('.formfiller in the archive is not a plain folder.');
    await inside(folder);
    return folder;
  };
  // This program, as the lock names it: the app's process and this computer, as the command line would name its own.
  let me;
  const who = () => me ??= call(() => invoke('whoami')).catch(error => { me = undefined; throw error; });
  const alive = pid => Number.isInteger(pid) && pid > 0 ? call(() => invoke('alive', { pid })).catch(() => false) : false;

  const files = {
    // How long a path inside the archive may be, in bytes: a Mac allows 1024 for the whole path.
    room: 1023 - encoder.encode(base).length - 1,
    // The folder's entries, [{ name, kind: "file" | "folder" | "other" }], in name order.
    async list(path) {
      const entries = await call(() => fs.readDir(at(path)));
      return entries.map(entry => ({ name: entry.name, kind: kindOf(entry) })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    },
    // { kind, bytes } for what is at `path`, or null when nothing is.
    async stat(path) {
      try { const info = await look(at(path)); return { kind: kindOf(info), bytes: kindOf(info) === 'file' ? info.size : 0 }; }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
    },
    async read(path) { return new Uint8Array(await call(() => fs.readFile(at(path)))); },
    // The file's bytes as a ReadableStream of Uint8Array pieces, read as they are wanted, so a large file is never held
    // whole. A link is refused (ELOOP), not read through.
    readStream(path) {
      const full = at(path);
      let handle = null;
      const close = async () => { const open = handle; handle = null; await open?.close().catch(() => {}); };
      return new ReadableStream({
        async pull(controller) {
          try {
            if (!handle) {
              if ((await look(full)).isSymlink) throw Object.assign(new Error('A link is not read through: ' + path), { code: 'ELOOP' });
              handle = await call(() => fs.open(full, { read: true }));
            }
            const buffer = new Uint8Array(piece), read = await call(() => handle.read(buffer));
            if (!read) { await close(); controller.close(); }
            else controller.enqueue(read === buffer.length ? buffer : buffer.slice(0, read));
          } catch (error) { await close(); throw error; }
        },
        cancel: close,
      }, { highWaterMark: 0 });
    },
    // The file's SHA-256. A small file is read whole and fingerprinted by the system; a large one a piece at a time,
    // so it is never held in memory whole.
    async sha256(path) {
      const info = await look(at(path));
      if (info.isFile && !info.isSymlink && info.size <= WHOLE && globalThis.crypto?.subtle) return hex(await globalThis.crypto.subtle.digest('SHA-256', await files.read(path)));
      const hash = hasher.create(), reader = files.readStream(path).getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; hash.update(value); }
      return hex(hash.digest());
    },
    // A new file with these bytes, which appears whole or not at all: the bytes go to a hidden file beside it first,
    // written through to the disk, which is then given the real name (refused if that name is taken).
    async createFile(path, bytes) {
      const full = at(path), folder = dirOf(full);
      await inside(folder);
      await named(await staged(folder, bytes), full, path);
    },
    // A new file from bytes that come as a stream (a ReadableStream, or any async iterable of Uint8Array pieces), made
    // as createFile makes one: gathered into pieces of 8 MiB, each appended to a hidden file beside it, written through
    // to the disk, then given its name, so it appears whole or not at all. A taken name fails with EEXIST, found only
    // once the bytes are written. If anything fails, the source included, the hidden file goes and the error comes
    // back as it was. Returns { bytes }, how many were written.
    async createFileFrom(path, source) {
      const full = at(path), folder = dirOf(full), pieces = piecesOf(source);
      let temp = null, bytes = 0, held = new Uint8Array(Math.min(chunk, 65536)), filled = 0, made = false;
      const flush = async () => {
        await call(() => fs.writeFile(temp, held.subarray(0, filled), made ? { append: true, create: false } : { createNew: true }));
        made = true; filled = 0;
      };
      try {
        await inside(folder);
        temp = folder + '/' + tempName();
        for (;;) {
          const { done, value } = await pieces.next();
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new Error('A piece of ' + path + ' is not bytes (a Uint8Array).');
          // Each piece is copied as it comes, so what is written never depends on what its maker does with it next.
          for (let from = 0; from < value.length;) {
            if (filled === held.length && held.length < chunk) { const larger = new Uint8Array(Math.min(chunk, held.length * 4)); larger.set(held); held = larger; }
            const take = Math.min(value.length - from, held.length - filled);
            held.set(value.subarray(from, from + take), filled);
            filled += take; from += take;
            if (filled === chunk) await flush();
          }
          bytes += value.length;
        }
        if (filled || !made) await flush();
        await call(() => invoke('settle', { path: temp }));
      } catch (error) {
        try { await pieces.return?.(); } catch { /* the source is past caring */ }
        if (temp && (made || error.code !== 'EEXIST')) await drop(temp);
        throw error;
      }
      await named(temp, full, path);
      return { bytes };
    },
    // A new folder, in a folder that exists.
    async createFolder(path) {
      const full = at(path);
      await inside(dirOf(full));
      try { await call(() => fs.mkdir(full)); } catch (error) { throw error.code === 'EEXIST' ? taken(path) : error; }
    },
    // A file or folder moved to a name not yet taken. The plugin's rename would silently replace a file there, or an
    // empty folder, so a folder first makes an empty folder at the new name (which fails if the name is taken) and is
    // then renamed onto that, and a file is given the new name as a second name before the old name goes (or, without
    // second names, held with an empty file that the rename replaces). A link is not moved.
    async rename(from, to) {
      const source = at(from), target = at(to), info = await look(source);
      await inside(dirOf(source)); await inside(dirOf(target));
      if (info.isSymlink) throw new Error('A link is not moved: ' + from);
      if (info.isDirectory) {
        try { await call(() => fs.mkdir(target)); } catch (error) { throw error.code === 'EEXIST' ? taken(to) : error; }
        try { await call(() => fs.rename(source, target)); } catch (error) { await drop(target); throw error; }
        return;
      }
      await give(source, target, to);
    },
    // A staging folder that a backup or a restore made, removed whole once it is given up or emptied: what is in it
    // goes too (a link in it is removed, never followed). Anything else is refused: the last part of the path must be
    // .ff-staging- and 16 hex digits, and it must be a plain folder, inside this interface's folder.
    async discardStaging(path) {
      const full = at(path);
      if (!STAGING.test(nameOf(path)) || kindOf(await look(full)) !== 'folder') throw new Error('Not a staging folder Form Filler made: ' + path);
      await inside(full);
      await call(() => fs.remove(full, { recursive: true }));
    },
    // The index cache, written whole and then put in place of the old one in one step.
    async replaceIndex(bytes) {
      const folder = await books(), index = folder + '/index.json';
      const info = await look(index).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info && kindOf(info) !== 'file') throw new Error('.formfiller/index.json in the archive is not a plain file.');
      const temp = await staged(folder, bytes);
      try { await call(() => fs.rename(temp, index)); } catch (error) { await drop(temp); throw error; }
    },
    // Only one program changes an archive at a time. .formfiller/lock is made, in one step, by whoever is about to
    // change it, and removed when they are done; anyone else waits for it (up to `wait` ms). A lock left by a program
    // that stopped (no such process on this computer any more) is taken over. The command line's lock is the same
    // file, so the app and the command line wait for each other.
    async lock({ wait = 10000 } = {}) {
      const folder = await books(), path = folder + '/lock', { pid, host } = await who();
      const mine = encoder.encode(JSON.stringify({ pid, host, since: new Date().toISOString(), page: PAGE }));
      for (const started = Date.now(); ;) {
        try { await call(() => fs.writeFile(path, mine, { createNew: true })); return; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        const holder = await files.lockHolder();
        if (holder?.stale) { await drop(path); continue; }
        if (Date.now() - started > wait) throw Object.assign(new Error('Another Form Filler is changing this archive' + (holder?.pid ? ' (process ' + holder.pid + ', since ' + holder.since + ')' : '') + '. Try again when it is done.'), { code: 'ELOCKED' });
        await pause(25);
      }
    },
    async unlock() {
      const path = at('.formfiller') + '/lock';
      try { const holder = JSON.parse(decoder.decode(await call(() => fs.readFile(path)))); if (holder.pid !== (await who()).pid || (typeof holder.page === 'string' && holder.page !== PAGE)) return; } catch { return; }
      await call(() => fs.remove(path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    },
    // Who holds the lock: { pid, host, since, stale }, or null when nobody does. Stale: its process is gone (on this
    // computer), or it is this app's own from a page that has since been loaded again, or it was never written (left
    // empty by a stop) half a minute ago or more.
    async lockHolder() {
      const path = at('.formfiller') + '/lock';
      let said, info;
      try { [said, info] = await Promise.all([call(() => fs.readFile(path)).then(bytes => decoder.decode(bytes)), call(() => fs.stat(path))]); } catch { return null; }
      try {
        const holder = JSON.parse(said), me = await who();
        const earlierPage = holder.pid === me.pid && typeof holder.page === 'string' && holder.page !== PAGE;
        return { ...holder, stale: holder.host === me.host && (earlierPage || !(await alive(holder.pid))) };
      }
      catch { const since = info.mtime ? new Date(info.mtime).getTime() : Date.now(); return { pid: null, since: new Date(since).toISOString(), stale: Date.now() - since > 30000 }; }
    },
  };
  return files;
}

// The names Form Filler itself makes in the folder that holds the archive (src-tauri/src/lib.rs has the same list,
// and it is the app, not this page, that keeps to it): the archive; a copy a restore put beside it; and a restore's
// staging folder.
const OWN = /^(Form Filler Archive( \(restored \d{4}-\d{2}-\d{2} \d{4}\)( \([1-9]\d{0,2}\))?)?|\.ff-staging-[0-9a-f]{16})$/;

// The folder that holds the archive when it is in its usual place: your home folder. A restore puts the archive back
// there, and must stage beside it, but the app is not to have your home folder. So this is a file interface over
// the home folder that reaches only Form Filler's own names in it: each is granted by the app, by name, the first
// time it is used (grant_home), a listing of the folder tells only those names (home_names), and any other name is
// refused here and by the app. One of those names that is there as anything but a plain folder (a link, say) is
// taken, and nothing goes through it. It has what a restore needs of the folder that holds an archive, and no more:
// an archive's own index and lock are the archive's, not this folder's.
export function homeFiles(tauri, home, options) {
  const inner = tauriFiles(tauri, home, options), granted = new Set();
  const refuse = (path, why) => Object.assign(new Error(why + ': ' + JSON.stringify(path)), { code: 'EFORBIDDEN' });
  const top = path => { const name = String(path).split('/')[0]; if (!OWN.test(name)) throw refuse(path, 'Not one of Form Filler\'s own folders in your home folder'); return name; };
  const names = async () => (await call(() => tauri.invoke('home_names'))).map(({ name, kind }) => ({ name, kind })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const own = async path => {
    const name = top(path);
    if (granted.has(name)) return;
    try { await call(() => tauri.invoke('grant_home', { name })); }
    catch (error) { throw error.code === 'EEXIST' ? refuse(path, 'In your home folder this is not a plain folder (a link?), so nothing is read or written through it') : error; }
    granted.add(name);
  };
  // A name about to be made in the home folder itself must be free. Whatever has it, has it: the app is asked, and a
  // link standing there is never followed to find out.
  const making = async path => {
    top(path);
    if (!path.includes('/') && (await names()).some(entry => entry.name === path)) throw taken(path);
    await own(path);
  };
  const through = (name, first = own) => async (path, ...rest) => { await first(path); return inner[name](path, ...rest); };
  return {
    room: inner.room,
    async list(path) { if (path === '') return names(); await own(path); return inner.list(path); },
    // What has one of the names in the home folder itself is told, not measured: a file's size is given as 0.
    async stat(path) {
      if (!String(path).includes('/')) {
        const name = top(path), entry = (await names()).find(item => item.name === name);
        return entry ? { kind: entry.kind, bytes: 0 } : null;
      }
      await own(path);
      return inner.stat(path);
    },
    read: through('read'), sha256: through('sha256'), discardStaging: through('discardStaging'),
    createFile: through('createFile', making), createFileFrom: through('createFileFrom', making), createFolder: through('createFolder', making),
    readStream(path) {
      let reader = null;
      return new ReadableStream({
        async pull(controller) {
          if (!reader) { await own(path); reader = inner.readStream(path).getReader(); }
          const { done, value } = await reader.read();
          if (done) controller.close(); else controller.enqueue(value);
        },
        cancel: reason => reader?.cancel(reason),
      }, { highWaterMark: 0 });
    },
    async rename(from, to) { top(from); await making(to); await own(from); return inner.rename(from, to); },
  };
}
