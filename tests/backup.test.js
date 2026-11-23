import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Encrypter } from 'age-encryption';
import { BACKUPS, README_TEXT, makeBackup, listBackups, verifyBackup, restoreBackup } from '../src/lib/backup.js';
import { readTar, tarHeader, writeTar } from '../src/lib/tar.js';
import { createVault, openArchive, unlockKey, unlockVault } from '../src/lib/index.js';
import { nodeFiles } from '../src/lib/files/node.js';
import { nodeStore } from '../src/lib/stores/node.js';
import { memoryStore } from '../src/lib/stores/memory.js';
import { memoryFiles } from './memory-files.js';
import { FAST, PASSPHRASE, STAMP, clock, hashOf, makeWorld, walk } from './backup-world.js';

// Backups and restores of an invented world only (tests/backup-world.js): Jane Roe's made-up details, invented forms
// and documents, made-up bytes. Every folder the tests make is under one temporary folder, removed when they are
// done; every .age and .tar file is made here, at run time. scrypt runs at a low work factor, so the tests are quick.
const scratch = mkdtempSync(join(tmpdir(), 'ff-backup-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const drive = () => mkdtempSync(join(scratch, 'drive-'));
const backUp = async (world, { links = true, to = drive(), data = nodeFiles(world.data, { links }), destination = nodeFiles(to, { links }) } = {}) => {
  const made = await makeBackup({ data, archive: nodeFiles(world.archive, { links }), destination, now: clock });
  return { to, made, folder: join(to, made.path) };
};
const restore = (world, folder, secret, { links = true, data = nodeFiles(world.data, { links }), parent = nodeFiles(world.root, { links }), name = 'Test Archive' } = {}) =>
  restoreBackup({ backup: nodeFiles(folder, { links }), secret, data, archive: { parent, name } });
// What a person would check after a restore: every file and folder, byte for byte, and the vault's details,
// documents and records as the vault reads them.
const stateOf = async world => {
  const vault = await unlockVault(nodeStore(join(world.data, 'vault')), PASSPHRASE), documents = [], records = [];
  for (const entry of await vault.listDocuments()) documents.push([entry.id, hashOf(await vault.readDocument(entry.id))]);
  for (const entry of await vault.listRecords()) records.push(await vault.readRecord(entry.id));
  const profile = await vault.readProfile();
  vault.lock();
  return { data: walk(world.data, { folders: true }), archive: walk(world.archive, { folders: true }), profile, documents, records };
};
const wipe = world => { for (const name of ['vault', 'templates', 'settings.json']) rmSync(join(world.data, name), { recursive: true, force: true }); rmSync(world.archive, { recursive: true, force: true }); };
// What is inside one folder of a walk or a dump, by paths inside it.
const under = (map, prefix) => new Map([...map].filter(([path]) => path.startsWith(prefix) && path !== prefix).map(([path, value]) => [path.slice(prefix.length), value]));
const staging = dir => [...walk(dir, { folders: true }).keys()].filter(path => path.includes('.ff-staging-'));
const copyOf = folder => { const copy = join(mkdtempSync(join(scratch, 'copy-')), 'backup'); cpSync(folder, copy, { recursive: true }); return copy; };
const sums = folder => writeFileSync(join(folder, 'snapshot.sha256'), hashOf(readFileSync(join(folder, 'snapshot.tar.age'))) + '  snapshot.tar.age\n' + hashOf(readFileSync(join(folder, 'identity.age'))) + '  identity.age\n');
const flip = (file, at) => { const bytes = readFileSync(file); bytes[at] ^= 1; writeFileSync(file, bytes); };
// The page's way of showing the recovery key: "AGE-SECRET-KEY-1" and then groups of six.
const grouped = key => key.slice(0, 16) + ' ' + key.slice(16).match(/.{1,6}/g).join(' ');
const streamOf = bytes => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });

for (const links of [true, false]) {
  test('wipe and restore, the plan\'s check: everything comes back byte for byte, the index is the same, and the vault opens as before (' + (links ? 'the real disk' : 'the real disk, without second names') + ')', async () => {
    const world = await makeWorld(scratch), before = await stateOf(world);
    const { folder, made } = await backUp(world, { links });
    assert.deepEqual(made.skipped, []);
    wipe(world);
    assert.deepEqual(readdirSync(world.data), [], 'wiped: the data folder is there and empty, the archive is gone');
    const result = await restore(world, folder, PASSPHRASE, { links });
    const now = await stateOf(world);
    assert.deepEqual(now.data, before.data, 'the data folder, folder for folder and byte for byte');
    assert.deepEqual(now.archive, before.archive, 'the archive, folder for folder and byte for byte (index.json too)');
    assert.deepEqual(readdirSync(world.root).sort(), ['Test Archive', 'Test Data'], 'nothing else in the world: no staging is left');
    assert.deepEqual(readdirSync(world.data).sort(), ['settings.json', 'templates', 'vault']);
    const book = openArchive(nodeFiles(world.archive), { now: clock });
    const report = await book.verify();
    assert.deepEqual({ ok: report.ok, gone: report.gone, unrecorded: report.unrecorded }, { ok: true, gone: [], unrecorded: [] });
    assert.deepEqual(await book.rebuildIndex(), world.index, 'the rebuilt index equals the one before, with nothing left');
    assert.deepEqual(world.index.left, []);
    assert.deepEqual(now.profile, before.profile);
    assert.deepEqual(now.documents, before.documents);
    assert.equal(before.documents.length, 2);
    assert.deepEqual(result.placed, [{ what: 'vault', path: 'vault', beside: false }, { what: 'templates', path: 'templates', beside: false },
      { what: 'settings.json', path: 'settings.json', beside: false }, { what: 'archive', path: 'Test Archive', beside: false }], 'nothing went beside');
    assert.deepEqual([result.files, result.folders, result.bytes], [made.files, made.folders, made.bytes]);
  });
}

test('a backup is four files in a folder named for its minute, a second one that minute is " (2)", and README.txt is docs/RESTORE.md', async () => {
  const world = await makeWorld(scratch);
  const { to, made, folder } = await backUp(world);
  assert.equal(made.path, BACKUPS + '/' + STAMP);
  assert.match(made.made, /^2026-11-17T15:30:00[+-]\d{2}:\d{2}$/);
  assert.match(made.recipient, /^age1[0-9a-z]{58}$/);
  assert.deepEqual(readdirSync(folder).sort(), ['README.txt', 'identity.age', 'snapshot.sha256', 'snapshot.tar.age']);
  assert.deepEqual(readFileSync(join(folder, 'identity.age')), readFileSync(join(world.data, 'vault/identity.age')), 'identity.age is the vault\'s own, byte for byte');
  assert.equal(readFileSync(join(folder, 'snapshot.sha256'), 'utf8'),
    hashOf(readFileSync(join(folder, 'snapshot.tar.age'))) + '  snapshot.tar.age\n' + hashOf(readFileSync(join(folder, 'identity.age'))) + '  identity.age\n');
  assert.equal(made.sealed, statSync(join(folder, 'snapshot.tar.age')).size);
  const sizeIn = dir => [...walk(dir).keys()].reduce((sum, path) => sum + statSync(join(dir, path)).size, 0);
  assert.equal(made.files, walk(world.data).size + walk(world.archive).size, 'every file in the vault, templates, settings and archive');
  assert.equal(made.bytes, sizeIn(world.data) + sizeIn(world.archive));
  assert.equal(made.folders, walk(world.data, { folders: true }).size - walk(world.data).size + walk(world.archive, { folders: true }).size - walk(world.archive).size + 2, 'every folder, and data/ and archive/');
  const text = readFileSync(join(folder, 'README.txt'), 'utf8');
  assert.equal(text, README_TEXT);
  for (const line of text.split('\n')) if (!line.startsWith('    ')) assert.ok(line.length <= 78, 'a line of at most 78 columns: ' + line);
  assert.ok(!text.includes('```') && !/^#/m.test(text), 'plain text, not Markdown');
  const doc = readFileSync(fileURLToPath(new URL('../docs/RESTORE.md', import.meta.url)), 'utf8');
  assert.equal(/```text\n([\s\S]*?)```/.exec(doc)?.[1], README_TEXT, 'docs/RESTORE.md holds the same text');
  const second = await backUp(world, { to });
  assert.equal(second.made.path, BACKUPS + '/' + STAMP + ' (2)');
  assert.deepEqual(readdirSync(join(to, BACKUPS)).sort(), [STAMP, STAMP + ' (2)'], 'and nothing else: no staging is left');
  const named = drive();
  mkdirSync(join(named, BACKUPS, 'not a backup'), { recursive: true });
  assert.equal((await makeBackup({ data: nodeFiles(world.data), archive: nodeFiles(world.archive), destination: nodeFiles(named), now: clock })).path, BACKUPS + '/' + STAMP, 'into a backups folder that is there already');
  const file = drive();
  writeFileSync(join(file, BACKUPS), 'a file in the way');
  await assert.rejects(makeBackup({ data: nodeFiles(world.data), archive: nodeFiles(world.archive), destination: nodeFiles(file), now: clock }), /Something that is not a folder is called "Form Filler Backups"/);
});

test('a wrong passphrase is refused, by restore and by verify, and nothing is written anywhere', async () => {
  const world = await makeWorld(scratch);
  const { to, folder } = await backUp(world);
  wipe(world);
  const before = walk(world.root, { folders: true });
  await assert.rejects(restore(world, folder, 'not the passphrase'), { code: 'EPASSPHRASE', message: 'That passphrase does not open this key file.' });
  await assert.rejects(verifyBackup(nodeFiles(folder), { secret: 'not the passphrase' }), { code: 'EPASSPHRASE' });
  assert.deepEqual(walk(world.root, { folders: true }), before, 'the world is as it was');
  assert.deepEqual([...staging(world.root), ...staging(to)], [], 'and no staging anywhere');
});

test('one byte flipped in the snapshot, with snapshot.sha256 as it was written: refused at the fingerprint, before anything is written', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world), copy = copyOf(folder);
  flip(join(copy, 'snapshot.tar.age'), statSync(join(copy, 'snapshot.tar.age')).size - 20);
  wipe(world);
  const before = walk(world.root, { folders: true });
  await assert.rejects(restore(world, copy, PASSPHRASE), { code: 'EDAMAGED', message: 'snapshot.tar.age does not match its fingerprint: this copy is damaged; try another backup.' });
  assert.deepEqual(walk(world.root, { folders: true }), before);
  const report = await verifyBackup(nodeFiles(copy));
  assert.equal(report.ok, false);
  assert.deepEqual(report.problems, [{ path: 'snapshot.tar.age', problem: 'it does not match its fingerprint: this copy is damaged' }]);
  assert.deepEqual(report.matches, ['identity.age']);
  writeFileSync(join(copy, 'snapshot.sha256'), 'not as Form Filler writes it\n');
  await assert.rejects(restore(world, copy, PASSPHRASE), { code: 'EDAMAGED', message: /snapshot.sha256 is not as Form Filler writes it/ });
  rmSync(join(copy, 'snapshot.sha256'));
  await assert.rejects(restore(world, copy, PASSPHRASE), { code: 'EDAMAGED', message: /snapshot.sha256 is missing/ });
  await assert.rejects(restore(world, join(scratch), PASSPHRASE), /This folder is not a Form Filler backup/);
  assert.deepEqual(walk(world.root, { folders: true }), before);
});

// The data folder or the archive's parent, counting what is made in it, so a test can see members were staged.
const counting = files => { const out = { ...files, made: 0 }; out.createFolder = path => { out.made++; return files.createFolder(path); }; out.createFileFrom = (path, source) => { out.made++; return files.createFileFrom(path, source); }; return out; };

test('one byte flipped, with snapshot.sha256 made to match: age refuses it after members were staged, the staging goes, and nothing is restored', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world), copy = copyOf(folder);
  flip(join(copy, 'snapshot.tar.age'), statSync(join(copy, 'snapshot.tar.age')).size - 20);
  sums(copy);
  wipe(world);
  const before = walk(world.root, { folders: true }), data = counting(nodeFiles(world.data)), parent = counting(nodeFiles(world.root));
  await assert.rejects(restore(world, copy, PASSPHRASE, { data, parent }), { code: 'EDAMAGED', message: 'The snapshot is damaged or cut short (invalid tag); nothing was restored.' });
  assert.ok(data.made + parent.made > 20, 'members were staged before the last chunk was found damaged (' + (data.made + parent.made) + ')');
  assert.deepEqual(walk(world.root, { folders: true }), before, 'the world is as it was, and the staging is gone');
  const report = await verifyBackup(nodeFiles(copy), { secret: PASSPHRASE });
  assert.equal(report.ok, false);
  assert.deepEqual(report.problems, [{ path: 'snapshot.tar.age', problem: 'it is damaged or cut short (invalid tag)' }]);
});

test('a snapshot cut short, by 100 bytes or right after its first full chunk, with snapshot.sha256 made to match: nothing is restored', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world);
  wipe(world);
  const before = walk(world.root, { folders: true }), sealed = readFileSync(join(folder, 'snapshot.tar.age'));
  const head = sealed.subarray(0, 1000).toString('latin1'), header = head.indexOf('\n', head.indexOf('\n--- ') + 1) + 1;
  for (const length of [sealed.length - 100, header + 16 + 65536 + 16]) {
    const copy = copyOf(folder);
    writeFileSync(join(copy, 'snapshot.tar.age'), sealed.subarray(0, length));
    sums(copy);
    await assert.rejects(restore(world, copy, PASSPHRASE), { code: 'EDAMAGED', message: /^The snapshot is damaged or cut short \(.+\); nothing was restored\.$/ }, 'cut to ' + length + ' bytes');
    assert.deepEqual(walk(world.root, { folders: true }), before);
    assert.equal((await verifyBackup(nodeFiles(copy), { secret: PASSPHRASE })).ok, false);
  }
});

test('a restore onto the world as it is overwrites nothing: each copy goes beside, named for the backup, and a second goes beside that', async () => {
  const world = await makeWorld(scratch), before = await stateOf(world);
  const { folder } = await backUp(world);
  const first = await restore(world, folder, PASSPHRASE);
  assert.deepEqual(first.placed, [
    { what: 'vault', path: 'vault (restored ' + STAMP + ')', beside: true }, { what: 'templates', path: 'templates (restored ' + STAMP + ')', beside: true },
    { what: 'settings.json', path: 'settings (restored ' + STAMP + ').json', beside: true }, { what: 'archive', path: 'Test Archive (restored ' + STAMP + ')', beside: true }]);
  const second = await restore(world, folder, PASSPHRASE);
  assert.deepEqual(second.placed.map(place => place.path), ['vault (restored ' + STAMP + ') (2)', 'templates (restored ' + STAMP + ') (2)', 'settings (restored ' + STAMP + ') (2).json', 'Test Archive (restored ' + STAMP + ') (2)']);
  const now = await stateOf(world), data = walk(world.data, { folders: true });
  assert.deepEqual(now.archive, before.archive, 'the archive that was there is untouched');
  for (const name of ['vault', 'templates']) {
    assert.deepEqual(under(data, name + '/'), under(before.data, name + '/'), name + ' that was there is untouched');
    for (const copy of [' (restored ' + STAMP + ')', ' (restored ' + STAMP + ') (2)']) assert.deepEqual(under(data, name + copy + '/'), under(before.data, name + '/'), name + copy + ' equals it');
  }
  for (const copy of ['settings.json', 'settings (restored ' + STAMP + ').json', 'settings (restored ' + STAMP + ') (2).json']) assert.equal(data.get(copy), before.data.get('settings.json'), copy);
  for (const copy of [' (restored ' + STAMP + ')', ' (restored ' + STAMP + ') (2)']) assert.deepEqual(walk(join(world.root, 'Test Archive' + copy), { folders: true }), before.archive, 'Test Archive' + copy + ' equals it');
  const beside = await unlockVault(nodeStore(join(world.data, 'vault (restored ' + STAMP + ')')), PASSPHRASE);
  assert.deepEqual(await beside.readProfile(), before.profile, 'the vault put beside opens where it is');
  assert.deepEqual(staging(world.root), []);
  // An empty folder at a place counts as taken, too.
  const empty = await makeWorld(scratch);
  wipe(empty);
  mkdirSync(join(empty.data, 'vault'));
  const third = await restore(empty, folder, PASSPHRASE);
  assert.deepEqual(third.placed.map(place => [place.what, place.beside]), [['vault', true], ['templates', false], ['settings.json', false], ['archive', false]]);
  assert.deepEqual(readdirSync(join(empty.data, 'vault')), [], 'the empty folder is left as it was');
});

test('the recovery key alone restores it: typed as the page shows it or in lower case, and with identity.age gone from the backup', async () => {
  const world = await makeWorld(scratch), before = await stateOf(world);
  const { folder } = await backUp(world), keyless = copyOf(folder);
  rmSync(join(keyless, 'identity.age'));
  for (const [secret, from] of [[grouped(world.recoveryKey), folder], [world.recoveryKey.toLowerCase(), folder], [world.recoveryKey, keyless]]) {
    wipe(world);
    await restore(world, from, secret);
    const now = await stateOf(world);
    assert.deepEqual([now.data, now.archive, now.profile, now.documents], [before.data, before.archive, before.profile, before.documents]);
  }
  await assert.rejects(restore(world, keyless, PASSPHRASE), /There is no key file \(identity.age\) here; only the recovery key opens this/);
  const report = await verifyBackup(nodeFiles(keyless));
  assert.deepEqual([report.ok, report.problems], [false, [{ path: 'identity.age', problem: 'it is missing, so only the recovery key can open this backup' }]]);
  wipe(world);
  const wiped = walk(world.root, { folders: true }), other = (await createVault(memoryStore(), PASSPHRASE, FAST)).recoveryKey;
  await assert.rejects(restore(world, folder, other), { code: 'EPASSPHRASE', message: 'That recovery key does not open this backup: check it letter by letter.' });
  await assert.rejects(verifyBackup(nodeFiles(folder), { secret: other }), { code: 'EPASSPHRASE' });
  await assert.rejects(restore(world, folder, world.recoveryKey.slice(0, 30)), { code: 'EPASSPHRASE', message: /not whole/ });
  assert.deepEqual(walk(world.root, { folders: true }), wiped, 'a key that is not this backup\'s writes nothing');
});

test('restored onto a Mac-like disk in memory, everything lands byte for byte; with "test archive" there, the archive goes beside, as that disk folds case', async () => {
  const world = await makeWorld(scratch), before = await stateOf(world);
  const { folder } = await backUp(world);
  const data = memoryFiles(), parent = memoryFiles();
  await restoreBackup({ backup: nodeFiles(folder), secret: PASSPHRASE, data: data.files, archive: { parent: parent.files, name: 'Test Archive' } });
  assert.deepEqual(data.dump({ folders: true }), before.data);
  assert.deepEqual(under(parent.dump({ folders: true }), 'Test Archive/'), before.archive);
  assert.deepEqual([...parent.dump({ folders: true }).keys()].filter(path => !path.startsWith('Test Archive/')), [], 'and nothing else: no staging is left');
  const taken = memoryFiles();
  await taken.files.createFolder('test archive');
  const again = await restoreBackup({ backup: nodeFiles(folder), secret: PASSPHRASE, data: memoryFiles().files, archive: { parent: taken.files, name: 'Test Archive' } });
  assert.deepEqual(again.placed.at(-1), { what: 'archive', path: 'Test Archive (restored ' + STAMP + ')', beside: true });
  assert.deepEqual(under(taken.dump({ folders: true }), 'Test Archive (restored ' + STAMP + ')/'), before.archive);
  // A path that would not fit the disk is refused before anything goes there, and the staging goes.
  const small = memoryFiles({ room: 300 });
  await assert.rejects(restoreBackup({ backup: nodeFiles(folder), secret: PASSPHRASE, data: memoryFiles().files, archive: { parent: small.files, name: 'Test Archive' } }), /longer than the disk can open here \(300\)/);
  assert.deepEqual([...small.dump({ folders: true }).keys()], []);
});

test('a snapshot from a disk that tells case apart, restored onto one that does not: refused, saying which two names', async () => {
  const world = await makeWorld(scratch);
  // An archive holding two names that differ only in case, as a Linux disk can, backed up with the world's vault.
  const linux = memoryFiles({ foldCase: false });
  await linux.files.createFolder('Taxes');
  await linux.files.createFile('Taxes/notes.txt', new TextEncoder().encode('one'));
  await linux.files.createFile('Taxes/NOTES.txt', new TextEncoder().encode('two'));
  const to = drive();
  await makeBackup({ data: nodeFiles(world.data), archive: linux.files, destination: nodeFiles(to), now: clock });
  const mac = memoryFiles();
  await assert.rejects(restoreBackup({ backup: nodeFiles(join(to, BACKUPS, STAMP)), secret: PASSPHRASE, data: mac.files, archive: { parent: mac.files, name: 'Test Archive' } }),
    /The snapshot holds two names this disk takes for one: "archive\/Taxes\/NOTES.txt" and "archive\/Taxes\/notes.txt"\. Restore onto a disk that tells them apart\./);
  assert.deepEqual([...mac.dump({ folders: true }).keys()], [], 'and the staging goes');
});

// A snapshot taken apart and put together again with `change` made to its members, sealed to the same public key, and
// snapshot.sha256 made to match: what anyone holding only the vault's public key could plant.
async function planted(folder, change) {
  const copy = copyOf(folder), key = await unlockKey(readFileSync(join(folder, 'identity.age')), PASSPHRASE), members = [];
  await readTar(await key.decrypt(streamOf(readFileSync(join(folder, 'snapshot.tar.age')))), async ({ path, kind, pieces }) => {
    members.push({ path, kind, bytes: kind === 'file' ? new Uint8Array(await new Response(pieces).arrayBuffer()) : null });
  });
  async function* entries() { for (const { path, kind, bytes } of await change(members)) yield kind === 'folder' ? { path, kind } : { path, kind, size: bytes.length, open: () => streamOf(bytes) }; }
  const encrypter = new Encrypter();
  encrypter.addRecipient(key.recipient);
  writeFileSync(join(copy, 'snapshot.tar.age'), new Uint8Array(await new Response(await encrypter.encrypt(writeTar(entries(), { mtime: 0 }))).arrayBuffer()));
  sums(copy);
  return { copy, recipient: key.recipient };
}
const text = value => new TextEncoder().encode(value);
const FILED = 'archive/Taxes/2026/2026-11-17 sent IRS - Form 1040/filled - f1040.pdf';

test('a snapshot planted by someone with only the public key: a file not as its manifest lists it, a member no backup holds, or a forged vault record, is refused and nothing is restored', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world);
  wipe(world);
  const before = walk(world.root, { folders: true });
  const swapped = await planted(folder, members => members.map(member => member.path === FILED ? { ...member, bytes: text('%PDF- forged') } : member));
  await assert.rejects(restore(world, swapped.copy, PASSPHRASE), { code: 'EDAMAGED', message: 'The snapshot does not match its manifest ("' + FILED + '" is not as it lists it); nothing was restored.' });
  const extra = await planted(folder, members => [...members.slice(0, -1), { path: 'outside.txt', kind: 'file', bytes: text('x') }, members.at(-1)]);
  await assert.rejects(restore(world, extra.copy, PASSPHRASE), { code: 'EDAMAGED', message: /"outside.txt" is not something a backup holds/ });
  // A profile forged and sealed to the public key, with the manifest made to match: only the vault's own tags catch it.
  const forged = await planted(folder, async members => {
    const record = await (async () => { const encrypter = new Encrypter(); encrypter.addRecipient(swapped.recipient); return encrypter.encrypt(text(JSON.stringify({ formFiller: 'vault-record', version: 1, kind: 'profile', id: 'profile', details: { fullName: 'Someone Else' }, signature: null, saved: '2026-11-20T10:00:00-05:00' }))); })();
    const manifest = JSON.parse(new TextDecoder().decode(members.at(-1).bytes));
    for (const entry of manifest.entries) if (entry.path === 'data/vault/profile.age') Object.assign(entry, { bytes: record.length, sha256: hashOf(record) });
    return members.map(member => member.path === 'data/vault/profile.age' ? { ...member, bytes: record } : member.path === 'manifest.json' ? { ...member, bytes: text(JSON.stringify(manifest)) } : member);
  });
  await assert.rejects(restore(world, forged.copy, PASSPHRASE), { code: 'EDAMAGED', message: /^The vault in this backup does not open as it should: Your details \(profile.age\) is not what this vault wrote there.* Nothing was restored\.$/ });
  assert.equal((await verifyBackup(nodeFiles(forged.copy), { secret: PASSPHRASE })).ok, true, 'verify checks the manifest only: the vault is checked by a restore');
  assert.deepEqual(walk(world.root, { folders: true }), before, 'nothing was restored, and the staging is gone');
});

test('a disk error while unpacking passes through and leaves nothing; a rename refused while placing says what was placed already', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world);
  wipe(world);
  const before = walk(world.root, { folders: true }), files = nodeFiles(world.data);
  let written = 0;
  const full = { ...files, createFileFrom: (path, source) => ++written > 5 ? Promise.reject(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })) : files.createFileFrom(path, source) };
  await assert.rejects(restore(world, folder, PASSPHRASE, { data: full }), { code: 'ENOSPC' });
  assert.deepEqual(walk(world.root, { folders: true }), before);
  const parent = nodeFiles(world.root), refusing = { ...parent, rename: (from, to) => to.startsWith('Test Archive') ? Promise.reject(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })) : parent.rename(from, to) };
  await assert.rejects(restore(world, folder, PASSPHRASE, { parent: refusing }), { code: 'EPERM', message: 'EPERM: operation not permitted Restored already, each whole and checked: vault at vault, templates at templates, settings.json at settings.json.' });
  assert.deepEqual(readdirSync(world.root), ['Test Data'], 'the archive\'s staging is gone');
  assert.deepEqual(readdirSync(world.data).sort(), ['settings.json', 'templates', 'vault'], 'what was placed stays, and the data folder\'s staging is gone');
});

test('a backup made while something changes is not kept: a file that grows as it is read, or a new passphrase mid-backup', async () => {
  const world = await makeWorld(scratch), files = nodeFiles(world.data);
  const growing = { ...files, readStream: path => path === 'settings.json' ? streamOf(new Uint8Array([...readFileSync(join(world.data, path)), 10])) : files.readStream(path) };
  const one = drive();
  await assert.rejects(backUp(world, { to: one, data: growing }), { code: 'ECHANGED', message: 'data/settings.json changed while it was being backed up. Nothing was kept: make the backup again.' });
  assert.deepEqual(readdirSync(join(one, BACKUPS)), [], 'no backup and no staging on the drive');
  const vault = await unlockVault(nodeStore(join(world.data, 'vault')), PASSPHRASE);
  let reader = null;
  const later = make => new ReadableStream({ async pull(controller) { reader ??= (await make()).getReader(); const { done, value } = await reader.read(); if (done) controller.close(); else controller.enqueue(value); } });
  const changing = { ...files, readStream: path => path !== 'vault/identity.age' ? files.readStream(path) : later(async () => { await vault.changePassphrase('another invented passphrase', FAST); return files.readStream(path); }) };
  const two = drive();
  await assert.rejects(backUp(world, { to: two, data: changing }), { code: 'ECHANGED', message: /changed while/ });
  assert.deepEqual(readdirSync(join(two, BACKUPS)), []);
});

test('a copy that does not read back as it was written is not kept', async () => {
  const world = await makeWorld(scratch), to = drive(), files = nodeFiles(to);
  const lying = { ...files, sha256: async path => path.endsWith('snapshot.tar.age') ? '0'.repeat(64) : files.sha256(path) };
  await assert.rejects(backUp(world, { to, destination: lying }), { code: 'EDAMAGED', message: 'The copy on the drive does not read back as it was written: the drive may be failing. Nothing was kept.' });
  assert.deepEqual(readdirSync(join(to, BACKUPS)), []);
  await assert.rejects(makeBackup({ data: nodeFiles(join(world.root, 'no such folder')), archive: nodeFiles(world.archive), destination: files, now: clock }), { code: 'ENOVAULT', message: /There is no vault in this data folder/ });
  rmSync(join(world.data, 'vault/identity.age'));
  await assert.rejects(makeBackup({ data: nodeFiles(world.data), archive: nodeFiles(world.archive), destination: files, now: clock }), { code: 'ENOVAULT', message: /no key file \(vault\/identity.age\)/ });
});

test('listBackups: each backup with its size, one with a file missing, and one that stopped before it was finished', async () => {
  const world = await makeWorld(scratch);
  const { to } = await backUp(world);
  await backUp(world, { to });
  rmSync(join(to, BACKUPS, STAMP + ' (2)', 'identity.age'));
  mkdirSync(join(to, BACKUPS, '.ff-staging-0123456789abcdef'));
  writeFileSync(join(to, BACKUPS, 'a note.txt'), 'not a backup');
  const listed = await listBackups(nodeFiles(to));
  assert.deepEqual(listed, {
    backups: [STAMP, STAMP + ' (2)'].map(name => ({ name, path: BACKUPS + '/' + name, bytes: statSync(join(to, BACKUPS, name, 'snapshot.tar.age')).size, missing: name === STAMP ? [] : ['identity.age'] })),
    unfinished: [BACKUPS + '/.ff-staging-0123456789abcdef'],
  });
  assert.deepEqual(await listBackups(nodeFiles(drive())), { backups: [], unfinished: [] });
});

test('a link in the archive is not followed: it is named in the manifest and the result, and not restored', async () => {
  const world = await makeWorld(scratch);
  symlinkSync(join(world.archive, 'Taxes'), join(world.archive, 'Housing', 'a link to Taxes'));
  const { made, folder } = await backUp(world);
  assert.deepEqual(made.skipped, [{ path: 'archive/Housing/a link to Taxes', why: 'a link or other special file: not followed' }]);
  wipe(world);
  const result = await restore(world, folder, PASSPHRASE);
  assert.deepEqual(result.skipped, made.skipped, 'the manifest says so too');
  assert.ok(!readdirSync(join(world.archive, 'Housing')).includes('a link to Taxes'));
});

test('a file that cannot be read fails the backup, and nothing is kept', { skip: process.getuid?.() === 0 && 'root reads everything' }, async () => {
  const world = await makeWorld(scratch), file = join(world.archive, 'Taxes/2026/2026-11-17 sent IRS - Form 1040/filled - f1040.pdf'), to = drive();
  chmodSync(file, 0o000);
  try {
    await assert.rejects(backUp(world, { to }), { code: 'EACCES' });
    assert.deepEqual(readdirSync(join(to, BACKUPS)), []);
  } finally { chmodSync(file, 0o644); }
});

test('verifyBackup: a good backup is whole, checked quickly against its fingerprints, or fully against its manifest', async () => {
  const world = await makeWorld(scratch);
  const { made, folder } = await backUp(world), before = walk(folder);
  const matches = ['snapshot.tar.age', 'identity.age'];
  assert.deepEqual(await verifyBackup(nodeFiles(folder)), { ok: true, fully: false, made: null, files: 0, folders: 0, bytes: 0, matches, problems: [], notes: [] });
  for (const secret of [PASSPHRASE, world.recoveryKey])
    assert.deepEqual(await verifyBackup(nodeFiles(folder), { secret }), { ok: true, fully: true, made: made.made, files: made.files, folders: made.folders, bytes: made.bytes, matches, problems: [], notes: [] });
  assert.deepEqual(walk(folder), before, 'verify writes nothing');
  rmSync(join(folder, 'README.txt'));
  assert.equal((await verifyBackup(nodeFiles(folder))).ok, true, 'a missing README.txt is not a problem');
  await assert.rejects(verifyBackup(nodeFiles(drive())), /This folder is not a Form Filler backup/);
  assert.equal(existsSync(join(folder, 'README.txt')), false);
});

// The command line, run as another program would run it, with the passphrase on its standard input.
const bin = fileURLToPath(new URL('../bin/form-filler.mjs', import.meta.url));
const run = (args, input = '') => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', input });

test('the command line makes, lists, verifies and restores a backup, reading the passphrase from standard input', async () => {
  const world = await makeWorld(scratch), before = await stateOf(world), to = drive();
  const made = run(['backup', 'make', to, '--data', world.data, '--archive', world.archive]);
  assert.equal(made.status, 0, made.stderr);
  const folder = made.stdout.trim();
  assert.match(folder, /\/Form Filler Backups\/\d{4}-\d{2}-\d{2} \d{4}$/);
  assert.equal(folder.startsWith(join(to, BACKUPS) + '/'), true);
  assert.match(made.stderr, /^28 file\(s\) and 20 folder\(s\), \d+\.\d KB, locked to the vault key age1[0-9a-z]{8}…[0-9a-z]{6}; the copy reads back as written\. Made while the vault is locked: form-filler backup verify ".+" --fully proves it opens with your passphrase\.\n$/);
  const listed = run(['backup', 'list', join(to, BACKUPS)]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^backup {8}\d{4}-\d{2}-\d{2} \d{4}: \d+\.\d KB\n1 backup\(s\) in .+\/Form Filler Backups\.\n$/, 'the backups folder itself may be named');
  const quick = run(['backup', 'verify', folder]);
  assert.equal(quick.status, 0, quick.stderr);
  assert.match(quick.stdout, /^matches {7}snapshot\.tar\.age\nmatches {7}identity\.age\nThe backup made \d{4}-\d{2}-\d{2} \d{4} is whole\.\n$/);
  const fully = run(['backup', 'verify', folder, '--fully'], PASSPHRASE + '\n');
  assert.equal(fully.status, 0, fully.stderr);
  assert.match(fully.stdout, /^matches {7}snapshot\.tar\.age\nmatches {7}identity\.age\nchecked {7}28 file\(s\) and 20 folder\(s\) against the manifest\nThe backup made \d{4}-\d{2}-\d{2}T[\d:]+[+-]\d{2}:\d{2} is whole\.\n$/);
  wipe(world);
  const restored = run(['backup', 'restore', folder, '--data', world.data, '--archive', world.archive], PASSPHRASE + '\n');
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(restored.stdout.split('\n').slice(0, 4).join('\n'), ['vault', 'templates', 'settings.json'].map(what => 'restored      ' + what + ': ' + join(world.data, what)).join('\n') + '\nrestored      archive: ' + world.archive);
  assert.match(restored.stdout, /Restored the backup made .+: 28 file\(s\) and 20 folder\(s\), each as its manifest lists it; the vault opens and reads back \(your details, 2 locker document\(s\), 1 record\(s\)\)\. Check the archive with: form-filler archive verify ".+\/Test Archive"\n$/);
  const now = await stateOf(world);
  assert.deepEqual([now.data, now.archive, now.profile, now.documents], [before.data, before.archive, before.profile, before.documents]);
  assert.deepEqual(readdirSync(world.root).sort(), ['Test Archive', 'Test Data']);
  const again = run(['backup', 'restore', folder, '--data', world.data, '--archive', world.archive], grouped(world.recoveryKey) + '\n');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /^beside {8}archive: .+\/Test Archive was there already, so it went to .+\/Test Archive \(restored \d{4}-\d{2}-\d{2} \d{4}\)$/m, 'going beside counts as done');
  const damaged = copyOf(folder);
  flip(join(damaged, 'snapshot.tar.age'), 300);
  const bad = run(['backup', 'verify', damaged]);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, 'matches       identity.age\nproblem       snapshot.tar.age: it does not match its fingerprint: this copy is damaged\nThe backup made backup is not whole: do not rely on it.\n', 'a copy named "backup": quick, so the date is the folder\'s name');
});

test('the command line refuses, in one line with no stack trace, and writes nothing', async () => {
  const world = await makeWorld(scratch), to = drive();
  const folder = run(['backup', 'make', to, '--data', world.data, '--archive', world.archive]).stdout.trim();
  const before = walk(world.root, { folders: true }), fresh = join(scratch, 'a data folder to be made', 'Test Data');
  // The world reached through a link, and, on a disk that ignores case as a Mac's does, spelled in other capitals: the
  // backups are still refused a place inside the archive or the data folder, the first time and every time after.
  const linked = join(mkdtempSync(join(scratch, 'link-')), 'the world'), inside = what => new RegExp('^form-filler: The backups would go inside ' + what + ' \\(.+\\): pick a drive or folder outside it\\.$');
  symlinkSync(world.root, linked);
  const capitals = existsSync(join(world.root, 'test archive')) ? [[['backup', 'make', join(world.root, 'test archive', 'Taxes'), '--data', world.data, '--archive', world.archive], inside('the archive')]] : [];
  for (const [args, why, input] of [
    [['backup', 'make', join(linked, 'Test Archive', 'Taxes'), '--data', world.data, '--archive', world.archive], inside('the archive')],
    [['backup', 'make', join(world.archive, 'Taxes'), '--data', world.data, '--archive', join(linked, 'Test Archive')], inside('the archive')],
    [['backup', 'make', join(linked, 'Test Data'), '--data', world.data, '--archive', world.archive], inside('the data folder')],
    ...capitals,
    [['backup', 'make', to, '--data', world.data, '--archive', world.archive, '--fully'], /^form-filler: --fully is not an option of "backup make"; it takes --data, --archive\.$/],
    [['backup', 'verify', folder, '--passphrase', PASSPHRASE], /^form-filler: --passphrase is not an option of "backup verify"; it takes --fully\.$/],
    [['backup', 'restore', folder, '--data', world.data, '--archive', world.archive, '--passphrase=x'], /--passphrase is not an option of "backup restore"/],
    [['backup', 'make', to, '--data', world.data, '--data', world.data, '--archive', world.archive], /^form-filler: --data is given twice\.$/],
    [['backup', 'verify', folder, '--fully=yes'], /^form-filler: --fully takes no value\.$/],
    [['backup', 'make', to, '--archive', world.archive, '--data'], /^form-filler: --data needs a value\.$/],
    [['backup', 'restore', folder, '--data', fresh, '--archive', join(world.root, 'Restored Archive')], /^form-filler: That passphrase does not open this key file\. If you changed your passphrase after this backup was made, use the one you had then, or your recovery key\.$/, 'not the passphrase\n'],
    [['backup', 'verify', folder, '--fully'], /^form-filler: no passphrase or recovery key was given$/, ''],
    [['backup', 'make', join(world.archive, 'Taxes'), '--data', world.data, '--archive', world.archive], /^form-filler: The backups would go inside the archive \(.+\): pick a drive or folder outside it\.$/],
    [['backup', 'make', join(to, 'no such drive'), '--data', world.data, '--archive', world.archive], /is not a folder: name a drive or folder that is there\./],
    [['backup', 'make', to, '--data', world.archive, '--archive', world.archive], /There is no vault in .+ \(vault\/vault.json\)/],
    [['backup', 'make', to, '--data', world.data], /^form-filler: form-filler backup make\|list\|verify\|restore \.\.\. \("form-filler help" says more\)$/],
    [['backup', 'make', to, '--data', join(world.root, 'Test'), 'Data', '--archive', world.archive], /^form-filler: "Data" is one word too many: a folder whose name has a space in it must be in quotes\.$/],
    [['backup'], /^form-filler: form-filler backup make\|list\|verify\|restore \.\.\. \("form-filler help" says more\)$/],
  ]) {
    const out = run(args, input);
    assert.equal(out.status, 1, args.join(' ') + '\n' + out.stdout + out.stderr);
    assert.match(out.stderr.trimEnd(), why, args.join(' '));
    assert.equal(out.stderr.trimEnd().split('\n').length, 1, 'one line: ' + out.stderr);
    assert.doesNotMatch(out.stderr, /\n {4}at /, 'a message, not a stack trace');
  }
  assert.deepEqual(walk(world.root, { folders: true }), before, 'nothing was written');
  assert.equal(existsSync(join(scratch, 'a data folder to be made')), false, 'the data folder the command made is removed again, with the folder made to hold it');
  assert.deepEqual(readdirSync(join(to, BACKUPS)).length, 1, 'and no second backup was made');
});

test('Ctrl-C while the command line restores: what was staged goes, and so does the data folder it made, and it exits 130', async () => {
  const world = await makeWorld(scratch), to = drive();
  // A large invented scan, so that unpacking takes long enough to be stopped part way through.
  writeFileSync(join(world.archive, 'a large invented scan.tif'), Buffer.alloc(32 * 1024 * 1024, Uint8Array.from({ length: 251 }, (_, i) => i)));
  const folder = run(['backup', 'make', to, '--data', world.data, '--archive', world.archive]).stdout.trim();
  // The stop is sent as soon as the staging folder shows. On a busy machine the restore may now and then be done
  // before the stop reaches it: that try shows nothing either way, so it is made again, in a fresh place.
  let stopped = null;
  for (let tries = 0; !stopped && tries < 5; tries++) {
    const place = mkdtempSync(join(scratch, 'place-'));
    const child = spawn(process.execPath, [bin, 'backup', 'restore', folder, '--data', join(place, 'Test Data'), '--archive', join(place, 'Test Archive')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let said = '';
    child.stderr.on('data', piece => { said += piece; });
    child.stdin.end(PASSPHRASE + '\n');
    const ended = new Promise(done => child.on('close', (status, signal) => done({ status, signal })));
    for (let waited = 0; !readdirSync(place).some(name => name.startsWith('.ff-staging-')) && waited < 20000; waited += 2) await new Promise(done => setTimeout(done, 2));
    child.kill('SIGINT');
    const end = await ended;
    if (!existsSync(join(place, 'Test Archive'))) stopped = { end, said, place };
  }
  assert.ok(stopped, 'in five tries, the restore was done each time before the stop reached it');
  assert.deepEqual(stopped.end, { status: 130, signal: null }, stopped.said);
  assert.equal(stopped.said, 'form-filler: Stopped (SIGINT) before it was finished: nothing was restored.\n');
  assert.deepEqual(readdirSync(stopped.place), [], 'no staging left, and the data folder the command made is gone');
});

test('a damaged identity.age stops only the passphrase: the recovery key still restores the backup, and verify says what is wrong', async () => {
  const world = await makeWorld(scratch), before = await stateOf(world);
  const { made, folder } = await backUp(world), copy = copyOf(folder);
  flip(join(copy, 'identity.age'), statSync(join(copy, 'identity.age')).size - 5);
  wipe(world);
  const wiped = walk(world.root, { folders: true }), damage = { path: 'identity.age', problem: 'it does not match its fingerprint: this copy is damaged' };
  await assert.rejects(restore(world, copy, PASSPHRASE), { code: 'EDAMAGED', message: 'identity.age does not match its fingerprint: this copy is damaged; try another backup, or use your recovery key.' });
  assert.deepEqual(walk(world.root, { folders: true }), wiped, 'nothing was written');
  assert.deepEqual((await verifyBackup(nodeFiles(copy))).problems, [damage]);
  const fully = await verifyBackup(nodeFiles(copy), { secret: PASSPHRASE });
  assert.deepEqual([fully.ok, fully.made, fully.problems], [false, null, [damage, { path: 'snapshot.tar.age', problem: 'it was not opened: the passphrase opens it only with a whole identity.age, and the recovery key without one' }]],
    'the damage is reported, not taken for a wrong passphrase');
  const byKey = await verifyBackup(nodeFiles(copy), { secret: world.recoveryKey });
  assert.deepEqual([byKey.ok, byKey.made, byKey.files, byKey.problems], [false, made.made, made.files, [damage]], 'the recovery key opens the snapshot and checks every file');
  await restore(world, copy, world.recoveryKey);
  const now = await stateOf(world);
  assert.deepEqual([now.data, now.archive, now.profile, now.documents], [before.data, before.archive, before.profile, before.documents], 'restored byte for byte, the vault\'s own identity.age with it');
});

test('a planted backup is refused before it is held in memory: snapshot.sha256 or identity.age too large, or a snapshot whose header does not end', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world);
  wipe(world);
  const before = walk(world.root, { folders: true });
  // The copy's files, with what read() gave whole and how many bytes readStream() gave counted.
  const counted = copy => {
    const files = nodeFiles(copy), seen = { read: [], streamed: 0 };
    seen.files = { ...files, read: path => { seen.read.push(path); return files.read(path); },
      readStream: path => files.readStream(path).pipeThrough(new TransformStream({ transform(piece, controller) { seen.streamed += piece.length; controller.enqueue(piece); } })) };
    return seen;
  };
  const large = copyOf(folder);
  writeFileSync(join(large, 'snapshot.sha256'), readFileSync(join(large, 'snapshot.sha256'), 'utf8') + '\n'.repeat(1024 * 1024));
  writeFileSync(join(large, 'identity.age'), Buffer.concat([readFileSync(join(large, 'identity.age')), Buffer.alloc(1024 * 1024)]));
  const quick = counted(large);
  assert.deepEqual((await verifyBackup(quick.files)).problems, [{ path: 'snapshot.sha256', problem: 'it is not as Form Filler writes it, so this copy cannot be checked' },
    { path: 'identity.age', problem: 'it is too large to be the key file Form Filler writes: this copy is damaged' }]);
  assert.deepEqual(quick.read, [], 'neither file was read');
  await assert.rejects(restore(world, large, PASSPHRASE), { code: 'EDAMAGED', message: /^snapshot\.sha256 is not as Form Filler writes it/ });
  sums(large);
  await assert.rejects(restore(world, large, PASSPHRASE), { code: 'EDAMAGED', message: 'identity.age is too large to be the key file Form Filler writes: this copy is damaged; try another backup, or use your recovery key.' });
  assert.deepEqual(walk(world.root, { folders: true }), before);
  // A header line that never ends, made to match snapshot.sha256: age would gather all of it before refusing it.
  const endless = copyOf(folder);
  writeFileSync(join(endless, 'snapshot.tar.age'), Buffer.concat([Buffer.from('age-encryption.org/v1\n-> X25519 '), Buffer.alloc(16 * 1024 * 1024, 'A')]));
  sums(endless);
  const full = counted(endless);
  assert.deepEqual((await verifyBackup(full.files, { secret: PASSPHRASE })).problems, [{ path: 'snapshot.tar.age', problem: 'it does not open: its header is damaged (not as a backup writes it)' }]);
  assert.ok(full.streamed <= 4 * 1024 * 1024, 'refused after its first pieces, not read whole (' + full.streamed + ' bytes read)');
  await assert.rejects(restore(world, endless, PASSPHRASE), { code: 'EDAMAGED', message: 'snapshot.tar.age does not open: its header is damaged (not as a backup writes it). Nothing was restored.' });
  assert.deepEqual(walk(world.root, { folders: true }), before, 'nothing was written');
});

test('a disk error while the snapshot is read passes through as it is, and is not taken for damage', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world);
  wipe(world);
  const before = walk(world.root, { folders: true }), files = nodeFiles(folder), sealed = readFileSync(join(folder, 'snapshot.tar.age'));
  // The drive fails part way through the snapshot, as a loose cable or a failing stick would.
  const failing = { ...files, readStream: path => {
    if (path !== 'snapshot.tar.age') return files.readStream(path);
    let at = 0;
    return new ReadableStream({ pull(controller) { if (at > 200000) controller.error(Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' })); else controller.enqueue(sealed.subarray(at, at += 65536)); } });
  } };
  await assert.rejects(restoreBackup({ backup: failing, secret: PASSPHRASE, data: nodeFiles(world.data), archive: { parent: nodeFiles(world.root), name: 'Test Archive' } }), { code: 'EIO', message: 'EIO: i/o error, read' });
  assert.deepEqual(walk(world.root, { folders: true }), before, 'nothing was restored, and the staging is gone');
  await assert.rejects(verifyBackup(failing, { secret: PASSPHRASE }), { code: 'EIO' });
});

test('a sealed snapshot whose tar holds what the writer never writes (a link) is refused by the reader, and nothing is restored', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world);
  wipe(world);
  const before = walk(world.root, { folders: true }), key = await unlockKey(readFileSync(join(folder, 'identity.age')), PASSPHRASE);
  const tar = new Uint8Array(await new Response(await key.decrypt(streamOf(readFileSync(join(folder, 'snapshot.tar.age'))))).arrayBuffer());
  // A link's header, made as tar makes one, put in just before manifest.json's.
  const link = tarHeader({ path: 'archive/a link', kind: 'file', size: 0 }, { mtime: 0 }).slice();
  link[156] = '2'.charCodeAt(0);
  new TextEncoder().encodeInto('/etc', link.subarray(157, 257));
  link.fill(0x20, 148, 156);
  new TextEncoder().encodeInto(link.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', link.subarray(148, 156));
  let at = 0;
  while (new TextDecoder().decode(tar.subarray(at, at + 14)) !== 'manifest.json\0') at += 512;
  const encrypter = new Encrypter(), copy = copyOf(folder);
  encrypter.addRecipient(key.recipient);
  writeFileSync(join(copy, 'snapshot.tar.age'), await encrypter.encrypt(Buffer.concat([tar.subarray(0, at), link, tar.subarray(at)])));
  sums(copy);
  await assert.rejects(restore(world, copy, PASSPHRASE), { code: 'EDAMAGED', message: /^The snapshot is damaged or cut short \(.+ is of type "2" \(a link\), which Form Filler never writes\); nothing was restored\.$/ });
  assert.deepEqual(walk(world.root, { folders: true }), before, 'nothing was restored, and both staging folders are gone');
  assert.equal((await verifyBackup(nodeFiles(copy), { secret: PASSPHRASE })).ok, false);
});

test('a snapshot sealed by someone with only the vault\'s public key, holding no vault records: it restores, and says so', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world);
  // Their own archive, beside the vault's public half and the drive's copy of identity.age, with a manifest to match.
  const stranger = await planted(folder, members => {
    const chosen = [...members.filter(member => ['data', 'data/vault', 'data/vault/identity.age', 'data/vault/vault.json', 'archive'].includes(member.path)),
      { path: 'archive/Taxes', kind: 'folder' }, { path: 'archive/Taxes/instructions.txt', kind: 'file', bytes: text('invented instructions, planted') }];
    const manifest = JSON.parse(new TextDecoder().decode(members.at(-1).bytes));
    manifest.entries = chosen.map(({ path, kind, bytes }) => kind === 'folder' ? { path, kind } : { path, kind, bytes: bytes.length, sha256: hashOf(bytes) });
    return [...chosen, { path: 'manifest.json', kind: 'file', bytes: text(JSON.stringify(manifest)) }];
  });
  const report = await verifyBackup(nodeFiles(stranger.copy), { secret: PASSPHRASE });
  assert.deepEqual([report.ok, report.notes], [true, [{ path: 'data/vault', note: 'it holds no details, no locker documents and no records: if yours held some, this is not a backup you made' }]]);
  wipe(world);
  const result = await restore(world, stranger.copy, PASSPHRASE);
  assert.deepEqual(result.vault, { details: false, documents: 0, records: 0 }, 'what the vault held is said, not taken for granted');
  assert.deepEqual((await restore(world, folder, PASSPHRASE)).vault, { details: true, documents: 2, records: 1 }, 'and the real backup\'s');
});

test('a restore names the staging folders a restore that was killed left behind, and leaves them as they are', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world);
  wipe(world);
  for (const at of [world.data, world.root]) mkdirSync(join(at, '.ff-staging-0123456789abcdef', 'archive'), { recursive: true });
  const result = await restore(world, folder, PASSPHRASE);
  assert.deepEqual(result.unfinished, [{ folder: 'data', path: '.ff-staging-0123456789abcdef' }, { folder: 'parent', path: '.ff-staging-0123456789abcdef' }]);
  for (const at of [world.data, world.root]) assert.deepEqual(readdirSync(join(at, '.ff-staging-0123456789abcdef')), ['archive'], 'left as it was');
});

test('a backup or a restore that is stopped part way (by Ctrl-C, say) leaves nothing behind', async () => {
  const world = await makeWorld(scratch), files = nodeFiles(world.data), to = drive();
  const why = Object.assign(new Error('Stopped, as asked.'), { code: 'ESTOPPED' });
  // Stopped as settings.json is read, part way through the snapshot.
  let stopping = new AbortController();
  const reading = { ...files, readStream: path => { if (path === 'settings.json') stopping.abort(why); return files.readStream(path); } };
  await assert.rejects(makeBackup({ data: reading, archive: nodeFiles(world.archive), destination: nodeFiles(to), now: clock, signal: stopping.signal }), error => error === why);
  assert.deepEqual(readdirSync(join(to, BACKUPS)), [], 'no backup and no staging on the drive');
  assert.equal(existsSync(join(world.archive, '.formfiller', 'lock')), false, 'and the archive\'s lock is let go');
  // Stopped as its sixth file is unpacked.
  const { folder } = await backUp(world);
  wipe(world);
  const before = walk(world.root, { folders: true });
  stopping = new AbortController();
  let written = 0;
  const data = { ...files, createFileFrom: (path, source) => { if (++written === 6) stopping.abort(why); return files.createFileFrom(path, source); } };
  await assert.rejects(restoreBackup({ backup: nodeFiles(folder), secret: PASSPHRASE, data, archive: { parent: nodeFiles(world.root), name: 'Test Archive' }, signal: stopping.signal }), error => error === why);
  assert.deepEqual(walk(world.root, { folders: true }), before, 'nothing was restored, and the staging is gone');
});

test('an archive name too long to take " (restored …)" is refused before anything is written', async () => {
  const world = await makeWorld(scratch);
  const { folder } = await backUp(world);
  wipe(world);
  const name = 'A'.repeat(230);
  mkdirSync(join(world.root, name));
  const before = walk(world.root, { folders: true });
  await assert.rejects(restore(world, folder, PASSPHRASE, { name }), { message: 'That would make a name of 263 bytes, longer than a disk can hold (255): ' + name + ' (restored YYYY-MM-DD HHMM) (999). Restore to a folder whose name is shorter.' });
  assert.deepEqual(walk(world.root, { folders: true }), before, 'nothing was written: no vault, no settings, no staging');
});

test('a name another program wrote, over 255 bytes but one a Mac\'s disk holds, is backed up and restored', async () => {
  const world = await makeWorld(scratch), mac = memoryFiles(), name = 'é'.repeat(130) + '.pdf';
  await mac.files.createFolder('Housing');
  await mac.files.createFile('Housing/' + name, text('an invented lease, saved by another program'));
  const to = drive();
  await makeBackup({ data: nodeFiles(world.data), archive: mac.files, destination: nodeFiles(to), now: clock });
  const restored = memoryFiles();
  await restoreBackup({ backup: nodeFiles(join(to, BACKUPS, STAMP)), secret: PASSPHRASE, data: memoryFiles().files, archive: { parent: restored.files, name: 'Test Archive' } });
  assert.deepEqual(under(restored.dump({ folders: true }), 'Test Archive/'), mac.dump({ folders: true }));
});

// A terminal for the command line, made with python3's pty module: it waits for the prompt, types the keys given last,
// and prints what the terminal showed and how the command ended.
const PTY = `
import json, os, pty, select, signal, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:-1])
shown, keys, end = b'', sys.argv[-1].encode('utf-8'), time.time() + 30
while time.time() < end:
    if not select.select([fd], [], [], 0.05)[0]:
        continue
    try:
        piece = os.read(fd, 65536)
    except OSError:
        break
    if not piece:
        break
    shown += piece
    if keys and b'Passphrase or recovery key: ' in shown:
        os.write(fd, keys)
        keys = b''
if time.time() >= end:
    os.kill(pid, signal.SIGKILL)
status = os.waitpid(pid, 0)[1]
print(json.dumps({'status': os.waitstatus_to_exitcode(status), 'shown': shown.decode('utf-8', 'replace')}))
`;
const python = spawnSync('python3', ['--version']).status === 0;

test('at a terminal, the passphrase is asked for and not shown, and Ctrl-D or Ctrl-C at the prompt is a refusal in one line (needs python3, for a terminal)', { skip: !python && 'python3 is not installed' }, async () => {
  const world = await makeWorld(scratch), { folder } = await backUp(world);
  const typed = keys => JSON.parse(spawnSync('python3', ['-I', '-c', PTY, process.execPath, bin, 'backup', 'verify', folder, '--fully', keys], { encoding: 'utf8', timeout: 60000 }).stdout);
  const right = typed(PASSPHRASE + '\r');
  assert.equal(right.status, 0, right.shown);
  assert.match(right.shown, /is whole\./);
  assert.ok(!right.shown.includes(PASSPHRASE), 'what is typed is not shown');
  for (const keys of ['\x04', '\x03', 'abc\x03']) {
    const out = typed(keys);
    assert.equal(out.status, 1, JSON.stringify(keys) + ': ' + out.shown);
    assert.match(out.shown, /form-filler: no passphrase or recovery key was given\r?\n$/, JSON.stringify(keys));
  }
});
