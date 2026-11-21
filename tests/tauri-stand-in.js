// A stand-in for what the Mac app gives its page, so the app's own file code (src/app/files-tauri.js and
// store-tauri.js) can be tested here without the app: the file plugin's calls (`fs`, window.__TAURI__.fs in the app)
// and the app's own commands (`invoke`; src-tauri/src/lib.rs), over Node's file system. It is written from the
// plugin's source (tauri-plugin-fs 2.7.1) and behaves as that does, in the ways the app's code leans on:
// - Nothing is reached outside the folders granted (each with everything in it, as a pick in the dialog grants one).
//   The path that is checked is the real one, every link followed, the parents of a path not there yet included.
// - An error is text, not an Error, written as the plugin writes it, with the system's number as a Mac numbers it:
//   "failed to … at path: … with error: … (os error 17)". A path outside the granted folders is "forbidden path: …".
// - rename replaces what has the new name (a file, or an empty folder); writeFile replaces a file unless it is told
//   createNew or append; mkdir fails on a name that is taken; a listing says a link is a link.
// - Bytes are written only whole (writeFile with a Uint8Array). A stream given to writeFile, which the real plugin
//   would write through a file handle a hundred times slower, is refused here, and a handle cannot write at all.
// What it cannot say is whether the real plugin does the same: scripts/mac-check.mjs runs the same checks in the app.
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, rm, rmdir, stat, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

// A Mac's numbers for the system's errors, whatever system the tests run on.
const MAC = { EPERM: 1, ENOENT: 2, EIO: 5, EACCES: 13, EEXIST: 17, EXDEV: 18, ENOTDIR: 20, EISDIR: 21, EINVAL: 22, ENOSPC: 28, EROFS: 30, EMLINK: 31, ENOTSUP: 45, ELOOP: 62, ENAMETOOLONG: 63, ENOTEMPTY: 66, ENOSYS: 78, EOPNOTSUPP: 102 };
const OWN = /^(Form Filler Archive( \(restored \d{4}-\d{2}-\d{2} \d{4}\)( \([1-9]\d{0,2}\))?)?|\.ff-staging-[0-9a-f]{16})$/;
const said = (doing, path, error) => 'failed to ' + doing + ' at path: ' + path + ' with error: ' + String(error.message || error).replace(/^[A-Z]+: /, '').replace(/, [a-z]+ '.*$/, '') + ' (os error ' + (MAC[error.code] ?? 5) + ')';

export function tauriStandIn({ granted = [], links = true, data = null, home = null } = {}) {
  // Each granted folder as it was named and as the disk had it when it was granted: the app works a grant out once,
  // so a link put in a granted folder's place afterwards leads nowhere the page may go.
  const roots = [], log = [], waiting = [...granted];
  // The path the system would really work on: as the plugin's resolve_real_path finds it.
  const realOf = async (path, followed = 0) => {
    try { return await realpath(path); } catch { /* not there, or a link that leads nowhere */ }
    const info = await lstat(path).catch(() => null);
    if (info?.isSymbolicLink()) {
      if (followed >= 40) throw new Error('too many levels of symbolic links');
      const target = await readlink(path);
      return realOf(isAbsolute(target) ? target : join(dirname(path), target), followed + 1);
    }
    const parent = dirname(path);
    return parent === path ? path : join(await realOf(parent, followed), basename(path));
  };
  const grant = async folder => { roots.push(folder, await realOf(folder).catch(() => folder)); };
  const within = async real => {
    while (waiting.length) await grant(waiting.shift());
    return roots.some(top => real === top || real.startsWith(top + '/'));
  };
  const check = async path => {
    if (typeof path !== 'string' || !isAbsolute(path)) throw 'forbidden path: ' + path;
    let real;
    try { real = await realOf(path); } catch { throw 'forbidden path: ' + path; }
    if (!(await within(real))) throw 'forbidden path: ' + path;
    return path;
  };
  const doing = async (what, path, work) => { log.push(what + ' ' + path); try { return await work(); } catch (error) { throw typeof error === 'string' ? error : said(what, path, error); } };
  const infoOf = info => ({ isFile: info.isFile(), isDirectory: info.isDirectory(), isSymlink: info.isSymbolicLink(), size: info.size, mtime: info.mtime, atime: info.atime, birthtime: info.birthtime });

  const fs = {
    async readDir(path) {
      await check(path);
      return doing('read directory', path, async () => (await readdir(path, { withFileTypes: true })).map(entry => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory(), isSymlink: entry.isSymbolicLink() })));
    },
    async lstat(path) { await check(path); return doing('get metadata of path', path, async () => infoOf(await lstat(path))); },
    async stat(path) { await check(path); return doing('get metadata of path', path, async () => infoOf(await stat(path))); },
    async readFile(path) { await check(path); return doing('read file', path, async () => new Uint8Array(await readFile(path))); },
    async open(path, { read = true, write = false } = {}) {
      await check(path);
      if (write || !read) throw 'the stand-in opens a file only to read it: bytes are written whole, with writeFile';
      const handle = await doing('open file', path, () => open(path, 'r'));
      return {
        async read(buffer) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); return bytesRead === 0 ? null : bytesRead; },
        async close() { await handle.close(); },
      };
    },
    async writeFile(path, data, { append = false, create = true, createNew = false } = {}) {
      await check(path);
      if (!(data instanceof Uint8Array)) throw 'the stand-in writes bytes only (a Uint8Array): the real plugin would write a stream through a file handle, a hundred times slower';
      const flags = createNew ? 'wx' : append ? constants.O_WRONLY | constants.O_APPEND | (create ? constants.O_CREAT : 0) : create ? 'w' : 'r+';
      return doing('open file', path, async () => {
        const handle = await open(path, flags);
        try { if (flags === 'r+') await handle.truncate(0); await handle.writeFile(data); } finally { await handle.close(); }
        log[log.length - 1] = 'write file ' + path + ' ' + data.length + (createNew ? ' new' : append ? ' append' : '');
      });
    },
    async mkdir(path, { recursive = false } = {}) { await check(path); return doing('create directory', path, async () => { await mkdir(path, { recursive }); }); },
    async rename(from, to) { await check(from); await check(to); return doing('rename old path: ' + from + ' to new path', to, () => rename(from, to)); },
    async remove(path, { recursive = false } = {}) {
      await check(path);
      return doing('remove path', path, async () => {
        const info = await lstat(path);
        if (info.isFile()) await unlink(path);
        else if (recursive) await rm(path, { recursive: true });
        else if (info.isDirectory()) await rmdir(path);
        else await unlink(path);
      });
    },
    async copyFile(from, to) { await check(from); await check(to); return doing('copy file to path: ' + to + ' from', from, () => copyFile(from, to)); },
  };

  // The app's own commands, as src-tauri/src/lib.rs has them.
  const commands = {
    async settle({ path }) {
      const real = await doing('find what is', path, () => realpath(path));
      await check(path);
      return doing('write through to the disk the file', real, async () => { const handle = await open(real, 'r'); try { await handle.sync(); } finally { await handle.close(); } });
    },
    async name_file({ from, to }) {
      const info = await doing('find the file', from, () => lstat(from));
      if (!info.isFile()) throw 'only a plain file is given a name, and this is not one: ' + from;
      await check(from);
      const folder = await doing('find the folder', dirname(to), () => realpath(dirname(to))), target = join(folder, basename(to));
      if (await lstat(target).catch(() => null)) { if (!(await within(folder))) throw 'forbidden path: ' + to; throw 'EEXIST'; }
      if (!(await within(target))) throw 'forbidden path: ' + to;
      if (!links) throw 'ENOLINK';
      log.push('name file ' + target);
      try { await link(await realpath(from), target); } catch (error) { throw error.code === 'EEXIST' ? 'EEXIST' : said('name the file', target, error); }
      await unlink(from);
    },
    async real_path({ path }) {
      if (!isAbsolute(path)) throw 'forbidden path: ' + path;
      const real = await doing('find what is', path, () => realpath(path));
      if (home && real === await realpath(home).catch(() => null)) return real;
      if (!(await within(real))) throw 'forbidden path: ' + path;
      return real;
    },
    async whoami() { return { pid: process.pid, host: hostname() }; },
    async alive({ pid }) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } },
    async places() { return { data, home, archive: join(home, 'Form Filler Archive') }; },
    async home_names() {
      return (await doing('read directory', home, () => readdir(home, { withFileTypes: true }))).filter(entry => OWN.test(entry.name))
        .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : 'other' })).sort((a, b) => a.name < b.name ? -1 : 1);
    },
    async grant_home({ name }) {
      if (typeof name !== 'string' || !OWN.test(name)) throw 'forbidden name: ' + name;
      const there = await lstat(join(home, name)).catch(() => null);
      if (there && !there.isDirectory()) throw 'EEXIST';
      await grant(join(home, name));
      return join(home, name);
    },
  };
  const invoke = async (command, args = {}) => {
    if (!commands[command]) throw 'Command ' + command + ' not found';
    return commands[command](args);
  };
  // `grant` is the tests' own: what a pick in the folder dialog does. `log` is every call that reached the disk.
  return { fs, invoke, grant, log };
}
