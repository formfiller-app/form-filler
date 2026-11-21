import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MASKED, DETAILS, masked, createVault, unlockVault } from '../src/lib/index.js';
import { ARCHIVE, byMatter, cloudHint, itemWords, restoredWords, sizeWords, verifyWords, whenWords, within } from '../src/app/desk-words.js';
import { tauriStandIn } from './tauri-stand-in.js';

// What the Mac app's screens say and keep, without a window: the words (src/app/desk-words.js), the rule for what
// stays off the screen (src/lib/profile.js), and where the page's own things are kept in the app (src/app/platform.js,
// run here over a stand-in for the app). Everything is invented.
const scratch = mkdtempSync(join(tmpdir(), 'ff-desk-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
// The page finds the app by what the app hands it, when the page's code is first loaded: so the stand-in is in place
// before platform.js is.
const data = join(scratch, 'data'), home = join(scratch, 'home');
mkdirSync(data); mkdirSync(home);
const standIn = tauriStandIn({ granted: [data], home, data });
globalThis.__TAURI__ = { core: { invoke: standIn.invoke }, fs: standIn.fs, dialog: { open: async () => null, save: async () => null } };
const { shell, places, pageStore, vaultStore } = await import('../src/app/platform.js');
const HASH = 'ab'.repeat(32);

test('a name, a date of birth and a street address are shown by their last characters, and never mostly given away', () => {
  assert.deepEqual(MASKED, ['fullName', 'firstName', 'lastName', 'address', 'birthDate']);
  for (const key of MASKED) assert.ok(DETAILS.some(([name]) => name === key), key + ' is one of your details');
  for (const [value, shown] of [['Jane Roe', '••••••oe'], ['02/30/1980', '••••••1980'], ['12 Elm Street', '•••••••••reet'], ['Roe', '•••'], ['Jane', '••••'], ['Janet', '•••et'], ['', ''], ['Zoë Ångström', '••••••••tröm']])
    assert.equal(masked(value), shown, JSON.stringify(value));
  assert.equal(masked(null), '');
  assert.equal([...masked('👩‍🚀 Jane Roe-Smith')].length, [...'👩‍🚀 Jane Roe-Smith'].length, 'a dot for each character, however it is encoded');
  for (const value of ['Jane Roe', '02/30/1980', 'Al', 'A much longer invented name than most']) assert.ok([...masked(value)].filter(letter => letter !== '•').length <= Math.max(0, [...value].length / 2), value);
});

test('sizes, moments and folders are said plainly', () => {
  assert.deepEqual([0, 1, 999, 1000, 181234, 2500000, 150 * 1e6, 2.06e9, 12e9].map(sizeWords), ['0 bytes', '1 byte', '999 bytes', '1 KB', '181 KB', '2.5 MB', '150 MB', '2.1 GB', '12 GB']);
  assert.equal(sizeWords(NaN), '');
  assert.equal(whenWords('2026-11-17T15:30:00-05:00'), '2026-11-17 15:30');
  assert.equal(whenWords(null), '');
  assert.equal(ARCHIVE, 'Form Filler Archive');
  for (const [path, folder, inside] of [['/a/b', '/a/b', true], ['/a/b/c', '/a/b', true], ['/a/bc', '/a/b', false], ['/a', '/a/b', false], ['/a/b/c', '/a/b/', true]]) assert.equal(within(path, folder), inside, path + ' in ' + folder);
});

test('a folder that a syncing service would copy elsewhere is noticed by where it is', () => {
  const at = '/Users/someone';
  for (const [path, hint] of [
    [at + '/Library/Mobile Documents/com~apple~CloudDocs/Papers', /iCloud Drive/], [at + '/Library/CloudStorage/Dropbox/Papers', /syncing service/],
    [at + '/Dropbox/Papers', /Dropbox/], [at + '/Dropbox (Personal)', /Dropbox/], [at + '/Google Drive/My Drive', /Google Drive/], [at + '/OneDrive - Example/Papers', /OneDrive/], [at + '/Box/Papers', /Box/],
    [at + '/Documents', /iCloud, if/], [at + '/Documents/Papers', /iCloud, if/], [at + '/Desktop/Papers', /iCloud, if/],
  ]) assert.match(cloudHint(path, at), hint, path);
  for (const path of [at, at + '/Papers', at + '/Documents of mine', '/Volumes/Backup/Papers', at + '/Library/Application Support/x', at + '/Boxes/Papers']) assert.equal(cloudHint(path, at), null, path);
  assert.equal(cloudHint('', at), null);
});

test('the archive is listed by matter, newest first, and a check or a restore is told in lines', () => {
  const item = (matter, title, sent, more = {}) => ({ id: title, path: matter + '/' + sent + ' sent IRS - ' + title, matter, title, direction: 'out', counterparty: 'IRS', dates: { created: sent + 'T09:00:00-05:00', sent: null }, files: [], ...more });
  const listed = byMatter([item('Taxes/2026', 'Form 4868', '2026-04-01'), item('Housing', 'Lease', '2026-01-05'), item('Taxes/2026', 'Form 1040', '2026-11-17'),
    item('Taxes/2026', 'Notice', '2026-02-01', { direction: 'in', counterparty: 'City Hall', dates: { created: '2026-12-01T09:00:00-05:00', received: '2026-12-24' } })]);
  assert.deepEqual(listed.map(group => [group.matter, group.items.map(entry => entry.title)]), [['Housing', ['Lease']], ['Taxes/2026', ['Notice', 'Form 1040', 'Form 4868']]]);
  assert.equal(itemWords(listed[1].items[0]), '2026-12-24 · received · City Hall · Notice');
  assert.equal(itemWords(listed[1].items[1]), '2026-11-17 · sent · IRS · Form 1040');
  assert.deepEqual(byMatter(undefined), []);
  const clean = { missing: [], changed: [], gone: [], unfinished: [], problems: [], unrecorded: [] };
  assert.deepEqual(verifyWords(clean), []);
  const lines = verifyWords({ ...clean, missing: ['a/x.pdf'], changed: Array.from({ length: 10 }, (_, n) => 'b/' + n + '.pdf'), gone: [{ path: 'c/item' }], unrecorded: ['d/loose.txt'], problems: [{ path: 'e', problem: 'it cannot be read (EACCES)' }] });
  assert.equal(lines.length, 5);
  assert.match(lines[1], /b\/7\.pdf; and 2 more\.$/);
  assert.match(lines[3], /e \(it cannot be read \(EACCES\)\)/);
  const restored = restoredWords({ placed: [{ what: 'vault', path: 'vault', beside: false }, { what: 'settings.json', path: 'settings (restored 2026-11-17 1530).json', beside: true }, { what: 'archive', path: ARCHIVE, beside: false }],
    files: 12, bytes: 181234, skipped: [], unfinished: [{ folder: 'parent', path: '.ff-staging-00000000000000aa' }], vault: { details: false, documents: 0 } }, 'your home folder');
  assert.match(restored[0], /^Your vault .*: back in place\.$/);
  assert.match(restored[1], /^The app’s settings: something was there already.*“settings \(restored 2026-11-17 1530\)\.json” in the app’s data folder\. Nothing was overwritten\.$/);
  assert.match(restored[2], /^Your archive: back in place, as “Form Filler Archive” in your home folder\.$/);
  assert.match(restored[3], /^12 files, 181 KB/);
  assert.match(restored[4], /held no details and no locker documents/);
  assert.match(restored[5], /earlier restore.*\.ff-staging-00000000000000aa/);
});

test('in the app, the forms the page remembers and its settings are files in the data folder, where a backup finds them', async () => {
  assert.equal(shell, true, 'the page takes itself to be in the app');
  assert.deepEqual(await places(), { data, home, archive: join(home, ARCHIVE) });
  // What an earlier run left there, with a field this version does not know and a template that cannot be read.
  mkdirSync(join(data, 'templates'));
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ later: { kept: true }, page: { useDetails: false }, archive: { holder: 'home' } }));
  writeFileSync(join(data, 'templates', 'cd'.repeat(32) + '.json'), JSON.stringify({ formFiller: 'template', blanks: [] }));
  writeFileSync(join(data, 'templates', 'ef'.repeat(32) + '.json'), 'not JSON');
  writeFileSync(join(data, 'templates', 'notes.txt'), 'not a template');
  const problems = [], store = pageStore({ onProblem: message => problems.push(message) });
  assert.equal(store.get('useDetails', true), true, 'before the data folder has been read, a get gives its fallback');
  await store.ready;
  assert.equal(store.get('useDetails', true), false);
  assert.deepEqual(store.get('template:' + 'cd'.repeat(32), null), { formFiller: 'template', blanks: [] });
  assert.equal(store.get('template:' + 'ef'.repeat(32), null), null, 'a template that cannot be read is as if the form had not been seen');
  assert.equal(store.get('template:not-a-fingerprint', 'fallback'), 'fallback');
  assert.equal(store.settings().archive.holder, 'home');
  // The page's three calls, as its store on the web has them.
  assert.equal(store.set('template:' + HASH, { formFiller: 'template', blanks: [{ label: 'Full name' }], labels: 2 }), true);
  store.set('handModel', 'large'); store.set('detailsOpen', true); store.drop('detailsOpen');
  assert.deepEqual(store.get('template:' + HASH, null).blanks, [{ label: 'Full name' }], 'answered at once, from memory');
  await store.change({ backup: { to: '/Volumes/Invented', last: '2026-11-17T15:30:00-05:00' } });
  await store.settled();
  assert.deepEqual(JSON.parse(readFileSync(join(data, 'templates', HASH + '.json'), 'utf8')).blanks, [{ label: 'Full name' }]);
  assert.deepEqual(JSON.parse(readFileSync(join(data, 'settings.json'), 'utf8')), { later: { kept: true }, page: { useDetails: false, handModel: 'large' }, archive: { holder: 'home' }, backup: { to: '/Volumes/Invented', last: '2026-11-17T15:30:00-05:00' } },
    'one settings file, with what this version does not know kept as it was');
  assert.ok(readdirSync(data).every(name => !name.endsWith('.tmp')), 'no half-written file is left');
  store.drop('template:' + HASH);
  assert.equal(store.get('template:' + HASH, null), null, 'forgotten for now');
  // A restore puts other files there: read again, memory is what the disk holds.
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ page: { useDetails: true }, archive: { holder: '/Volumes/Invented/Papers' } }));
  rmSync(join(data, 'templates', 'cd'.repeat(32) + '.json'));
  await store.reload();
  assert.deepEqual([store.get('useDetails', false), store.settings().archive.holder, store.get('template:' + 'cd'.repeat(32), null), store.get('template:' + HASH, null)?.labels], [true, '/Volumes/Invented/Papers', null, 2]);
  // Settings that cannot be read count as none, and are kept aside when the next change replaces them.
  writeFileSync(join(data, 'settings.json'), '{ half a file');
  await store.reload();
  assert.deepEqual(store.settings(), {});
  await store.change({ archive: { holder: 'home' } });
  assert.equal(readFileSync(join(data, 'settings.json.prev'), 'utf8'), '{ half a file');
  assert.deepEqual(problems, []);
});

test('in the app, the vault is a folder of age files in the data folder, and forgetting it leaves no folder', async () => {
  const store = vaultStore(), passphrase = 'invented horse battery staple';
  assert.equal(await store.get('vault.json'), null);
  const { vault } = await createVault(store, passphrase, { workFactor: 10 });
  await vault.writeProfile({ details: { fullName: 'Jane Roe' } });
  vault.lock();
  assert.deepEqual(readdirSync(join(data, 'vault')).sort(), ['identity.age', 'profile.age', 'vault.json']);
  assert.ok(!readFileSync(join(data, 'vault', 'profile.age'), 'latin1').includes('Jane Roe'), 'nothing of your details in plain text');
  const opened = await unlockVault(vaultStore(), passphrase);
  assert.equal((await opened.readProfile()).details.fullName, 'Jane Roe');
  opened.lock();
  await store.clear();
  assert.equal(existsSync(join(data, 'vault')), false);
});
