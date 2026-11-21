import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openArchive, readRecord, cleanName, matterPath, itemsWithFile, sha256, UNSORTED } from '../src/lib/index.js';
import { nodeFiles } from '../src/lib/files/node.js';
import { memoryFiles } from './memory-files.js';
import { tauriFiles } from '../src/app/files-tauri.js';
import { tauriStandIn } from './tauri-stand-in.js';

// The archive, on invented documents only: made-up bytes, invented counterparties and titles. Every folder the tests
// make is under one temporary folder, removed when they are done.
const scratch = mkdtempSync(join(tmpdir(), 'ff-archive-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const tempFolder = () => mkdtempSync(join(scratch, 'disk-'));
const clock = () => new Date(2026, 10, 17, 15, 30, 0);
const bytes = value => new TextEncoder().encode(value);
const hashOf = data => createHash('sha256').update(data).digest('hex');
const recordIn = async (files, path) => readRecord(new TextDecoder().decode(await files.read(path + '/record.json')));
// Every file on a real disk by path with its SHA-256; with `folders`, every folder too (as "path/").
const walk = (dir, { folders = false } = {}, at = '') => {
  const out = new Map();
  for (const entry of readdirSync(join(dir, at), { withFileTypes: true })) {
    const path = at ? at + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { if (folders) out.set(path + '/', 'folder'); for (const [inner, hash] of walk(dir, { folders }, path)) out.set(inner, hash); }
    else if (entry.isFile()) out.set(path, hashOf(readFileSync(join(dir, path))));
  }
  return out;
};
// Each test that depends on the disk runs on all five: the real one (Linux in CI, a Mac's here), the real one acting
// as a disk that cannot give a file a second name (some USB drives), a Mac-like one in memory, where names that
// differ only in case or in how an accent is encoded are one name, and the real one again through the Mac app's own
// file interface (src/app/files-tauri.js, over a stand-in for the app: tests/tauri-stand-in.js), with second names
// and without.
const real = links => () => { const dir = tempFolder(); return { dir, files: nodeFiles(dir, { links }), dump: options => walk(dir, options) }; };
const app = links => () => { const dir = tempFolder(); return { dir, files: tauriFiles(tauriStandIn({ granted: [dir], links }), dir, { links }), dump: options => walk(dir, options) }; };
const DISKS = {
  'the real disk': real(true),
  'the real disk, without second names': real(false),
  'a Mac-like disk in memory': () => { const { files, dump } = memoryFiles(); return { dir: null, files, dump }; },
  'the Mac app\'s files': app(true),
  'the Mac app\'s files, without second names': app(false),
};
const open = disk => { const made = DISKS[disk](); return { ...made, book: openArchive(made.files, { now: clock }) }; };
const IRS = { matter: 'Taxes/2026', title: 'Form 1040', direction: 'out', counterparty: 'IRS', channel: 'export' };
const FORM_1040 = 'Taxes/2026/2026-11-17 sent IRS - Form 1040';
const namesIn = async (files, path) => (await files.list(path)).map(entry => entry.name);
const INDEX = '.formfiller/index.json';
const indexOf = async files => JSON.parse(new TextDecoder().decode(await files.read(INDEX)));

// Every file's bytes that were there before are still there after (a move changes paths, nothing else); and unless
// the step moved something, every document is still at its path, byte for byte. The index cache is the one file
// that may be rewritten, and a record.json is replaced only by a new one with the old one kept.
function nothingLost(before, after, { moved = false } = {}) {
  const count = map => { const out = new Map(); for (const [path, hash] of map) if (path !== INDEX) out.set(hash, (out.get(hash) || 0) + 1); return out; };
  const was = count(before), now = count(after);
  for (const [hash, n] of was) assert.ok((now.get(hash) || 0) >= n, 'bytes ' + hash.slice(0, 12) + '… were in ' + n + ' file(s) and are in ' + (now.get(hash) || 0) + ' now');
  if (!moved) for (const [path, hash] of before) if (path !== INDEX && !path.endsWith('/record.json')) assert.equal(after.get(path), hash, path + ' is still there, byte for byte');
}

for (const disk of Object.keys(DISKS)) {
  test('an item is filed where you put it, each file behind a role word, with its SHA-256 (' + disk + ')', async () => {
    const { files, book, dump } = open(disk);
    await book.init();
    assert.deepEqual(await namesIn(files, ''), ['.formfiller', '_Inbox', '_Unsorted']);
    const { path, record } = await book.createItem({ ...IRS, form: { sha256: 'a'.repeat(64), answersSha256: 'b'.repeat(64) },
      files: [{ role: 'original', name: 'f1040.pdf', bytes: bytes('the blank form') }, { role: 'filled', name: 'f1040.pdf', bytes: bytes('the filled form') }] });
    assert.equal(path, FORM_1040);
    assert.deepEqual(await namesIn(files, path), ['filled - f1040.pdf', 'original - f1040.pdf', 'record.json']);
    assert.deepEqual(await recordIn(files, path), record, 'record.json says what was returned');
    assert.equal(record.formFiller, 'archive-record'); assert.equal(record.version, 1);
    assert.match(record.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual([record.matter, record.title, record.direction, record.counterparty, record.channel], ['Taxes/2026', 'Form 1040', 'out', 'IRS', 'export']);
    assert.match(record.dates.created, /^2026-11-17T15:30:00[+-]\d{2}:\d{2}$/);
    assert.deepEqual([record.dates.sent, record.dates.received, record.ledger], [null, null, null]);
    assert.deepEqual(record.filing, { by: 'you', confidence: 1, reason: '' });
    assert.deepEqual(record.form, { sha256: 'a'.repeat(64), answersSha256: 'b'.repeat(64) });
    assert.deepEqual(record.files.map(file => [file.role, file.name, file.sha256, file.bytes]), [
      ['original', 'original - f1040.pdf', hashOf(bytes('the blank form')), 14], ['filled', 'filled - f1040.pdf', hashOf(bytes('the filled form')), 15]]);
    assert.deepEqual(record.history, [{ at: record.dates.created, event: 'created' }]);
    assert.deepEqual(await namesIn(files, '.formfiller/new'), [], 'it was put together out of sight and nothing is left there');
    assert.deepEqual((await indexOf(files)).items.map(item => [item.id, item.path]), [[record.id, path]], 'the index is kept up to date');
    assert.equal([...dump().keys()].filter(file => file.startsWith(FORM_1040)).length, 3);
  });

  test('a name that is taken gets " (2)": the same item twice, the same file twice (' + disk + ')', async () => {
    const { files, book } = open(disk);
    const first = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('one') }] });
    const second = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('one') }, { role: 'filled', name: 'f1040.pdf', bytes: bytes('two') }] });
    assert.equal(first.path, FORM_1040); assert.equal(second.path, FORM_1040 + ' (2)');
    assert.deepEqual(second.record.files.map(file => file.name), ['filled - f1040.pdf', 'filled - f1040 (2).pdf']);
    const added = await book.addFile(first.path, { role: 'filled', name: 'f1040.pdf', bytes: bytes('a newer version') });
    assert.equal(added.file.name, 'filled - f1040 (2).pdf', 'a newer version goes beside the old one');
    assert.deepEqual(await namesIn(files, first.path), ['.formfiller', 'filled - f1040 (2).pdf', 'filled - f1040.pdf', 'record.json']);
  });

  test('a name the record holds stays taken when its file is gone from the disk, so the record never lists one name twice (' + disk + ')', async () => {
    const { files, book, dir } = open(disk);
    const { path } = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }, { role: 'original', name: 'f1040.pdf', bytes: bytes('blank') }] });
    // In Finder: one recorded file thrown away, the other renamed.
    if (dir) { rmSync(join(dir, path, 'filled - f1040.pdf')); renameSync(join(dir, path, 'original - f1040.pdf'), join(dir, path, 'my blank copy.pdf')); }
    else { await files.createFolder('.Trash'); await files.rename(path + '/filled - f1040.pdf', '.Trash/thrown away.pdf'); await files.rename(path + '/original - f1040.pdf', path + '/my blank copy.pdf'); }
    const again = await book.addFile(path, { role: 'filled', name: 'f1040.pdf', bytes: bytes('filled again') });
    const twice = await book.addFile(path, { role: 'original', name: 'F1040.pdf', bytes: bytes('blank again') });
    assert.equal(again.file.name, 'filled - f1040 (2).pdf');
    assert.equal(twice.file.name, 'original - F1040 (2).pdf', 'taken whatever its case, as on a Mac');
    const record = await recordIn(files, path);
    assert.equal(record.files.length, 4);
    const report = await book.verify();
    assert.deepEqual(report.missing.sort(), [path + '/filled - f1040.pdf', path + '/original - f1040.pdf']);
    assert.deepEqual(report.unrecorded, [path + '/my blank copy.pdf']);
  });

  test('awkward names are made safe: slashes, colons, line breaks, leading dots, 200 characters, accents (' + disk + ')', async () => {
    const { files, book } = open(disk);
    const { path, record } = await book.createItem({ matter: 'Housing/Rue de l’Été', title: 'Form 1040/SR: amended\n\t.draft', direction: 'in', counterparty: '..Ville de Montréal ',
      dates: { received: '2026-03-02' }, files: [{ role: 'original', name: '.hidden:notice.pdf', bytes: bytes('x') }, { role: 'cover letter', name: 'é'.repeat(200) + '.pdf', bytes: bytes('y') }] });
    assert.equal(path, 'Housing/Rue de l’Été/2026-03-02 received Ville de Montréal - Form 1040-SR- amended .draft');
    assert.equal(record.files[0].name, 'original - hidden-notice.pdf');
    const long = record.files[1].name;
    assert.ok(long.startsWith('cover letter - éé') && long.endsWith('.pdf'), long);
    assert.ok(bytes(long).length <= 240 && !long.includes('�'), 'cut at a whole character, under the limit: ' + bytes(long).length + ' bytes');
    assert.deepEqual(await namesIn(files, path), [long, 'original - hidden-notice.pdf', 'record.json'].sort());
    const longer = await book.createItem({ ...IRS, title: 'é'.repeat(200) });
    const name = longer.path.split('/').pop();
    assert.ok(bytes(name).length <= 240 && name.startsWith('2026-11-17 sent IRS - éé') && !name.includes('�'), name);
  });

  test('adding a file keeps the old record: record.json is written anew and the old one kept in .formfiller (' + disk + ')', async () => {
    const { files, book } = open(disk);
    const { path } = await book.createItem({ ...IRS, files: [{ role: 'original', name: 'f1040.pdf', bytes: bytes('blank') }] });
    const first = await files.read(path + '/record.json');
    const added = await book.addFile(path, { role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') });
    assert.deepEqual(await namesIn(files, path + '/.formfiller'), ['record 1.json']);
    assert.deepEqual(await files.read(path + '/.formfiller/record 1.json'), first, 'the first record, byte for byte');
    assert.deepEqual(added.record.files.map(file => file.name), ['original - f1040.pdf', 'filled - f1040.pdf']);
    assert.deepEqual(added.record.history.map(event => event.event), ['created', 'file added']);
    assert.deepEqual(await recordIn(files, path), added.record);
    await book.addFile(path, { role: 'confirmation', name: 'receipt.pdf', bytes: bytes('receipt') });
    assert.deepEqual(await namesIn(files, path + '/.formfiller'), ['record 1.json', 'record 2.json']);
    assert.deepEqual((await indexOf(files)).items[0].files.map(file => file.name), ['original - f1040.pdf', 'filled - f1040.pdf', 'confirmation - receipt.pdf']);
  });

  test('fields a later version adds to a record survive adding a file and moving the item (' + disk + ')', async () => {
    const { files, book, dir } = open(disk);
    const { path, record } = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }] });
    const later = { ...record, pages: 2, files: [{ ...record.files[0], pages: 2 }] };
    // As a later Form Filler would have written it: a record replaced with one that has more in it.
    if (dir) writeFileSync(join(dir, path, 'record.json'), JSON.stringify(later));
    else { await files.rename(path + '/record.json', '_Inbox/old record.json').catch(async () => { await files.createFolder('_Inbox'); await files.rename(path + '/record.json', '_Inbox/old record.json'); }); await files.createFile(path + '/record.json', bytes(JSON.stringify(later))); }
    await book.addFile(path, { role: 'confirmation', name: 'receipt.pdf', bytes: bytes('receipt') });
    const moved = await book.moveItem(path, 'Taxes/2025');
    const kept = await recordIn(files, moved.path);
    assert.equal(kept.pages, 2); assert.equal(kept.files[0].pages, 2);
  });

  test('moving an item renames its folder into the other matter, and its record says so (' + disk + ')', async () => {
    const { files, book } = open(disk);
    const { path } = await book.createItem({ ...IRS, by: 'a guess', confidence: 0.95, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }] });
    const moved = await book.moveItem(path, 'Taxes/2025');
    assert.equal(moved.path, 'Taxes/2025/2026-11-17 sent IRS - Form 1040');
    assert.equal(await files.stat(path), null, 'it is no longer where it was');
    assert.equal(moved.record.matter, 'Taxes/2025');
    assert.deepEqual(moved.record.filing, { by: 'you', confidence: 1, reason: 'moved' }, 'you filed it there, not the guess');
    assert.deepEqual(moved.record.history.at(-1), { at: moved.record.history.at(-1).at, event: 'moved', from: 'Taxes/2026', to: 'Taxes/2025' });
    assert.equal(await files.sha256(moved.path + '/filled - f1040.pdf'), hashOf(bytes('filled')));
    assert.deepEqual((await indexOf(files)).items.map(item => item.path), [moved.path]);
    const again = await book.createItem({ ...IRS });
    assert.equal((await book.moveItem(again.path, 'Taxes/2025')).path, 'Taxes/2025/2026-11-17 sent IRS - Form 1040 (2)', 'a name taken there gets " (2)"');
    assert.deepEqual(await book.moveItem(moved.path, 'Taxes/2025'), { path: moved.path, record: moved.record }, 'already there: nothing moves');
    for (const [to, refusal] of [[moved.path, /cannot go inside itself/], [moved.path + '/inside', /cannot go inside itself/], ['Taxes/2025/2026-11-17 sent IRS - Form 1040 (2)/x', /is an item, not a matter/],
      ['.formfiller', /Form Filler's own name/], ['Work/Acme: Corp', /cannot hold ":"/], ['', /Name one/], ['/Users/someone/Archive/Taxes', /not a full path/]])
      await assert.rejects(book.moveItem(moved.path, to), refusal, to);
  });

  test('never delete: after every step, every file that was there is still there, byte for byte (' + disk + ')', async () => {
    const { book, dump } = open(disk);
    const steps = [
      ['init', () => book.init()],
      ['an item', () => book.createItem({ ...IRS, files: [{ role: 'original', name: 'f1040.pdf', bytes: bytes('blank') }, { role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }] })],
      ['the same item again', () => book.createItem({ ...IRS, files: [{ role: 'original', name: 'f1040.pdf', bytes: bytes('blank') }] })],
      ['an unfiled letter', () => book.createItem({ title: 'Lease renewal', direction: 'in', counterparty: 'Landlord', files: [{ role: 'original', name: 'lease.pdf', bytes: bytes('lease') }] })],
      ['a file added', () => book.addFile(FORM_1040, { role: 'filled', name: 'f1040.pdf', bytes: bytes('filled again') })],
      ['the same file added again', () => book.addFile(FORM_1040, { role: 'filled', name: 'f1040.pdf', bytes: bytes('filled again') })],
      ['the index', () => book.rebuildIndex()],
      ['a move', () => book.moveItem(FORM_1040, 'Taxes/2025'), true],
      ['a move onto a taken name', () => book.moveItem(FORM_1040 + ' (2)', 'Taxes/2025'), true],
      ['the letter filed', () => book.moveItem('_Unsorted/2026-11-17 received Landlord - Lease renewal', 'Housing/Lease'), true],
      ['the index again', () => book.rebuildIndex()],
      ['verify', () => book.verify()],
    ];
    for (const [what, step, moved] of steps) {
      const before = dump();
      await step();
      nothingLost(before, dump(), { moved });
      assert.ok(dump().size >= before.size, what + ': no file fewer');
    }
    assert.equal((await book.verify()).ok, true);
  });

  test('two changes at once on one item, from two programs, are both kept (' + disk + ')', async () => {
    const made = DISKS[disk]();
    // Two programs: on the real disk, two file interfaces that share only the folder, as two processes would.
    const other = made.dir ? nodeFiles(made.dir, { links: disk === 'the real disk' }) : made.files;
    const first = openArchive(made.files, { now: clock }), second = openArchive(other, { now: clock });
    const { path } = await first.createItem({ ...IRS });
    await Promise.all([
      first.addFile(path, { role: 'scan', name: 'page 1.pdf', bytes: bytes('page one') }), second.addFile(path, { role: 'scan', name: 'page 2.pdf', bytes: bytes('page two') }),
      first.addFile(path, { role: 'scan', name: 'page 3.pdf', bytes: bytes('page three') }), second.addFile(path, { role: 'scan', name: 'page 4.pdf', bytes: bytes('page four') }),
    ]);
    const record = await recordIn(made.files, path);
    assert.deepEqual(record.files.map(file => file.name).sort(), ['scan - page 1.pdf', 'scan - page 2.pdf', 'scan - page 3.pdf', 'scan - page 4.pdf']);
    assert.deepEqual(await namesIn(made.files, path + '/.formfiller'), ['record 1.json', 'record 2.json', 'record 3.json', 'record 4.json'], 'every earlier record kept');
    assert.equal((await first.verify()).ok, true);
  });

  test('the file interface can neither delete nor overwrite (' + disk + ')', async () => {
    const { dir, files, dump } = open(disk);
    for (const name of ['delete', 'remove', 'rm', 'unlink', 'rmdir', 'writeFile', 'write', 'overwrite', 'truncate', 'copy'])
      assert.equal(files[name], undefined, 'no ' + name);
    await files.createFolder('a'); await files.createFolder('b'); await files.createFolder('a/inner');
    await files.createFile('a/x.txt', bytes('first'));
    await files.createFile('b/y.txt', bytes('second'));
    await assert.rejects(files.createFile('a/x.txt', bytes('replaced?')), { code: 'EEXIST' });
    await assert.rejects(files.createFolder('a/inner'), { code: 'EEXIST' });
    await assert.rejects(files.rename('b/y.txt', 'a/x.txt'), { code: 'EEXIST' });
    await files.createFolder('empty');
    await assert.rejects(files.rename('a', 'empty'), { code: 'EEXIST' }, 'not even onto an empty folder, which a plain rename would replace');
    await assert.rejects(files.rename('b', 'a'), { code: 'EEXIST' });
    for (const bad of ['../outside', '/etc/hosts', 'a//x.txt', 'a/./x.txt', 'a/../b/y.txt']) await assert.rejects(files.createFile(bad, bytes('no')), /Not a path inside the archive/, bad);
    assert.equal(hashOf(await files.read('a/x.txt')), hashOf(bytes('first')));
    assert.equal(hashOf(await files.read('b/y.txt')), hashOf(bytes('second')));
    await files.rename('b/y.txt', 'a/y.txt');
    await files.createFile('a/z.txt', bytes('third'));
    assert.deepEqual([...dump().keys()].sort(), ['a/x.txt', 'a/y.txt', 'a/z.txt'], 'and no hidden half-written file is left behind');
    await files.replaceIndex(bytes('one')); await files.replaceIndex(bytes('two'));
    assert.equal(new TextDecoder().decode(await files.read(INDEX)), 'two', 'the index cache is the one thing rewritten');
    // A file made from a stream keeps the same rules, and a stream that fails leaves nothing behind.
    const streamed = (...pieces) => new ReadableStream({ start(controller) { for (const piece of pieces) controller.enqueue(piece); controller.close(); } });
    const readAll = async stream => new Uint8Array(await new Response(stream).arrayBuffer());
    assert.deepEqual(await files.createFileFrom('a/streamed.txt', streamed(bytes('one '), bytes('two'))), { bytes: 7 });
    assert.equal(new TextDecoder().decode(await files.read('a/streamed.txt')), 'one two');
    assert.equal(new TextDecoder().decode(await readAll(files.readStream('a/streamed.txt'))), 'one two');
    await assert.rejects(files.createFileFrom('a/x.txt', streamed(bytes('replaced?'))), { code: 'EEXIST' });
    assert.equal(hashOf(await files.read('a/x.txt')), hashOf(bytes('first')), 'the file there is untouched');
    let sent = false;
    const failing = new ReadableStream({ pull(controller) { if (sent) controller.error(new Error('the drive went away')); else { sent = true; controller.enqueue(bytes('half of it')); } } }, { highWaterMark: 0 });
    await assert.rejects(files.createFileFrom('a/half.txt', failing), /the drive went away/);
    await assert.rejects(files.createFileFrom('a/odd.txt', streamed(bytes('fine'), 'not bytes')), /A piece of a\/odd.txt is not bytes/);
    await assert.rejects(files.createFileFrom('nowhere/f.txt', streamed(bytes('x'))));
    assert.deepEqual([...dump().keys()].sort(), [INDEX, 'a/streamed.txt', 'a/x.txt', 'a/y.txt', 'a/z.txt'], 'nothing half written is left, under any name');
    // A staging folder is removed whole; nothing else is.
    await files.createFolder('.ff-staging-0123456789abcdef');
    await files.createFolder('.ff-staging-0123456789abcdef/inner');
    await files.createFile('.ff-staging-0123456789abcdef/inner/f.txt', bytes('staged'));
    await files.createFile('.ff-staging-0123456789abcdef/g.txt', bytes('staged'));
    await files.createFile('.ff-staging-fedcba9876543210', bytes('a file named like a staging folder'));
    await files.createFolder('a/.ff-staging-xyz');
    if (dir) {
      symlinkSync(join(dir, 'a'), join(dir, '.ff-staging-00000000000000aa'));
      symlinkSync(join(dir, 'a'), join(dir, '.ff-staging-0123456789abcdef/a link out'));
      symlinkSync(join(dir, 'a/x.txt'), join(dir, 'a/a link.txt'));
      await assert.rejects(files.readStream('a/a link.txt').getReader().read(), { code: 'ELOOP' }, 'a link is not read through');
    }
    for (const path of ['a', 'a/.ff-staging-xyz', '.ff-staging-fedcba9876543210', ...(dir ? ['.ff-staging-00000000000000aa'] : [])])
      await assert.rejects(files.discardStaging(path), /Not a staging folder Form Filler made/, path);
    await files.discardStaging('.ff-staging-0123456789abcdef');
    assert.equal(await files.stat('.ff-staging-0123456789abcdef'), null);
    assert.equal((await files.stat('a/.ff-staging-xyz'))?.kind, 'folder');
    assert.deepEqual([...dump().keys()].sort(), ['.ff-staging-fedcba9876543210', INDEX, 'a/streamed.txt', 'a/x.txt', 'a/y.txt', 'a/z.txt'], 'what a link in it led to is untouched');
  });

  test('a refused item writes nothing: no file and no folder (' + disk + ')', async () => {
    const { book, dump } = open(disk);
    await book.init();
    const before = dump({ folders: true });
    await assert.rejects(book.createItem({ ...IRS, title: ' ' }), /needs a title/);
    await assert.rejects(book.createItem({ ...IRS, direction: 'sideways' }), /sent \("out"\) or received \("in"\)/);
    await assert.rejects(book.createItem({ ...IRS, matter: 'Taxes:2026' }), /Not a usable matter/);
    await assert.rejects(book.createItem({ ...IRS, files: [{ role: 'Filled', name: 'f.pdf', bytes: bytes('x') }] }), /A role is one or more lowercase words/);
    await assert.rejects(book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f.pdf', bytes: 'not bytes' }] }), /has no bytes/);
    await assert.rejects(book.createItem({ ...IRS, dates: { sent: 'yesterday' } }), /dates.sent is not a date/);
    assert.deepEqual([...dump({ folders: true }).keys()].filter(path => !before.has(path)), [], 'nothing new at all');
    const item = await book.createItem({ ...IRS });
    const after = dump({ folders: true });
    await assert.rejects(book.createItem({ ...IRS, matter: item.path }), /is an item, not a matter/);
    assert.deepEqual([...dump({ folders: true }).keys()].filter(path => !after.has(path)), [], 'an item refused inside an item leaves nothing either');
  });
}

test('nothing filed, or a guess below the threshold, goes to _Unsorted', async () => {
  const { book } = open('a Mac-like disk in memory');
  assert.equal((await book.createItem({ ...IRS, matter: null })).path, UNSORTED + '/2026-11-17 sent IRS - Form 1040');
  const guess = await book.createItem({ ...IRS, by: 'a guess', confidence: 0.5, reason: 'the title says 1040' });
  assert.equal(guess.path, UNSORTED + '/2026-11-17 sent IRS - Form 1040 (2)');
  assert.equal(guess.record.matter, UNSORTED);
  assert.deepEqual(guess.record.filing, { by: 'a guess', confidence: 0.5, reason: 'the title says 1040' });
  assert.equal((await book.createItem({ ...IRS, by: 'a guess', confidence: 0.95 })).path, FORM_1040, 'sure enough: filed there');
});

test('on a Mac-like disk, names that differ only in case or in how an accent is encoded are one name, and records use the disk\'s spelling', async () => {
  const { files, book } = open('a Mac-like disk in memory');
  assert.equal((await book.createItem({ ...IRS })).path, FORM_1040);
  assert.equal((await book.createItem({ ...IRS, counterparty: 'irs', title: 'form 1040' })).path, 'Taxes/2026/2026-11-17 sent irs - form 1040 (2)');
  await files.createFolder('Housing');
  await files.createFolder('Housing/2026-11-17 received Café - Bail');      // made by another program, accent encoded apart
  const { path } = await book.createItem({ matter: 'Housing', title: 'Bail', direction: 'in', counterparty: 'Café' });
  assert.equal(path, 'Housing/2026-11-17 received Café - Bail (2)');
  assert.equal((await book.moveItem(FORM_1040, 'taxes/2026')).path, FORM_1040, 'the same matter typed in other case: nothing moves');
  const typed = await book.createItem({ ...IRS, matter: 'TAXES/2026', title: 'Schedule A' });
  assert.equal(typed.path, 'Taxes/2026/2026-11-17 sent IRS - Schedule A', 'filed in the folder that is there, spelt as it is');
  assert.equal(typed.record.matter, 'Taxes/2026');
  const moved = await book.moveItem('taxes/2026/2026-11-17 sent irs - schedule a', 'housing');
  assert.equal(moved.path, 'Housing/2026-11-17 sent IRS - Schedule A');
  assert.deepEqual((await book.verify()).notes.filter(note => /moved outside/.test(note.note)), [], 'no false "moved outside the app"');
});

test('a path too long for the disk to open is refused before anything is written', async () => {
  const { files, dump } = memoryFiles({ room: 160 }), book = openArchive(files, { now: clock });
  await book.init();
  const before = dump({ folders: true });
  await assert.rejects(book.createItem({ ...IRS, title: 'x'.repeat(100), files: [{ role: 'filled', name: 'y'.repeat(60) + '.pdf', bytes: bytes('x') }] }), /longer than the disk can open here \(160\)/);
  assert.deepEqual([...dump({ folders: true }).keys()].filter(path => !before.has(path)), []);
  assert.throws(() => matterPath(('a'.repeat(200) + '/').repeat(3)), /too long/);
});

test('rebuildIndex: the folders are the truth, a rearranged archive is found again by each record\'s id, and nothing that left is forgotten', async () => {
  const { dir, book } = open('the real disk');
  await book.init();
  const a = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }] });
  const b = await book.createItem({ matter: 'Housing', title: 'Lease', direction: 'in', counterparty: 'Landlord', files: [{ role: 'original', name: 'lease.pdf', bytes: bytes('lease') }] });
  const c = await book.createItem({ matter: 'Housing', title: 'Deposit', direction: 'in', counterparty: 'Landlord', files: [{ role: 'original', name: 'receipt.pdf', bytes: bytes('receipt') }] });
  const first = await book.rebuildIndex();
  assert.deepEqual(first.items.map(item => [item.path, item.matter, item.id]), [[c.path, 'Housing', c.record.id], [b.path, 'Housing', b.record.id], [a.path, 'Taxes/2026', a.record.id]]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, INDEX), 'utf8')), first);
  assert.deepEqual(itemsWithFile(first, hashOf(bytes('lease'))).map(item => item.id), [b.record.id], 'have I already got this exact file?');
  // By hand, in Finder: the matter renamed, an item dragged elsewhere, one dropped onto another, loose papers, the
  // index thrown away.
  renameSync(join(dir, 'Taxes'), join(dir, 'Tax returns'));
  mkdirSync(join(dir, 'Old/Lease'), { recursive: true });
  renameSync(join(dir, b.path), join(dir, 'Old/Lease/the lease'));
  renameSync(join(dir, c.path), join(dir, 'Old/Lease/the lease/the deposit'));
  mkdirSync(join(dir, 'Scans')); writeFileSync(join(dir, 'Scans/page 1.png'), 'not really a picture');
  writeFileSync(join(dir, 'Scans/.DS_Store'), 'Finder\'s own');
  rmSync(join(dir, INDEX));
  const again = await book.rebuildIndex();
  assert.deepEqual(again.items.map(item => [item.id, item.path, item.matter]).sort(), [[a.record.id, 'Tax returns/2026/2026-11-17 sent IRS - Form 1040', 'Tax returns/2026'],
    [b.record.id, 'Old/Lease/the lease', 'Old/Lease'], [c.record.id, 'Old/Lease/the lease/the deposit', 'Old/Lease/the lease']].sort());
  assert.deepEqual(again.notRecorded, ['Scans/page 1.png'], 'loose papers are listed and left alone; hidden files are not part of the archive');
  assert.deepEqual(again.problems.map(entry => entry.path), ['Old/Lease/the lease/the deposit']);
  assert.match(again.problems[0].problem, /an item inside another item \(Old\/Lease\/the lease\)/);
  writeFileSync(join(dir, 'Old/Lease/the lease/the deposit/original - receipt.pdf'), 'edited');
  const looked = await book.verify();
  assert.deepEqual(looked.changed, ['Old/Lease/the lease/the deposit/original - receipt.pdf'], 'an item inside another is still checked');
  // An item taken out of the archive whole is noticed, and kept in the index as having left.
  renameSync(join(dir, 'Tax returns/2026/2026-11-17 sent IRS - Form 1040'), join(dir, '..', 'carried away ' + Date.now()));
  const gone = await book.verify();
  assert.deepEqual(gone.gone.map(item => [item.id, item.path]), [[a.record.id, 'Tax returns/2026/2026-11-17 sent IRS - Form 1040']]);
  assert.equal(gone.ok, false);
  const after = await book.rebuildIndex();
  assert.deepEqual(after.left.map(item => item.id), [a.record.id]);
  assert.deepEqual((await book.verify()).gone.map(item => item.id), [a.record.id], 'still noticed after the index is made again');
  // A copied item (dragged with Option in Finder) carries the same id: both are kept, and it is said.
  cpSync(join(dir, 'Old/Lease/the lease'), join(dir, 'Old/Lease/the lease copy'), { recursive: true });
  const copied = await book.rebuildIndex();
  assert.ok(copied.problems.some(entry => /same record id as Old\/Lease\/the lease: a copy of that item\?/.test(entry.problem)));
});

test('verify reads every file again and says what is missing, changed or not recorded, and changes nothing', async () => {
  const { dir, book, dump } = open('the real disk');
  await book.init();
  const a = await book.createItem({ ...IRS, files: [{ role: 'original', name: 'f1040.pdf', bytes: bytes('blank') }, { role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }] });
  const b = await book.createItem({ matter: 'Housing', title: 'Lease', direction: 'in', counterparty: 'Landlord', files: [{ role: 'original', name: 'lease.pdf', bytes: bytes('lease') }] });
  const c = await book.createItem({ matter: 'Housing', title: 'Deposit', direction: 'in', counterparty: 'Landlord' });
  const clean = await book.verify();
  assert.deepEqual({ ok: clean.ok, items: clean.items, files: clean.files, notes: clean.notes }, { ok: true, items: 3, files: 3, notes: [] });
  // What can happen to a folder you own: a file edited, one thrown away, one dropped in, a record damaged, Finder's
  // own files, an item the app was putting together when it stopped, and files half written in a matter and an item.
  writeFileSync(join(dir, a.path, 'filled - f1040.pdf'), 'filled, then edited');
  rmSync(join(dir, a.path, 'original - f1040.pdf'));
  writeFileSync(join(dir, b.path, 'notes.txt'), 'my notes');
  mkdirSync(join(dir, b.path, 'photos'));
  writeFileSync(join(dir, c.path, 'record.json'), '{ "formFiller": "archive-record", "version": 1 ');
  writeFileSync(join(dir, b.path, '.DS_Store'), 'Finder\'s own');
  mkdirSync(join(dir, '.formfiller/new/0b6f6c0e-unfinished'));
  writeFileSync(join(dir, 'Housing', '.ff-new-0123456789abcdef.tmp'), 'half');
  writeFileSync(join(dir, b.path, '.ff-new-fedcba9876543210.tmp'), 'the only copy of a document being added');
  const before = dump();
  const report = await book.verify();
  assert.deepEqual(dump(), before, 'verify changed nothing, not even the index');
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, [a.path + '/original - f1040.pdf']);
  assert.deepEqual(report.changed, [a.path + '/filled - f1040.pdf']);
  assert.deepEqual(report.unrecorded, [b.path + '/notes.txt', b.path + '/photos/']);
  assert.deepEqual(report.unfinished.map(entry => entry.path).sort(), ['.formfiller/new/0b6f6c0e-unfinished', 'Housing/.ff-new-0123456789abcdef.tmp', b.path + '/.ff-new-fedcba9876543210.tmp'].sort());
  assert.deepEqual(report.problems.map(entry => [entry.path, entry.problem]), [[c.path, 'Not a usable record: it is not JSON.']]);
  assert.deepEqual(report.gone, [], 'an item whose record cannot be read is not taken for gone');
  assert.equal(report.items, 2, 'the item whose record cannot be read is reported, not counted');
});

test('one file or folder that cannot be read is reported, and the rest is still checked', { skip: process.getuid?.() === 0 && 'root reads everything' }, async () => {
  const { dir, book } = open('the real disk');
  const a = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }] });
  const b = await book.createItem({ matter: 'Housing', title: 'Lease', direction: 'in', counterparty: 'Landlord', files: [{ role: 'original', name: 'lease.pdf', bytes: bytes('lease') }] });
  mkdirSync(join(dir, 'Private'));
  chmodSync(join(dir, a.path, 'filled - f1040.pdf'), 0o000);
  chmodSync(join(dir, 'Private'), 0o000);
  writeFileSync(join(dir, b.path, 'original - lease.pdf'), 'edited');
  try {
    const report = await book.verify();
    assert.deepEqual(report.changed, [b.path + '/original - lease.pdf'], 'the rest is still checked');
    assert.deepEqual(report.problems.map(entry => entry.path).sort(), ['Private', a.path + '/filled - f1040.pdf'].sort());
    assert.ok(report.problems.every(entry => /cannot be read \(EACCES\)/.test(entry.problem)), JSON.stringify(report.problems));
    assert.equal(report.ok, false);
    assert.equal((await book.rebuildIndex()).items.length, 2, 'the index is made all the same');
  } finally { chmodSync(join(dir, a.path, 'filled - f1040.pdf'), 0o644); chmodSync(join(dir, 'Private'), 0o755); }
});

test('a stop is seen and can be finished: a half-replaced record, a move stopped after its rename', async () => {
  const { dir, book, files } = open('the real disk');
  const { path } = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }] });
  await book.addFile(path, { role: 'confirmation', name: 'receipt.pdf', bytes: bytes('receipt') });
  // Stopped between putting the old record away and putting the new one in place:
  renameSync(join(dir, path, 'record.json'), join(dir, path, '.formfiller/record new.json'));
  let report = await book.verify();
  assert.deepEqual(report.unfinished.map(entry => entry.path), [path]);
  assert.match(report.unfinished[0].what, /record\.json was being replaced/);
  assert.deepEqual(report.unrecorded, [], 'its files are not mistaken for loose papers');
  await assert.rejects(book.createItem({ ...IRS, matter: path }), /is an item, not a matter/, 'nor is it taken for a matter');
  renameSync(join(dir, path, '.formfiller/record new.json'), join(dir, path, 'record.json'));
  // A move that stopped after the folder was renamed, before its record was changed: the moved record waits in the
  // item, and verify says so.
  const stopping = { ...files, rename: async (from, to) => { if (from.endsWith('/record.json')) throw new Error('stopped'); return files.rename(from, to); } };
  await assert.rejects(openArchive(stopping, { now: clock }).moveItem(path, 'Taxes/2025'), /stopped/);
  const there = 'Taxes/2025/2026-11-17 sent IRS - Form 1040';
  report = await book.verify();
  assert.deepEqual(report.unfinished.map(entry => entry.path), [there + '/.formfiller/record new.json']);
  assert.deepEqual(report.notes.map(note => note.path), [there], 'its record still says the old matter');
  // Moving it again finishes the move: the record catches up with where the folder is, and the record the stop left
  // waiting is kept as an earlier version.
  const finished = await book.moveItem(there, 'Taxes/2025');
  assert.equal(finished.record.matter, 'Taxes/2025');
  assert.equal(finished.record.history.filter(event => event.event === 'moved').length, 1);
  report = await book.verify();
  assert.deepEqual({ ok: report.ok, unfinished: report.unfinished, notes: report.notes }, { ok: true, unfinished: [], notes: [] });
  // record 1: the first record; record 2: the moved record the stop left waiting; record 3: the record before this move.
  assert.deepEqual(await namesIn(files, there + '/.formfiller'), ['record 1.json', 'record 2.json', 'record 3.json']);
});

test('a move finishes what Finder or a stop left: an item already in the matter has its record brought up to date', async () => {
  const { dir, book, files } = open('the real disk');
  const { path, record } = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }] });
  mkdirSync(join(dir, 'Taxes/2025'));
  renameSync(join(dir, path), join(dir, 'Taxes/2025/2026-11-17 sent IRS - Form 1040'));
  const moved = await book.moveItem('Taxes/2025/2026-11-17 sent IRS - Form 1040', 'Taxes/2025');
  assert.equal(moved.record.matter, 'Taxes/2025');
  assert.deepEqual(moved.record.history.at(-1), { at: moved.record.history.at(-1).at, event: 'moved', from: 'Taxes/2026', to: 'Taxes/2025' });
  assert.deepEqual((await book.verify()).notes, []);
  // A Finder copy of the item in the matter it is moved to does not stop the move.
  cpSync(join(dir, 'Taxes/2025/2026-11-17 sent IRS - Form 1040'), join(dir, 'Taxes/2024 copy'), { recursive: true });
  mkdirSync(join(dir, 'Taxes/2024'));
  renameSync(join(dir, 'Taxes/2024 copy'), join(dir, 'Taxes/2024/2026-11-17 sent IRS - Form 1040'));
  const again = await book.moveItem(moved.path, 'Taxes/2024');
  assert.equal(again.path, 'Taxes/2024/2026-11-17 sent IRS - Form 1040 (2)');
  assert.equal(record.id, again.record.id);
  assert.ok(files);
});

test('nothing is written through a link: a .formfiller that is a link is refused and reported, and a linked item is not moved', async () => {
  const { dir, book, files } = open('the real disk');
  const { path } = await book.createItem({ ...IRS });
  mkdirSync(join(dir, 'Website')); writeFileSync(join(dir, 'Website/index.json'), 'a page of my own');
  renameSync(join(dir, '.formfiller'), join(dir, 'formfiller moved aside'));
  symlinkSync('Website', join(dir, '.formfiller'));
  await assert.rejects(book.rebuildIndex(), /\.formfiller in the archive is not a plain folder/);
  assert.equal(readFileSync(join(dir, 'Website/index.json'), 'utf8'), 'a page of my own', 'the file the link leads to is untouched');
  assert.ok((await book.verify()).problems.some(entry => entry.path === '.formfiller' && /not a plain folder/.test(entry.problem)));
  rmSync(join(dir, '.formfiller')); renameSync(join(dir, 'formfiller moved aside'), join(dir, '.formfiller'));
  symlinkSync(join(dir, path), join(dir, 'Taxes/2026/a link to the item'));
  await assert.rejects(files.rename('Taxes/2026/a link to the item', 'Taxes/moved link'), /A link is not moved/);
});

test('the lock: one program at a time changes an archive; a lock left by a program that stopped is taken over', async () => {
  const { dir, files, book } = open('the real disk');
  await book.init();
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  writeFileSync(join(dir, '.formfiller/lock'), JSON.stringify({ pid: Number(gone), host: hostname(), since: '2026-11-17T15:00:00.000Z' }));
  assert.equal((await files.lockHolder()).stale, true);
  await book.createItem({ ...IRS });
  assert.equal(existsSync(join(dir, '.formfiller/lock')), false, 'taken over, and given up when done');
  await files.lock();
  const elsewhere = nodeFiles(dir);
  await assert.rejects(elsewhere.lock({ wait: 100 }), { code: 'ELOCKED', message: /Another Form Filler is changing this archive \(process \d+/ });
  assert.ok((await book.verify()).notes.some(note => /another Form Filler was changing the archive/.test(note.note)));
  await files.unlock();
  await elsewhere.lock({ wait: 100 }); await elsewhere.unlock();
});

test('readRecord refuses a damaged record, saying what is wrong', async () => {
  const { book } = open('a Mac-like disk in memory');
  const { record } = await book.createItem({ ...IRS, files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('filled') }] });
  assert.deepEqual(readRecord(JSON.stringify(record)), record);
  assert.deepEqual(readRecord({ ...record, extra: { from: 'a later version' } }).extra, { from: 'a later version' }, 'fields it does not know are kept');
  const broken = change => () => readRecord({ ...record, ...change });
  for (const [change, why] of [
    [{ formFiller: 'template' }, /not a Form Filler archive record/], [{ version: 2 }, /version 2 is not one this program reads/],
    [{ direction: 'up' }, /direction is not "in" or "out"/], [{ title: '' }, /its title is missing/], [{ dates: { created: 'soon' } }, /date it was made/],
    [{ dates: { ...record.dates, sent: 'later' } }, /dates.sent is not a date/], [{ filing: { by: 'you', confidence: 7 } }, /confidence from 0 to 1/],
    [{ form: { sha256: 'short' } }, /form fingerprint/], [{ files: 'none' }, /no list of files/],
    [{ files: [{ ...record.files[0], sha256: 'x' }] }, /file 1 has no SHA-256/], [{ files: [{ ...record.files[0], name: '../escape.pdf' }] }, /file 1 has a name that cannot be a file/],
    [{ files: [{ ...record.files[0], name: 'record.json' }] }, /file 1 has a name that cannot be a file/], [{ files: [record.files[0], record.files[0]] }, /file 2 has the same name/],
    [{ files: [{ ...record.files[0], role: 'Filled!' }] }, /file 1 has no role word/], [{ history: [{}] }, /history is not a list of events/],
  ]) assert.throws(broken(change), why, JSON.stringify(change));
  assert.throws(() => readRecord('{ not json'), /it is not JSON/);
});

test('cleanName and matterPath: names from any words, cut where a person would see a whole character, and a matter refused rather than changed', () => {
  assert.equal(cleanName('  a/b:c\\d  '), 'a-b-c-d');
  assert.equal(cleanName('...hidden. '), 'hidden');
  assert.equal(cleanName('evil‮fdp.exe'), 'evil fdp.exe', 'no character that turns text around');
  assert.equal(cleanName(''), 'untitled');
  assert.equal(cleanName('Café'), 'Café', 'one way of writing each accent');
  assert.equal(cleanName('اظهارنامه‌ی مالیاتی'), 'اظهارنامه‌ی مالیاتی', 'the joiner Persian is spelt with is kept');
  assert.equal(cleanName('x'.repeat(300) + '.pdf', { file: true }), 'x'.repeat(236) + '.pdf');
  for (const end of ['🇨🇦', '👨‍👩‍👧', 'कि']) {
    const cut = cleanName('x'.repeat(237) + end);
    assert.ok(cut === 'x'.repeat(237) || cut === 'x'.repeat(237) + end, JSON.stringify(cut.slice(235)) + ': not cut through ' + end);
  }
  assert.equal(matterPath('Taxes/2026/'), 'Taxes/2026');
  assert.equal(matterPath('مالیات‌ها/۱۴۰۵'), 'مالیات‌ها/۱۴۰۵');
  for (const [bad, why] of [['', /Name one/], ['/Taxes/2026', /not a full path/], ['~/Archive/Taxes', /not a full path/], ['Taxes//2026', /empty folder name/],
    ['.formfiller', /Form Filler's own name/], ['Taxes/Record.JSON', /Form Filler's own name/], ['Taxes/.hidden', /"Taxes\/.hidden".*"\.hidden" would have to be "hidden".*hidden/],
    ['Taxes: 2026', /cannot hold ":"/], ['Work/Acme  Corp', /"Acme {2}Corp" would have to be "Acme Corp" instead: it has spaces/], [null, /Name one/]])
    assert.throws(() => matterPath(bad), why, String(bad));
});

test('the one SHA-256 helper fingerprints bytes and text alike', async () => {
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256(new Uint8Array([97, 98, 99])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await sha256('é'), hashOf(Buffer.from('é', 'utf8')), 'text as UTF-8');
});

// The command line, run as another program would run it, on an archive in a temporary folder and the invented fixtures.
const bin = fileURLToPath(new URL('../bin/form-filler.mjs', import.meta.url)), fixture = name => fileURLToPath(new URL('./fixtures/' + name, import.meta.url));
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

test('the command line files, adds, verifies, moves and indexes, and verify says what changed', () => {
  const dir = join(tempFolder(), 'Test Archive');
  const added = run('archive', 'add', dir, '--matter=Taxes/2026', '--direction', 'out', '--counterparty', 'IRS', '--title', 'Form 1040', '--role', 'original', fixture('form.pdf'));
  assert.equal(added.status, 0, added.stderr);
  const item = added.stdout.trim();
  assert.match(item, /^Taxes\/2026\/\d{4}-\d{2}-\d{2} sent IRS - Form 1040$/);
  assert.deepEqual(readdirSync(dir).sort(), ['.formfiller', 'Taxes', '_Inbox', '_Unsorted']);
  const filed = run('archive', 'file', dir, join(dir, item), '--role', 'filled', fixture('fillable.pdf'));
  assert.equal(filed.status, 0, filed.stderr);
  assert.equal(filed.stdout, 'filled - fillable.pdf\n');
  let checked = run('archive', 'verify', dir);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.equal(checked.stdout, '1 item(s), 2 recorded file(s): every recorded file is there, byte for byte.\n');
  writeFileSync(join(dir, 'Taxes/2026/notes.txt'), 'my notes');
  checked = run('archive', 'verify', dir);
  assert.equal(checked.status, 0, 'a file that is there but not recorded is listed, and is not damage');
  assert.match(checked.stdout, /^not recorded {2}Taxes\/2026\/notes\.txt\n/);
  assert.match(checked.stdout, /byte for byte; 1 not recorded\.\n$/);
  assert.equal(run('archive', 'verify', dir, '--strict').status, 1, 'unless --strict');
  writeFileSync(join(dir, item, 'original - form.pdf'), 'edited');
  checked = run('archive', 'verify', dir);
  assert.equal(checked.status, 1);
  assert.ok(checked.stdout.includes('changed       ' + item + '/original - form.pdf\n'), checked.stdout);
  const moved = run('archive', 'move', dir, item, '--matter', join(dir, 'Taxes/2025'));
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(moved.stdout, item.replace('Taxes/2026', 'Taxes/2025') + '\n', 'a matter given as a full path inside the archive');
  const indexed = run('archive', 'index', dir);
  assert.equal(indexed.status, 0, indexed.stderr);
  assert.match(indexed.stdout, /1 item\(s\) in the index, \.formfiller\/index\.json\.\n$/);
  assert.ok(existsSync(join(dir, INDEX)));
  renameSync(join(dir, item.replace('Taxes/2026', 'Taxes/2025')), join(dir, '..', 'taken out'));
  checked = run('archive', 'verify', dir);
  assert.equal(checked.status, 1, 'an item taken out of the archive whole is noticed');
  assert.match(checked.stdout, /^gone {10}Taxes\/2025\/.* - Form 1040: Form 1040 \(2 file\(s\)\) is no longer in the archive\n/m);
});

test('the command line reads the archive\'s flags strictly, so a file is never taken for a flag\'s value', () => {
  const dir = join(tempFolder(), 'Test Archive'), form = fixture('form.pdf'), fillable = fixture('fillable.pdf');
  const base = ['archive', 'add', dir, '--direction', 'in', '--counterparty', 'City Hall', '--title', 'Notice'];
  for (const [args, why] of [
    [[...base, '--recieved', '2026-03-02', form], /--recieved is not an option of "archive add"; it takes --direction, --counterparty, --title, --matter, --channel, --sent, --received, --role\./],
    [[...base, '--role', 'original', form, '--role', 'filled', fillable], /--role is given twice\. One role per run/],
    [[...base, form, '--matter'], /--matter needs a value/],
    [[...base, '--matter', '--role', 'original', form], /--matter needs a value/],
    [[...base, '--strict', form], /--strict is not an option of "archive add"/],
    [['archive', 'verify', dir, '--strict=yes'], /--strict takes no value/],
    [[...base, '--matter', '/somewhere/else/Taxes', form], /is not inside/],
    [['archive', 'add', form, '--direction', 'in', '--counterparty', 'x', '--title', 'y', fillable], /is not a folder/],
  ]) {
    const out = run(...args);
    assert.equal(out.status, 1, args.join(' ') + '\n' + out.stdout);
    assert.match(out.stderr, why);
    assert.doesNotMatch(out.stderr, /\n {4}at /, 'a message, not a stack trace');
  }
  assert.equal(existsSync(join(dir, '_Unsorted')), false, 'nothing was filed');
  const ok = run(...base, '--received=2026-03-02', '--channel=mail', '--', form);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, '_Unsorted/2026-03-02 received City Hall - Notice\n');
  assert.match(run('archive', 'verify', join(dir, 'nowhere')).stderr, /is not a folder/);
  assert.match(run('archive', 'move', dir, '/somewhere/else', '--matter', 'Taxes').stderr, /is not inside/);
  assert.equal(run('archive').status, 1);
});
