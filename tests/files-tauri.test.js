import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { forgetVault, makeBackup, openArchive, restoreBackup, unlockVault } from '../src/lib/index.js';
import { nodeFiles } from '../src/lib/files/node.js';
import { nodeStore } from '../src/lib/stores/node.js';
import { fault, homeFiles, tauriFiles } from '../src/app/files-tauri.js';
import { tauriStore } from '../src/app/store-tauri.js';
import { tauriStandIn } from './tauri-stand-in.js';
import { PASSPHRASE, STAMP, clock, hashOf, makeWorld, walk } from './backup-world.js';

// The Mac app's own file code (src/app/files-tauri.js and store-tauri.js), over a stand-in for the app
// (tests/tauri-stand-in.js). The archive's and the vault's own tests run on it too (tests/archive.test.js and
// tests/vault.test.js); here is what only the app has. Everything is invented, and every folder is under one
// temporary folder, removed when the tests are done. scripts/mac-check.mjs runs checks like these in the app itself.
const scratch = mkdtempSync(join(tmpdir(), 'ff-app-files-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const temp = (tag = 'disk-') => mkdtempSync(join(scratch, tag));
const bytes = value => new TextEncoder().encode(value);
const IRS = { matter: 'Taxes/2026', title: 'Form 1040', direction: 'out', counterparty: 'IRS', channel: 'export' };
const joined = pieces => { const whole = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0)); let at = 0; for (const piece of pieces) { whole.set(piece, at); at += piece.length; } return whole; };

test('what the app says went wrong becomes an error with the system\'s code', () => {
  for (const [said, code] of [
    ['failed to open file at path: /x/y with error: File exists (os error 17)', 'EEXIST'],
    ['failed to get metadata of path: /x/y with error: No such file or directory (os error 2)', 'ENOENT'],
    ['failed to read directory at path: /x/y with error: Not a directory (os error 20)', 'ENOTDIR'],
    ['failed to remove path: /x with error: Directory not empty (os error 66)', 'ENOTEMPTY'],
    ['failed to open file at path: /x with error: No space left on device (os error 28)', 'ENOSPC'],
    ['failed to open file at path: /x with error: something new (os error 999)', 'EIO'],
    ['EEXIST', 'EEXIST'], ['ENOLINK', 'ENOLINK'],
    ['forbidden path: /Users/someone/Documents', 'EFORBIDDEN'], ['forbidden name: Documents', 'EFORBIDDEN'],
  ]) {
    const error = fault(said);
    assert.ok(error instanceof Error);
    assert.equal(error.code, code, said);
    assert.equal(error.message, said);
  }
  assert.equal(fault('something else went wrong').code, undefined);
  const own = Object.assign(new Error('The name is taken: x'), { code: 'EEXIST' });
  assert.equal(fault(own), own, 'an error that has its code already passes as it is');
});

test('a file that comes as a stream is gathered and appended in pieces, and what is written is what came', async () => {
  const dir = temp(), tauri = tauriStandIn({ granted: [dir] }), files = tauriFiles(tauri, dir, { chunk: 1000, piece: 700 });
  const pieces = [0, 1, 999, 1, 1000, 1001, 5000, 0, 3].map((size, n) => Uint8Array.from({ length: size }, (_, i) => (i * 31 + n * 7) % 256)), whole = joined(pieces);
  // The maker of the pieces uses each one again once it has handed it on: what was written must not have changed.
  async function* source() { for (const piece of pieces) { const lent = piece.slice(); yield lent; lent.fill(0xee); } }
  assert.deepEqual(await files.createFileFrom('gathered.bin', source()), { bytes: whole.length });
  assert.equal(hashOf(readFileSync(join(dir, 'gathered.bin'))), hashOf(whole), 'byte for byte');
  const writes = tauri.log.filter(line => line.startsWith('write file ')).map(line => line.slice(line.lastIndexOf('.tmp ') + 5));
  assert.deepEqual(writes, ['1000 new', ...Array(Math.floor(whole.length / 1000) - 1).fill('1000 append'), whole.length % 1000 + ' append'], 'whole pieces, the first to a new hidden file and the rest appended');
  assert.ok(tauri.log.indexOf(tauri.log.find(line => line.startsWith('write through to the disk'))) < tauri.log.indexOf(tauri.log.find(line => line.startsWith('name file'))), 'written through to the disk before it is given its name');
  // Read back as it is wanted, in pieces.
  const reader = files.readStream('gathered.bin').getReader(), read = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; read.push(value); }
  assert.deepEqual(read.map(piece => piece.length), [...Array(Math.floor(whole.length / 700)).fill(700), whole.length % 700]);
  assert.equal(hashOf(joined(read)), hashOf(whole));
  assert.equal(await files.sha256('gathered.bin'), hashOf(whole));
  // A stream with nothing in it makes an empty file, and a ReadableStream is read through its reader.
  assert.deepEqual(await files.createFileFrom('empty.bin', (async function* () { /* nothing */ })()), { bytes: 0 });
  assert.equal(readFileSync(join(dir, 'empty.bin')).length, 0);
  assert.deepEqual(await files.createFileFrom('streamed.bin', new ReadableStream({ start(controller) { controller.enqueue(bytes('one ')); controller.enqueue(bytes('two')); controller.close(); } })), { bytes: 7 });
  assert.equal(readFileSync(join(dir, 'streamed.bin'), 'utf8'), 'one two');
  // At its own sizes (8 MiB appended at a time), on a file too large to fingerprint whole: read a piece at a time.
  const large = tauriFiles(tauri, dir), block = Uint8Array.from({ length: 3 * 1024 * 1024 }, (_, i) => (i * 7919) % 251);
  async function* blocks() { for (let n = 0; n < 11; n++) yield block; }
  assert.deepEqual(await large.createFileFrom('large.bin', blocks()), { bytes: 33 * 1024 * 1024 });
  const onDisk = hashOf(readFileSync(join(dir, 'large.bin')));
  assert.equal(onDisk, hashOf(joined(Array(11).fill(block))));
  assert.equal(await large.sha256('large.bin'), onDisk);
  assert.deepEqual(readdirSync(dir).sort(), ['empty.bin', 'gathered.bin', 'large.bin', 'streamed.bin'], 'no hidden file is left');
});

test('the app and the command line keep one lock between them, and each takes over a lock whose program is gone', async () => {
  const dir = temp(), app = tauriFiles(tauriStandIn({ granted: [dir] }), dir), line = nodeFiles(dir), lock = join(dir, '.formfiller/lock');
  await app.lock();
  const held = JSON.parse(readFileSync(lock, 'utf8'));
  assert.deepEqual([held.pid, held.host], [process.pid, hostname()], 'named as the command line names its own');
  await assert.rejects(line.lock({ wait: 100 }), { code: 'ELOCKED' });
  assert.equal((await line.lockHolder()).stale, false);
  await app.unlock();
  assert.equal(existsSync(lock), false);
  await line.lock();
  await assert.rejects(app.lock({ wait: 100 }), { code: 'ELOCKED', message: /Another Form Filler is changing this archive \(process \d+/ });
  await line.unlock();
  const gone = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
  writeFileSync(lock, JSON.stringify({ pid: gone, host: hostname(), since: '2026-11-17T15:00:00.000Z' }));
  assert.equal((await app.lockHolder()).stale, true, 'its program is gone');
  await app.lock(); await app.unlock();
  writeFileSync(lock, JSON.stringify({ pid: gone, host: 'another-computer.example', since: '2026-11-17T15:00:00.000Z' }));
  assert.equal((await app.lockHolder()).stale, false, 'a lock from another computer is not this one\'s to judge');
  await assert.rejects(app.lock({ wait: 100 }), { code: 'ELOCKED' });
  writeFileSync(lock, '');
  assert.deepEqual([(await app.lockHolder()).pid, (await app.lockHolder()).stale], [null, false], 'one being written this moment is waited for');
  for (const pid of ['not a number', -1, 0, 1.5]) { writeFileSync(lock, JSON.stringify({ pid, host: hostname(), since: '2026-11-17T15:00:00.000Z' })); assert.equal((await app.lockHolder()).stale, true, 'pid ' + pid); }
});

test('nothing is written through a link, and a link that leads out of every granted folder is refused by the app itself', async () => {
  const top = temp(), dir = join(top, 'archive'), other = join(top, 'granted too'), outside = join(top, 'not granted');
  for (const folder of [dir, other, outside]) mkdirSync(folder);
  const files = tauriFiles(tauriStandIn({ granted: [dir, other] }), dir), book = openArchive(files, { now: clock });
  const { path } = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('%PDF- an invented form') }] });
  symlinkSync(other, join(dir, 'way to granted')); symlinkSync(outside, join(dir, 'way out')); symlinkSync('nowhere at all', join(dir, 'way nowhere'));
  assert.deepEqual((await files.list('')).filter(entry => entry.name.startsWith('way')), ['way nowhere', 'way out', 'way to granted'].map(name => ({ name, kind: 'other' })), 'a link is listed as a link');
  for (const name of ['way to granted', 'way out', 'way nowhere']) assert.deepEqual(await files.stat(name), { kind: 'other', bytes: 0 }, name);
  // Into another folder the page was granted: the app would let it through, so the interface must not.
  await assert.rejects(files.createFile('way to granted/x.txt', bytes('x')), /Not inside the archive/);
  await assert.rejects(files.createFolder('way to granted/inner'), /Not inside the archive/);
  await assert.rejects(files.createFileFrom('way to granted/x.txt', (async function* () { yield bytes('x'); })()), /Not inside the archive/);
  // Out of every granted folder: the app refuses.
  await assert.rejects(files.createFile('way out/x.txt', bytes('x')), { code: 'EFORBIDDEN' });
  await assert.rejects(files.list('way out'), { code: 'EFORBIDDEN' });
  assert.deepEqual([readdirSync(other), readdirSync(outside)], [[], []], 'nothing was written where the links lead');
  for (const name of ['way to granted', 'way out']) await assert.rejects(files.rename(name, 'moved'), /A link is not moved/, name);
  // A link to a file is not read through, though the app would follow it.
  symlinkSync(join(dir, path, 'filled - f1040.pdf'), join(dir, 'a link.pdf'));
  await assert.rejects(files.readStream('a link.pdf').getReader().read(), { code: 'ELOOP' });
  await assert.rejects(files.sha256('a link.pdf'), { code: 'ELOOP' });
  // Form Filler's own folder put aside and a link put in its place: refused, and what the link leads to is untouched.
  mkdirSync(join(dir, 'Website')); writeFileSync(join(dir, 'Website/index.json'), 'a page of my own');
  renameSync(join(dir, '.formfiller'), join(dir, 'formfiller moved aside'));
  symlinkSync('Website', join(dir, '.formfiller'));
  await assert.rejects(book.rebuildIndex(), /\.formfiller in the archive is not a plain folder/);
  await assert.rejects(files.replaceIndex(bytes('{}')), /\.formfiller in the archive is not a plain folder/);
  assert.equal(readFileSync(join(dir, 'Website/index.json'), 'utf8'), 'a page of my own');
  assert.ok((await book.verify()).problems.some(entry => entry.path === '.formfiller' && /not a plain folder/.test(entry.problem)));
  // A folder the page was never granted cannot be reached at all.
  const stranger = tauriFiles(tauriStandIn({ granted: [dir] }), outside);
  await assert.rejects(stranger.list(''), { code: 'EFORBIDDEN' });
  await assert.rejects(stranger.createFile('x.txt', bytes('x')), { code: 'EFORBIDDEN' });
  assert.throws(() => tauriFiles(tauriStandIn(), 'relative/folder'), /Not a folder on this computer/);
});

// What a person would check after a restore: every file and folder, byte for byte, and the vault as it reads itself.
const stateOf = async world => {
  const vault = await unlockVault(nodeStore(join(world.data, 'vault')), PASSPHRASE), documents = [];
  for (const entry of await vault.listDocuments()) documents.push([entry.id, hashOf(await vault.readDocument(entry.id))]);
  const profile = await vault.readProfile();
  vault.lock();
  return { data: walk(world.data, { folders: true }), archive: walk(world.archive, { folders: true }), profile, documents };
};

for (const links of [true, false]) {
  test('wipe and restore through the app\'s files: everything comes back byte for byte, and the vault opens as before (' + (links ? 'with second names' : 'on a disk without second names') + ')', async () => {
    const world = await makeWorld(scratch), before = await stateOf(world), drive = temp('drive-');
    const tauri = tauriStandIn({ granted: [world.root, drive], links }), files = folder => tauriFiles(tauri, folder, { links });
    const made = await makeBackup({ data: files(world.data), archive: files(world.archive), destination: files(drive), now: clock });
    assert.deepEqual(made.skipped, []);
    assert.deepEqual(readdirSync(join(drive, made.path)).sort(), ['README.txt', 'identity.age', 'snapshot.sha256', 'snapshot.tar.age']);
    assert.ok(!tauri.log.some(line => /\.ff-(new|staging)/.test(line) && line.startsWith('remove path') && !/Form Filler Backups/.test(line)), 'a backup removes nothing where it reads');
    for (const name of ['vault', 'templates', 'settings.json']) rmSync(join(world.data, name), { recursive: true, force: true });
    rmSync(world.archive, { recursive: true, force: true });
    const result = await restoreBackup({ backup: files(join(drive, made.path)), secret: PASSPHRASE, data: files(world.data), archive: { parent: files(world.root), name: 'Test Archive' } });
    const now = await stateOf(world);
    assert.deepEqual(now.data, before.data, 'the data folder, folder for folder and byte for byte');
    assert.deepEqual(now.archive, before.archive, 'the archive, folder for folder and byte for byte');
    assert.deepEqual(readdirSync(world.root).sort(), ['Test Archive', 'Test Data'], 'no staging is left');
    assert.deepEqual([now.profile, now.documents], [before.profile, before.documents]);
    assert.deepEqual(result.placed.map(item => item.beside), [false, false, false, false], 'nothing went beside');
    const book = openArchive(files(world.archive), { now: clock }), report = await book.verify();
    assert.deepEqual({ ok: report.ok, gone: report.gone, unrecorded: report.unrecorded }, { ok: true, gone: [], unrecorded: [] });
    assert.deepEqual(await book.rebuildIndex(), world.index, 'the rebuilt index equals the one before');
  });
}

test('a vault forgotten in the app leaves no folder behind, so a restore puts the vault back in its place', async () => {
  const world = await makeWorld(scratch), drive = temp('drive-'), tauri = tauriStandIn({ granted: [world.root, drive] }), files = folder => tauriFiles(tauri, folder);
  const made = await makeBackup({ data: files(world.data), archive: files(world.archive), destination: files(drive), now: clock });
  const folder = join(world.data, 'vault'), store = tauriStore(tauri, folder);
  // Something in the vault's folder that the vault could not have written is left, and then so is the folder.
  writeFileSync(join(folder, 'my own notes.txt'), 'not the vault\'s');
  await forgetVault(store);
  assert.deepEqual(readdirSync(folder), ['my own notes.txt']);
  rmSync(join(folder, 'my own notes.txt'));
  await forgetVault(store);
  assert.equal(existsSync(folder), false, 'nothing of the vault\'s is left, and the empty folder is gone too');
  assert.deepEqual([await store.get('vault.json'), await store.list()], [null, []], 'a store with no folder is an empty store');
  const restore = () => restoreBackup({ backup: files(join(drive, made.path)), secret: PASSPHRASE, data: files(world.data), archive: { parent: files(world.root), name: 'Test Archive' } });
  assert.deepEqual((await restore()).placed.find(item => item.what === 'vault'), { what: 'vault', path: 'vault', beside: false });
  const vault = await unlockVault(tauriStore(tauri, folder), PASSPHRASE);
  assert.equal((await vault.readProfile()).details.fullName, 'Jane Roe');
  vault.lock();
  // The command line's store leaves its folder, empty, and a restore takes that for a vault that is there.
  await forgetVault(nodeStore(folder));
  assert.deepEqual(readdirSync(folder), []);
  assert.deepEqual((await restore()).placed.find(item => item.what === 'vault'), { what: 'vault', path: 'vault (restored ' + STAMP + ')', beside: true });
  // A store whose folder is a link is not removed through it.
  const real = join(world.root, 'vault kept elsewhere'), linked = join(world.root, 'a link to it');
  mkdirSync(real); symlinkSync(real, linked);
  await tauriStore(tauri, linked).put('vault.json', bytes('{}'), { prev: false });
  await tauriStore(tauri, linked).clear();
  assert.deepEqual([existsSync(linked), readdirSync(real)], [true, []], 'the link stays; what was the store\'s behind it is gone');
});

test('a restore into your home folder reaches only Form Filler\'s own names there', async () => {
  const world = await makeWorld(scratch), before = walk(world.archive, { folders: true }), home = temp('home-'), data = join(home, 'Library/Application Support/form filler test'), drive = temp('drive-');
  mkdirSync(data, { recursive: true });
  mkdirSync(join(home, 'Documents')); writeFileSync(join(home, 'Documents/private.txt'), 'mine'); writeFileSync(join(home, '.zshrc'), 'mine');
  mkdirSync(join(home, '.ff-staging-00000000000000aa'));   // left by an earlier restore that was killed
  const made = await makeBackup({ data: nodeFiles(world.data), archive: nodeFiles(world.archive), destination: nodeFiles(drive), now: clock });
  const tauri = tauriStandIn({ granted: [data, drive], home, data }), parent = homeFiles(tauri, home);
  assert.deepEqual(await tauri.invoke('places'), { data, home, archive: join(home, 'Form Filler Archive') });
  assert.deepEqual(await parent.list(''), [{ name: '.ff-staging-00000000000000aa', kind: 'folder' }], 'of the home folder, only Form Filler\'s own names are told');
  const restore = () => restoreBackup({ backup: tauriFiles(tauri, join(drive, made.path)), secret: PASSPHRASE, data: tauriFiles(tauri, data), archive: { parent, name: 'Form Filler Archive' } });
  const first = await restore();
  assert.deepEqual(first.placed.at(-1), { what: 'archive', path: 'Form Filler Archive', beside: false });
  assert.deepEqual(first.unfinished, [{ folder: 'parent', path: '.ff-staging-00000000000000aa' }], 'the earlier restore\'s staging is named, and left');
  assert.deepEqual(walk(join(home, 'Form Filler Archive'), { folders: true }), before, 'the archive, in its usual place, byte for byte');
  assert.deepEqual((await restore()).placed.at(-1), { what: 'archive', path: 'Form Filler Archive (restored ' + STAMP + ')', beside: true });
  assert.deepEqual(walk(join(home, 'Form Filler Archive (restored ' + STAMP + ')'), { folders: true }), before);
  assert.deepEqual(readdirSync(home).sort(), ['.ff-staging-00000000000000aa', '.zshrc', 'Documents', 'Form Filler Archive', 'Form Filler Archive (restored ' + STAMP + ')', 'Library']);
  assert.deepEqual([readFileSync(join(home, 'Documents/private.txt'), 'utf8'), readFileSync(join(home, '.zshrc'), 'utf8')], ['mine', 'mine']);
  // Any other name is refused: by this interface, and by the app when it is asked directly.
  for (const refused of [parent.stat('Documents'), parent.list('Documents'), parent.read('.zshrc'), parent.createFile('notes.txt', bytes('x')), parent.createFolder('Form Filler Archives'),
    parent.rename('Form Filler Archive', 'Documents'), parent.rename('Documents', 'Form Filler Archive (restored ' + STAMP + ') (2)'), parent.discardStaging('Documents'),
    parent.readStream('.zshrc').getReader().read(), tauriFiles(tauri, home).list(''), tauriFiles(tauri, home).read('.zshrc'), tauriFiles(tauri, home).stat('Documents/private.txt')])
    await assert.rejects(refused, { code: 'EFORBIDDEN' });
  for (const name of ['Documents', '.zshrc', '', '..', 'Form Filler Archive/../Documents', 'Form Filler Archive (restored 2026-11-17 1530) (0)', '.ff-staging-xyz']) await assert.rejects(tauri.invoke('grant_home', { name }), /forbidden name/, name);
  for (const call of ['replaceIndex', 'lock', 'unlock']) assert.equal(parent[call], undefined, 'no ' + call + ': those are an archive\'s own');
  // One of Form Filler's own names that is a link out of its place is not granted, so nothing goes through it.
  const second = 'Form Filler Archive (restored ' + STAMP + ') (2)', third = 'Form Filler Archive (restored ' + STAMP + ') (3)';
  symlinkSync(join(home, 'Documents'), join(home, second));
  assert.deepEqual((await parent.list('')).at(-1), { name: second, kind: 'other' });
  assert.deepEqual([await parent.stat(second), await parent.stat('Form Filler Archive'), await parent.stat('Form Filler Archive (restored 2001-01-01 0000)')], [{ kind: 'other', bytes: 0 }, { kind: 'folder', bytes: 0 }, null]);
  await assert.rejects(parent.createFolder(second), { code: 'EEXIST' }, 'the name is taken, by the link');
  await assert.rejects(parent.createFile(second + '/x.txt', bytes('x')), { code: 'EFORBIDDEN', message: /not a plain folder/ });
  await assert.rejects(parent.list(second), { code: 'EFORBIDDEN' });
  // Nor does a link put in a name's place after the name was granted: the app checks where a path really leads.
  await parent.createFolder(third);
  await parent.createFile(third + '/kept.txt', bytes('kept'));
  renameSync(join(home, third), join(home, 'moved aside'));
  symlinkSync(join(home, 'Documents'), join(home, third));
  await assert.rejects(parent.createFile(third + '/x.txt', bytes('x')), { code: 'EFORBIDDEN' });
  await assert.rejects(parent.read(third + '/private.txt'), { code: 'EFORBIDDEN' });
  assert.deepEqual(readdirSync(join(home, 'Documents')), ['private.txt'], 'nothing was written where the links lead');
  // A restore now passes over both names, as taken, and puts its copy beside them.
  assert.deepEqual((await restore()).placed.at(-1), { what: 'archive', path: 'Form Filler Archive (restored ' + STAMP + ') (4)', beside: true });
});
