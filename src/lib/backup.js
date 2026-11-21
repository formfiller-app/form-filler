// Backups: one encrypted snapshot of everything Form Filler keeps (the archive, and the vault, templates and settings
// from the app's data folder), written to a drive or folder you pick; and a restore that checks every file before
// anything is put in place. Form Filler never deletes a backup, and a restore never overwrites anything.
//
//   <the drive or folder you pick>/Form Filler Backups/
//     2026-11-17 1530/          one backup, named for when it was made (" (2)" for a second one in the same minute)
//       snapshot.tar.age        a tar of everything, sealed with age to the vault's public key: so a backup needs no
//                               passphrase, and can be made while the vault is locked
//       identity.age            a copy of the vault's key, locked with your passphrase, as the vault keeps it
//       snapshot.sha256         the SHA-256 of those two files, as `shasum -a 256 -c` and `sha256sum -c` read it
//       README.txt              how to check and restore it, with Form Filler and without (README_TEXT below)
//
// The tar holds data/vault/, data/templates/ and data/settings.json (the last two when there are any), then the whole
// archive as archive/, its hidden files and empty folders included, but never its lock and never a link (a link is
// named in the manifest's "skipped" list instead). Last comes manifest.json: every member, in order, each file with
// its size and SHA-256. A backup is put together out of sight, in a staging folder beside where it goes, read back
// from the drive, and only then given its name, so it appears whole or not at all.
//
// A restore unpacks into staging folders, beside the archive and inside the data folder; checks every file against
// the manifest, and that the vault opens with the same secret and reads back; and only then moves each thing into
// place with one rename: the vault, templates and settings into the data folder, the archive where it was. What is
// there already is never touched: the restored copy goes beside it, as "… (restored 2026-11-17 1530)", the date of the
// backup it came from.
//
// It all works through file interfaces (files/node.js for Node; the Mac app will have its own), so nothing here needs
// Node, and nothing is ever held whole: the snapshot flows from the files to the tar to age to the drive, a piece at a
// time, and back the same way. Only the manifest's list is kept in memory.
//
// What the checks prove is that a backup is undamaged and sealed to your vault's key, not who made it: anyone with the
// vault's public key could seal a snapshot. The vault's own records carry tags only its key can make, so a restore
// refuses a forged one, and says so when a snapshot's vault holds none; the archive's files carry no such tags.
import { Encrypter } from 'age-encryption';
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from './hash.js';
import { localTime } from './archive.js';
import { vaultInfo, unlockVault, unlockKey } from './vault.js';
import { writeTar, readTar } from './tar.js';

export const BACKUPS = 'Form Filler Backups';
const SNAPSHOT = 'snapshot.tar.age', KEY = 'identity.age', SUMS = 'snapshot.sha256', README = 'README.txt', MANIFEST = 'manifest.json';
const MANIFEST_LIMIT = 128 * 1024 * 1024;   // bytes of manifest.json read back: about 200 a file
const KEY_LIMIT = 64 * 1024;                // bytes in identity.age: the vault's own is a few hundred
const HEAD = 4096;                          // bytes the snapshot's age header must end within (a backup's is 168)
const NAME_LIMIT = 255;                     // bytes in a name any disk holds (a Mac's holds 255 letters)
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const SUMS_LINES = /^([0-9a-f]{64}) {2}snapshot\.tar\.age\n([0-9a-f]{64}) {2}identity\.age\n$/;
const SUMS_BYTES = 64 + 2 + SNAPSHOT.length + 1 + 64 + 2 + KEY.length + 1;   // those two lines, and nothing else
const STAGING = /^\.ff-staging-[0-9a-f]{16}$/;
const OTHER = 'a link or other special file: not followed';
// Said of a snapshot whose vault holds neither your details nor a locker list. Anyone with the vault's public key can
// seal a snapshot, but only the vault key can make those records.
const EMPTY = 'it holds no details and no locker documents: if yours held some, this is not a backup you made';
const BLANK = 'YYYY-MM-DD HHMM';   // as long as a stamp, for the room checks made before the manifest gives the date
const encoder = new TextEncoder();
const fault = (code, message) => Object.assign(new Error(message), { code });
const changed = path => fault('ECHANGED', path + ' changed while it was being backed up.');
// Damage found in a snapshot: `problem` is how verify reports it, the message how a restore does.
const damaged = (problem, message) => Object.assign(new Error(message), { code: 'EDAMAGED', problem });
const bytesOf = text => encoder.encode(text).length;
const fingerprint = bytes => hex(sha256(bytes));
const json = value => encoder.encode(JSON.stringify(value, null, 2) + '\n');
const join = (folder, name) => folder ? folder + '/' + name : name;
const stampOf = made => made.slice(0, 10) + ' ' + made.slice(11, 13) + made.slice(14, 16);
const stagingName = () => '.ff-staging-' + hex(globalThis.crypto.getRandomValues(new Uint8Array(8)));
const endingOf = name => { const dot = name.lastIndexOf('.'); return dot > 0 && name.length - dot <= 10 ? name.slice(dot) : ''; };
const fold = text => text.normalize('NFC').toLowerCase();
// A path that would be longer than the disk can open is refused before anything is written there.
const fits = (files, ...paths) => {
  const room = Number.isFinite(files.room) ? files.room : Infinity;
  for (const path of paths) if (bytesOf(path) > room) throw new Error('That would make a path of ' + bytesOf(path) + ' bytes, longer than the disk can open here (' + room + '): ' + path + '. Restore to a folder whose path is shorter.');
};
// A vault store that only reads, over a file interface: all that vaultInfo, unlockVault and an unlocked vault's
// reads need.
const reading = (files, folder) => ({ async get(name) { const path = folder + '/' + name; return (await files.stat(path))?.kind === 'file' ? files.read(path) : null; } });
// Bytes passed on as they come, counted and fingerprinted on the way: `bytes` and `sha256` once they have all passed,
// when `done` is called with them too.
const hashing = (done = () => {}) => {
  const hash = sha256.create(), seen = { bytes: 0, sha256: null };
  seen.stream = new TransformStream({
    transform(piece, controller) { hash.update(piece); seen.bytes += piece.length; controller.enqueue(piece); },
    flush() { seen.sha256 = hex(hash.digest()); done(seen); },
  });
  return seen;
};
// Bytes passed on as they come, and counted; with `signal`, a stop asked for ends the stream at the next piece.
const counting = signal => {
  const seen = { bytes: 0 };
  seen.stream = new TransformStream({ transform(piece, controller) { signal?.throwIfAborted(); seen.bytes += piece.length; controller.enqueue(piece); } });
  return seen;
};
const countsOf = entries => ({
  files: entries.filter(entry => entry.kind === 'file').length, folders: entries.filter(entry => entry.kind === 'folder').length,
  bytes: entries.reduce((sum, entry) => sum + (entry.kind === 'file' ? entry.bytes : 0), 0),
});

// What goes into every backup as README.txt, and into docs/RESTORE.md.
export const README_TEXT = `FORM FILLER BACKUP

This folder is one Form Filler backup, named for the minute it was made.

  snapshot.tar.age   everything: the archive, and the vault, templates and
                     settings from Form Filler's data folder, in one tar,
                     encrypted with age to your vault's key
  identity.age       the vault's key, locked with your passphrase
  snapshot.sha256    the fingerprints of those two files, to check a copy
  README.txt         this text

Nothing in it can be read without your passphrase or your recovery key.
Form Filler never deletes a backup: delete old ones yourself, when you like.


1. CHECK THE COPY

In this folder, on a Mac:

    shasum -a 256 -c snapshot.sha256

or on Linux:

    sha256sum -c snapshot.sha256

Both lines must say OK. FAILED means this copy is damaged: use another
backup.


2. RESTORE WITH FORM FILLER

In the Mac app: open Backups, press "Restore from a backup somewhere
else", and choose this folder. On a Mac where the app has no vault yet,
its first screen offers "Restore from a backup instead".

From the command line:

    form-filler backup restore "THIS FOLDER" --data "DATA" --archive "ARCHIVE"

DATA is Form Filler's data folder, and ARCHIVE is where the archive goes.

Either way it asks for the passphrase you had when this backup was made,
or your recovery key; checks every file before anything is moved; and
never overwrites anything: if an archive or a vault is there already,
the restored copy goes beside it, named "... (restored YYYY-MM-DD HHMM)"
for the minute this backup was made.


3. RESTORE WITHOUT FORM FILLER

You need age (age-encryption.org; on a Mac, brew install age; on Debian
or Ubuntu, sudo apt install age) and tar, which every Mac and Linux has.
In a copy of this folder on your computer, or in this folder itself, run
this one line. It needs room for about twice the size of snapshot.tar.age:
once unencrypted in snapshot.tar, and once unpacked in restored/.

    age -d -i identity.age -o snapshot.tar snapshot.tar.age && mkdir restored && tar -x -f snapshot.tar -C restored

age asks for the passphrase you had when this backup was made. With only
your recovery key: write it into a file named key.txt, on one line, in
capitals, without the spaces; then run the same line with -i key.txt in
place of -i identity.age.

If age prints an error, stop, and delete snapshot.tar if it is there: age
may have written part of the backup into it, unencrypted, before it found
the problem. The passphrase or the key is wrong, or there was not room
enough, or this backup is damaged; the && kept tar from running.

age checks every byte, so what tar unpacks after age has finished cleanly
is the snapshot exactly as it was sealed. It cannot say who sealed it:
anyone who has your vault's public key could seal one. So keep your
backups on drives you control.

What you get:

  restored/archive         your archive: move it to where you keep it, and
                           name it as you like
  restored/data            Form Filler's data folder, with vault/,
                           templates/ and settings.json
  restored/manifest.json   every file, with its size and SHA-256

The vault's own files stay encrypted, to the same key; with only your
recovery key, use -i key.txt in place of -i identity.age here too. This
shows your details:

    age -d -i identity.age restored/data/vault/profile.age

restored/data/vault/locker/index.age is the locker's list, and each
document is restored/data/vault/locker/<its id>.age. This writes one to
a file named NAME:

    age -d -i identity.age -o NAME restored/data/vault/locker/<its id>.age

Then delete snapshot.tar, and key.txt if you made one: snapshot.tar holds
everything unencrypted, and key.txt opens everything.

File names come back as they were: tar carries each whole name, accents,
spaces and long names included. On a Mac, the stock tar writes an
accented letter in its other encoding (an e and then an accent, for é),
which the Mac shows and opens as the same name.


Form Filler's own restore is the safer way: it also checks every file
against the manifest, and that the vault opens, before anything is moved.
`;

// The snapshot's members, in the order they go into the tar, each one written into the manifest as it goes: data/
// first (it is small, so it is read closest to the moment the vault's own files were), then the archive, then the
// manifest. A folder comes before what is in it, in the order list() gives.
async function* members(data, archive, manifest) {
  const { entries, skipped } = manifest;
  const folder = path => { entries.push({ path, kind: 'folder' }); return { path, kind: 'folder' }; };
  // A file's size is taken just before it is read, and its bytes are fingerprinted as they pass into the tar.
  const file = async (files, from, path) => {
    const info = await files.stat(from);
    if (info?.kind !== 'file') throw changed(path);
    const entry = { path, kind: 'file', bytes: info.bytes, sha256: null };
    entries.push(entry);
    return { path, kind: 'file', size: info.bytes, open: () => files.readStream(from).pipeThrough(hashing(seen => { entry.sha256 = seen.sha256; }).stream) };
  };
  async function* tree(files, from, to, leaveOut = []) {
    for (const entry of await files.list(from)) if (!leaveOut.includes(entry.name)) yield* one(files, entry, join(from, entry.name), to + '/' + entry.name);
  }
  async function* one(files, entry, from, path) {
    if (entry.kind === 'folder') { yield folder(path); yield* tree(files, from, path); }
    else if (entry.kind === 'file') yield await file(files, from, path);
    else skipped.push({ path, why: OTHER });
  }
  yield folder('data');
  yield folder('data/vault');
  for (const entry of await data.list('vault')) {
    if (entry.kind === 'folder' && entry.name === 'locker') {
      // The locker's list first, read before the locker is listed: a document is written before the list names it,
      // and none is ever removed, so every document the snapshot's list names is in the snapshot.
      yield folder('data/vault/locker');
      const early = [];
      for (const name of ['index.age', 'index.age.prev']) if ((await data.stat('vault/locker/' + name))?.kind === 'file') { early.push(name); yield await file(data, 'vault/locker/' + name, 'data/vault/locker/' + name); }
      yield* tree(data, 'vault/locker', 'data/vault/locker', early);
    } else yield* one(data, entry, 'vault/' + entry.name, 'data/vault/' + entry.name);
  }
  const templates = await data.stat('templates'), settings = await data.stat('settings.json');
  if (templates?.kind === 'folder') yield* one(data, { name: 'templates', kind: 'folder' }, 'templates', 'data/templates');
  else if (templates?.kind === 'other') skipped.push({ path: 'data/templates', why: OTHER });
  if (settings?.kind === 'file') yield await file(data, 'settings.json', 'data/settings.json');
  else if (settings?.kind === 'other') skipped.push({ path: 'data/settings.json', why: OTHER });
  yield folder('archive');
  for (const entry of await archive.list('')) {
    // The archive's lock is a running program's claim on it, not part of it.
    if (entry.name === '.formfiller' && entry.kind === 'folder') { yield folder('archive/.formfiller'); yield* tree(archive, '.formfiller', 'archive/.formfiller', ['lock']); }
    else yield* one(archive, entry, entry.name, 'archive/' + entry.name);
  }
  const bytes = json(manifest);
  yield { path: MANIFEST, kind: 'file', size: bytes.length, open: () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
}

// A backup of the data folder (`data`, a file interface at the app's data folder, which holds vault/) and the archive
// (`archive`, one at the archive's folder), made on `destination` (one at the drive or folder picked), in
// Form Filler Backups/. The destination must not be inside the archive or the data folder; the caller sees paths and
// checks that. No passphrase is needed: the snapshot is sealed to the public key vault.json names. While the vault is
// locked nothing can check that key against identity.age, so verifyBackup with the secret is what proves a backup
// opens with your passphrase. Nothing in the data folder or the archive changes, except the archive's lock while it
// runs. With `signal` (an AbortSignal), a stop asked for while it runs ends it as a failure would, nothing kept.
// Returns { path, made, recipient, files, folders, bytes, sealed, skipped }: path inside the destination, bytes of
// the files backed up, and sealed, the size of snapshot.tar.age.
export async function makeBackup({ data, archive, destination, now = () => new Date(), signal } = {}) {
  const when = now(), made = localTime(when), mtime = Math.floor(when.getTime() / 1000);
  const vault = reading(data, 'vault');
  const vaultJson = (await data.stat('vault'))?.kind === 'folder' ? await vault.get('vault.json') : null;
  if (!vaultJson) throw fault('ENOVAULT', 'There is no vault in this data folder (vault/vault.json): a backup is locked to the vault\'s key, so the vault comes first. Nothing was written.');
  const keyBytes = await vault.get(KEY);
  if (!keyBytes) throw fault('ENOVAULT', 'The vault in this data folder has no key file (vault/identity.age): a backup without it could be opened only with the recovery key. Nothing was written.');
  const info = await vaultInfo({ get: async name => name === 'vault.json' ? vaultJson : null });
  // An archive without .formfiller is read as it is: taking the lock would make .formfiller in it.
  const locking = typeof archive.lock === 'function' && (await archive.stat('.formfiller'))?.kind === 'folder';
  if (locking) await archive.lock();
  let staging = null;
  try {
    await destination.createFolder(BACKUPS).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      if ((await destination.stat(BACKUPS))?.kind !== 'folder') throw new Error('Something that is not a folder is called "' + BACKUPS + '" where the backups go: move it, or pick another place. Nothing was written.');
    });
    const name = stagingName();
    await destination.createFolder(BACKUPS + '/' + name);
    staging = BACKUPS + '/' + name;
    await destination.createFile(staging + '/' + README, encoder.encode(README_TEXT));
    await destination.createFile(staging + '/' + KEY, keyBytes);
    const manifest = { formFiller: 'backup-manifest', version: 1, made, recipient: info.recipient, entries: [], skipped: [] };
    const plain = counting(signal), sealing = hashing(), encrypter = new Encrypter();
    encrypter.addRecipient(info.recipient);
    const sealed = await encrypter.encrypt(writeTar(members(data, archive, manifest), { mtime }).pipeThrough(plain.stream));
    const { bytes: written } = await destination.createFileFrom(staging + '/' + SNAPSHOT, sealed.pipeThrough(sealing.stream));
    // The vault as the snapshot has it must be the one whose key the snapshot is sealed to.
    const entry = path => manifest.entries.find(item => item.path === path);
    if (entry('data/vault/vault.json')?.sha256 !== fingerprint(vaultJson) || entry('data/vault/' + KEY)?.sha256 !== fingerprint(keyBytes))
      throw fault('ECHANGED', 'The vault changed while the backup was being made (a new passphrase?); nothing was kept: make it again.');
    if (written !== sealing.bytes || sealing.bytes !== sealed.size(plain.bytes))
      throw fault('EDAMAGED', 'The snapshot written (' + written + ' bytes) is not the size age says it must be (' + sealed.size(plain.bytes) + '). Nothing was kept.');
    // Read back from the drive. (The system may answer from its cache rather than the disk itself.)
    const back = await destination.stat(staging + '/' + SNAPSHOT);
    if (back?.bytes !== sealing.bytes || await destination.sha256(staging + '/' + SNAPSHOT) !== sealing.sha256 || await destination.sha256(staging + '/' + KEY) !== fingerprint(keyBytes))
      throw fault('EDAMAGED', 'The copy on the drive does not read back as it was written: the drive may be failing. Nothing was kept.');
    signal?.throwIfAborted();
    await destination.createFile(staging + '/' + SUMS, encoder.encode(sealing.sha256 + '  ' + SNAPSHOT + '\n' + fingerprint(keyBytes) + '  ' + KEY + '\n'));
    // Given its name in one step, as the disk decides what is free.
    let path = null;
    for (let n = 1; n <= 999 && !path; n++) {
      const candidate = BACKUPS + '/' + stampOf(made) + (n > 1 ? ' (' + n + ')' : '');
      try { await destination.rename(staging, candidate); path = candidate; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!path) throw new Error('No free name for the backup in ' + BACKUPS + ': 999 tried.');
    staging = null;
    return { path, made, recipient: info.recipient, ...countsOf(manifest.entries), sealed: sealing.bytes, skipped: manifest.skipped };
  } catch (error) {
    if (staging) await destination.discardStaging(staging).catch(() => {});
    if (error.code === 'ECHANGED' && !/nothing was kept/i.test(error.message)) error.message += ' Nothing was kept: make the backup again.';
    throw error;
  } finally {
    if (locking) await archive.unlock();
  }
}

// The backups on a drive or folder (`destination`, a file interface at it): every folder in Form Filler Backups that
// holds a snapshot.tar.age, whatever its name, in name order, with the snapshot's size and which of its other files
// are missing; and the staging folders a backup left when it stopped before it was finished. Reads no file's contents.
export async function listBackups(destination) {
  const found = { backups: [], unfinished: [] };
  if ((await destination.stat(BACKUPS))?.kind !== 'folder') return found;
  for (const entry of await destination.list(BACKUPS)) {
    const path = BACKUPS + '/' + entry.name;
    if (entry.kind !== 'folder') continue;
    if (STAGING.test(entry.name)) { found.unfinished.push(path); continue; }
    const snapshot = await destination.stat(path + '/' + SNAPSHOT);
    if (snapshot?.kind !== 'file') continue;
    const missing = [];
    for (const name of [KEY, SUMS, README]) if ((await destination.stat(path + '/' + name))?.kind !== 'file') missing.push(name);
    found.backups.push({ name: entry.name, path, bytes: snapshot.bytes, missing });
  }
  return found;
}

// A backup's own files checked against snapshot.sha256, read strictly. Gives what matched, the problems (each with how
// verify says it and how a restore refuses it), and identity.age's bytes, or null when it is not there or is too
// large to be a key file. Neither small file is read unless its size is one Form Filler writes, so a planted one is
// never held in memory.
async function checkCopy(backup) {
  const there = async name => { const info = await backup.stat(name); return info?.kind === 'file' ? info : null; };
  const [snapshot, sums, keyFile] = [await there(SNAPSHOT), await there(SUMS), await there(KEY)];
  if (!snapshot && !sums) throw new Error('This folder is not a Form Filler backup: there is no snapshot.tar.age in it.');
  const problems = [], matched = [], problem = (path, said, refusal) => problems.push({ path, problem: said, refusal });
  let lines = null, key = null;
  if (!sums) problem(SUMS, 'it is missing, so this copy cannot be checked', 'snapshot.sha256 is missing, so this copy cannot be checked: try another backup.');
  else if (sums.bytes !== SUMS_BYTES || !(lines = SUMS_LINES.exec(new TextDecoder().decode(await backup.read(SUMS)))))
    problem(SUMS, 'it is not as Form Filler writes it, so this copy cannot be checked', 'snapshot.sha256 is not as Form Filler writes it, so this copy cannot be checked: try another backup.');
  if (!snapshot) problem(SNAPSHOT, 'it is missing', 'snapshot.tar.age is missing from this backup: try another one.');
  else if (lines) {
    if (await backup.sha256(SNAPSHOT) === lines[1]) matched.push(SNAPSHOT);
    else problem(SNAPSHOT, 'it does not match its fingerprint: this copy is damaged', 'snapshot.tar.age does not match its fingerprint: this copy is damaged; try another backup.');
  }
  if (!keyFile) problem(KEY, 'it is missing, so only the recovery key can open this backup', null);
  else if (keyFile.bytes > KEY_LIMIT)
    problem(KEY, 'it is too large to be the key file Form Filler writes: this copy is damaged', 'identity.age is too large to be the key file Form Filler writes: this copy is damaged; try another backup, or use your recovery key.');
  else {
    key = await backup.read(KEY);
    if (lines && fingerprint(key) === lines[2]) matched.push(KEY);
    else if (lines) problem(KEY, 'it does not match its fingerprint: this copy is damaged', 'identity.age does not match its fingerprint: this copy is damaged; try another backup, or use your recovery key.');
  }
  return { problems, matched, key };
}

// The snapshot's key, from the passphrase and identity.age or from the recovery key. The recovery key needs no key
// file, so a damaged identity.age (one of `problems`) stops only the passphrase: with ENOKEY, as a missing one does.
const keyOf = (problems, keyBytes, secret) => unlockKey(problems.some(problem => problem.path === KEY && problem.refusal) ? null : keyBytes, secret);

// A snapshot's age header as a backup writes it: one X25519 stanza, then the MAC, each line ended, all within `head`.
function sealedHeader(head) {
  const lines = new TextDecoder().decode(head).split('\n'), share = /^[A-Za-z0-9+/]{43}$/;
  return lines.length > 4 && lines[0] === 'age-encryption.org/v1' && lines[1].startsWith('-> X25519 ') && share.test(lines[1].slice(10))
    && share.test(lines[2]) && lines[3].startsWith('--- ') && share.test(lines[3].slice(4));
}

// The snapshot opened with the key. Its header is read first, and must end within its first 4 KiB, as a backup's
// does: age itself would gather a header line of any length in memory. A recovery key that is not this backup's is
// refused; a key file that does not open the snapshot, or a damaged header, is damage. The disk's own errors come
// back as they are.
async function openSnapshot(key, backup) {
  const file = backup.readStream(SNAPSHOT).getReader(), first = [];
  let held = 0;
  try { for (let next; held < HEAD && !(next = await file.read()).done; held += next.value.length) first.push(next.value); }
  catch (error) { await file.cancel(error).catch(() => {}); throw error; }
  const head = new Uint8Array(Math.min(held, HEAD));
  for (let at = 0, index = 0; at < head.length; at += first[index++].length) head.set(first[index].subarray(0, head.length - at), at);
  if (!sealedHeader(head)) {
    await file.cancel().catch(() => {});
    throw damaged('it does not open: its header is damaged (not as a backup writes it)', 'snapshot.tar.age does not open: its header is damaged (not as a backup writes it). Nothing was restored.');
  }
  const sealed = new ReadableStream({
    async pull(controller) {
      if (first.length) { controller.enqueue(first.shift()); return; }
      const { done, value } = await file.read();
      if (done) controller.close(); else controller.enqueue(value);
    },
    cancel: reason => file.cancel(reason),
  }, { highWaterMark: 0 });
  try { return await key.decrypt(sealed); }
  catch (error) {
    await file.cancel(error).catch(() => {});
    if (error.code) throw error;
    if (/no identity matched/.test(error.message)) {
      if (key.by === 'recovery key') throw fault('EPASSPHRASE', 'That recovery key does not open this backup: check it letter by letter.');
      throw damaged('the key in identity.age does not open it: one of them is damaged, or from another backup', 'The key in this backup\'s identity.age does not open its snapshot: one of them is damaged, or from another backup. Nothing was restored.');
    }
    throw damaged('it does not open: its header is damaged (' + error.message + ')', 'snapshot.tar.age does not open: its header is damaged (' + error.message + '). Nothing was restored.');
  }
}

// What a backup may hold, by path: data/ with vault/, templates/ and settings.json in it; archive/ and anything in it.
function holds(path, kind) {
  const parts = path.split('/');
  if (parts[0] === 'archive') return parts.length > 1 || kind === 'folder';
  if (parts[0] !== 'data') return false;
  if (parts.length === 1) return kind === 'folder';
  if (parts.length === 2) return parts[1] === 'settings.json' ? kind === 'file' : ['vault', 'templates'].includes(parts[1]) && kind === 'folder';
  return ['vault', 'templates'].includes(parts[1]);
}

// A decrypted snapshot read member by member, each given to `keep` (which gives { bytes, sha256 } for a file it wrote
// or only read). Nothing counts until all of it holds: the age stream ended cleanly, where a tar ends; it holds only
// what a backup holds, data/vault/ and archive/ among it; and manifest.json, last and once, lists every member in
// order, each file with the same size and SHA-256, and nothing more. Gives the manifest. An error from age itself
// (it has no code) is damage; the disk's own, and a stop asked for with `signal`, come back as they are.
async function walkSnapshot(plain, recipient, keep, signal) {
  let broken = null, manifestBytes = null;
  const reader = plain.getReader(), seen = [];
  const input = new ReadableStream({
    async pull(controller) {
      signal?.throwIfAborted();
      let next;
      try { next = await reader.read(); } catch (error) { if (!error?.code) broken ??= error; throw error; }
      if (next.done) controller.close(); else controller.enqueue(next.value);
    },
    cancel: reason => reader.cancel(reason),
  }, { highWaterMark: 0 });
  const unlike = what => damaged('it does not match its manifest (' + what + ')', 'The snapshot does not match its manifest (' + what + '); nothing was restored.');
  try {
    await readTar(input, async member => {
      if (manifestBytes) throw unlike('"' + member.path + '" comes after manifest.json');
      if (member.path === MANIFEST) {
        if (member.kind !== 'file' || member.size > MANIFEST_LIMIT) throw unlike('manifest.json is not one Form Filler writes');
        const bytes = new Uint8Array(member.size), pieces = member.pieces.getReader();
        for (let at = 0; ;) { const { done, value } = await pieces.read(); if (done) break; bytes.set(value, at); at += value.length; }
        manifestBytes = bytes;
        return;
      }
      if (!holds(member.path, member.kind)) throw unlike('"' + member.path + '" is not something a backup holds');
      seen.push({ path: member.path, kind: member.kind, ...(await keep(member)) });
    });
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    const cause = broken || (error.code === 'EDAMAGED' && !error.problem ? error : null);
    if (cause) throw damaged('it is damaged or cut short (' + cause.message + ')', 'The snapshot is damaged or cut short (' + cause.message + '); nothing was restored.');
    throw error;
  }
  if (!manifestBytes) throw unlike('there is no manifest.json');
  for (const path of ['data/vault', 'archive']) if (!seen.some(member => member.path === path)) throw unlike('there is no ' + path + '/');
  let manifest = null;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)); } catch { manifest = null; }
  if (!manifest || manifest.formFiller !== 'backup-manifest' || manifest.version !== 1 || !Array.isArray(manifest.entries) || !Array.isArray(manifest.skipped)
    || manifest.skipped.some(item => typeof item?.path !== 'string' || typeof item?.why !== 'string')) throw unlike('manifest.json is not one Form Filler writes');
  if (typeof manifest.made !== 'string' || !TIME.test(manifest.made)) throw unlike('manifest.json does not say when the backup was made');
  if (manifest.recipient !== recipient) throw unlike('manifest.json names another key than the one the snapshot is sealed to');
  if (manifest.entries.length !== seen.length) throw unlike('it lists ' + manifest.entries.length + ' members, and the snapshot holds ' + seen.length);
  seen.forEach((member, index) => {
    const listed = manifest.entries[index];
    if (!listed || listed.path !== member.path || listed.kind !== member.kind || (member.kind === 'file' && (listed.bytes !== member.bytes || listed.sha256 !== member.sha256)))
      throw unlike('"' + member.path + '" is not as it lists it');
  });
  return manifest;
}

// A backup checked (`backup`, a file interface at its folder): its files against snapshot.sha256; and, with `secret`
// (the passphrase you had when it was made, or the recovery key), the snapshot opened and every file in it checked
// against its manifest. It writes nothing, so it works on a locked drive. A wrong secret, a key file that is not one,
// or a folder that is not a backup is refused; damage is reported. Returns { ok, fully, made, files, folders, bytes,
// matches, problems: [{ path, problem }], notes: [{ path, note }] }; the counts, the date and the notes are the
// manifest's, so they come with `secret` only. A note is no problem: it says a vault holds nothing that only its key
// could have made.
export async function verifyBackup(backup, { secret } = {}) {
  const fully = secret !== undefined, { problems, matched, key: keyBytes } = await checkCopy(backup);
  const report = { ok: false, fully, made: null, files: 0, folders: 0, bytes: 0, matches: matched, problems: problems.map(({ path, problem }) => ({ path, problem })), notes: [] };
  if (fully && (await backup.stat(SNAPSHOT))?.kind === 'file') {
    const key = await keyOf(problems, keyBytes, secret).catch(error => { if (error.code !== 'ENOKEY') throw error; return null; });
    if (!key) report.problems.push({ path: SNAPSHOT, problem: 'it was not opened: the passphrase opens it only with a whole identity.age, and the recovery key without one' });
    else {
      try {
        const manifest = await walkSnapshot(await openSnapshot(key, backup), key.recipient, async ({ kind, pieces }) => {
          if (kind !== 'file') return {};
          const hash = sha256.create(), reader = pieces.getReader();
          let bytes = 0;
          for (;;) { const { done, value } = await reader.read(); if (done) break; hash.update(value); bytes += value.length; }
          return { bytes, sha256: hex(hash.digest()) };
        });
        Object.assign(report, { made: manifest.made, ...countsOf(manifest.entries) });
        if (!manifest.entries.some(entry => entry.path === 'data/vault/profile.age' || entry.path === 'data/vault/locker/index.age')) report.notes.push({ path: 'data/vault', note: EMPTY });
      } catch (error) {
        if (error.code !== 'EDAMAGED') throw error;
        report.problems.push({ path: SNAPSHOT, problem: error.problem || error.message });
      }
    }
  }
  report.ok = !report.problems.length;
  return report;
}

// "name (restored 2026-11-17 1530)", then "… (2)" and on, keeping a file's ending: "settings (restored …).json".
const beside = (name, n, file, stamp) => {
  if (n === 0) return name;
  const ending = file ? endingOf(name) : '';
  return name.slice(0, name.length - ending.length) + ' (restored ' + stamp + ')' + (n > 1 ? ' (' + n + ')' : '') + ending;
};

// A backup restored (`backup`, a file interface at its folder) with `secret`, the passphrase you had when it was made
// or the recovery key: the vault, templates and settings into the data folder (`data`, one at the app's data folder,
// which must exist), and the archive to `archive.name` in `archive.parent` (one at the folder that holds it, or will).
// Nothing is written until the copy matches its fingerprints and the secret opens it. Then everything is unpacked out
// of sight, in staging folders, and checked: every member against the manifest, and the vault opened with the same
// secret, its details and every locker document read back. Only then is each thing moved into place, with one
// rename. Nothing is overwritten: whatever is at a place (an empty folder too) stays, and the copy goes beside it.
// A failure before that leaves nothing behind, and so does a stop asked for with `signal` (an AbortSignal) before
// then. Returns { made, placed: [{ what, path, beside }], files, folders, bytes, skipped, vault: { details,
// documents }, unfinished: [{ folder, path }] }, with each path inside its interface (the data folder, or the
// archive's parent): `vault` says whether the vault held your details, and how many locker documents; `unfinished`
// names the staging folders an earlier restore left when it was stopped before it could remove them (killed, or the
// power went), in "data" or "parent". They are not this restore's, so they are left as they are.
export async function restoreBackup({ backup, secret, data, archive: { parent, name } = {}, signal } = {}) {
  if (typeof name !== 'string' || !name || name.includes('/') || name === '.' || name === '..') throw new Error('Name the folder the archive is restored to.');
  // The longest name the archive may be given, " (restored …) (999)" and all, must be one a disk can hold.
  const longest = beside(name, 999, false, BLANK);
  if (bytesOf(longest) > NAME_LIMIT) throw new Error('That would make a name of ' + bytesOf(longest) + ' bytes, longer than a disk can hold (' + NAME_LIMIT + '): ' + longest + '. Restore to a folder whose name is shorter.');
  const { problems, key: keyBytes } = await checkCopy(backup);
  const refusal = problems.find(problem => problem.refusal && problem.path !== KEY), damagedKey = problems.find(problem => problem.refusal && problem.path === KEY);
  if (refusal) throw fault('EDAMAGED', refusal.refusal);
  const key = await keyOf(problems, keyBytes, secret).catch(error => { throw error.code === 'ENOKEY' && damagedKey ? fault('EDAMAGED', damagedKey.refusal) : error; });
  const plain = await openSnapshot(key, backup);
  const stagingA = stagingName(), stagingD = stagingName(), started = [], kept = [], unfinished = [];
  try {
    signal?.throwIfAborted();
    for (const [files, folder] of [[data, 'data'], [parent, 'parent']])
      for (const entry of await files.list('')) if (entry.kind === 'folder' && STAGING.test(entry.name)) unfinished.push({ folder, path: entry.name });
    await parent.createFolder(stagingA);
    started.push([parent, stagingA]);
    await data.createFolder(stagingD);
    started.push([data, stagingD]);
    const manifest = await walkSnapshot(plain, key.recipient, async ({ path, kind, pieces }) => {
      const [top, part] = path.split('/'), files = top === 'data' ? data : parent, target = (top === 'data' ? stagingD : stagingA) + '/' + path;
      // The longest path this member may end up at: its place, with " (restored …) (999)".
      const final = top === 'archive' ? beside(name, 999, false, BLANK) + path.slice('archive'.length)
        : part ? beside(part, 999, part === 'settings.json', BLANK) + path.slice(('data/' + part).length) : null;
      fits(files, target, ...(final ? [final] : []));
      try {
        if (kind === 'folder') { await files.createFolder(target); kept.push(path); return {}; }
        const hasher = hashing(), { bytes } = await files.createFileFrom(target, pieces.pipeThrough(hasher.stream));
        kept.push(path);
        return { bytes, sha256: hasher.sha256 };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const first = kept.find(earlier => fold(earlier) === fold(path));
        throw new Error('The snapshot holds two names this disk takes for one: ' + (first ? '"' + first + '" and ' : '') + '"' + path + '". Restore onto a disk that tells them apart.');
      }
    }, signal);
    // The vault, as unpacked, must open with the same secret and read back: its details, and every locker document
    // checked against its size and SHA-256.
    let vault = null, held = null;
    try {
      vault = await unlockVault(reading(data, stagingD + '/data/vault'), secret);
      const profile = await vault.readProfile(), documents = await vault.listDocuments();
      for (const { id } of documents) await vault.readDocument(id);
      held = { details: profile.saved !== null, documents: documents.length };
    } catch (error) {
      throw fault('EDAMAGED', 'The vault in this backup does not open as it should: ' + error.message + ' Nothing was restored.');
    } finally { vault?.lock(); }
    signal?.throwIfAborted();
    // Each thing into place with one rename, the next name tried only when the disk says one is taken.
    const stamp = stampOf(manifest.made), placed = [], has = path => manifest.entries.some(entry => entry.path === path);
    const place = async (files, from, wanted, file, what) => {
      for (let n = 0; n <= 999; n++) {
        const candidate = beside(wanted, n, file, stamp);
        try { await files.rename(from, candidate); placed.push({ what, path: candidate, beside: n > 0 }); return; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      throw new Error('No free name for the restored ' + what + ': 999 tried.');
    };
    try {
      for (const what of ['vault', 'templates', 'settings.json']) if (has('data/' + what)) await place(data, stagingD + '/data/' + what, what, what === 'settings.json', what);
      await place(parent, stagingA + '/archive', name, false, 'archive');
    } catch (error) {
      if (placed.length) error.message += ' Restored already, each whole and checked: ' + placed.map(item => item.what + ' at ' + item.path).join(', ') + '.';
      throw error;
    }
    for (const [files, folder] of started.splice(0)) await files.discardStaging(folder).catch(() => {});
    return { made: manifest.made, placed, ...countsOf(manifest.entries), skipped: manifest.skipped, vault: held, unfinished };
  } catch (error) {
    await plain.cancel(error).catch(() => {});
    for (const [files, folder] of started) await files.discardStaging(folder).catch(() => {});
    throw error;
  }
}
