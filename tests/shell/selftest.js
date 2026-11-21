// Checks that run inside the Mac app's own window, in a test build (scripts/mac-check.mjs bundles this file and the
// app runs it once the page has loaded; src-tauri/src/testing.rs). The unit tests try the app's file code against a
// stand-in for the app; these try the same code against the app itself: the real file plugin, the real commands, the
// real WebKit, and the page under the app's content policy. Everything is invented, in folders the terminal named.
// Each line goes to the terminal; the last says how many passed.
//
//   files   src/app/files-tauri.js on a granted folder: every promise src/lib/files/node.js makes
//   store   src/app/store-tauri.js, and a vault made, locked, opened and forgotten in it
//   home    the home folder: only Form Filler's own names in it can be reached
//   page    the page itself: the invented forms open and their blanks are found, with nothing blocked or fetched
//   screens the app's own screens, clicked through by this script in a start of their own: setup, your details
//           hidden, a form filed, the archive, the locker, a backup made and checked, the vault forgotten and restored
//   big     (only when asked) a large made-up archive backed up, checked and restored, timed
//   bench   (only when asked) where the time of a backup's check goes, stage by stage; with "hidden", the same check
//           again while the window is hidden, to see what macOS does to a page nobody can see
// And three that wait for a person (or a helper that can click) to do what no script can, each only when asked:
//   pick    a folder picked in the real folder dialog, and a file named in the real save dialog: what the pick grants
//   picked  after a restart: the folder picked before is still the app's to use, with no new pick
//   picker  the page's own "Choose the form" button and the file panel it opens
//   print   the page printed: by the page's own window.print(), then by the app
import { call, homeFiles, tauriFiles } from '../../src/app/files-tauri.js';
import { tauriStore } from '../../src/app/store-tauri.js';
import { openArchive } from '../../src/lib/archive.js';
import { createVault, forgetVault, unlockVault, vaultInfo } from '../../src/lib/vault.js';
import { BACKUPS, listBackups, makeBackup, restoreBackup, verifyBackup } from '../../src/lib/backup.js';
import { hex } from '../../src/lib/hash.js';
import { unlockKey } from '../../src/lib/vault.js';
import { readTar } from '../../src/lib/tar.js';
import { sha256 as hasher } from '@noble/hashes/sha2.js';

(async () => {
  if (window.__ffSelfTest) return;
  window.__ffSelfTest = true;
  const tauri = { fs: window.__TAURI__.fs, invoke: window.__TAURI__.core.invoke };
  const { fs, invoke } = tauri;
  const say = what => invoke('test_report', { what: String(what) });
  const setting = name => invoke('test_setting', { name });
  const results = [];
  const step = async (name, work) => {
    const started = performance.now();
    try { await work(); results.push(true); await say('PASS  ' + name + '  (' + Math.round(performance.now() - started) + ' ms)'); }
    // WebKit's stack does not carry the message, so both are said.
    catch (error) { results.push(false); await say('FAIL  ' + name + '\n          ' + [String(error?.message || error), ...String(error?.stack || '').split('\n').slice(0, 4)].join('\n          ')); }
  };
  const ok = (value, what) => { if (!value) throw new Error('not so: ' + what); };
  const same = (got, want, what = 'value') => { const [a, b] = [JSON.stringify(got), JSON.stringify(want)]; if (a !== b) throw new Error(what + ': got ' + a + ', wanted ' + b); };
  // A call that must fail: with this code, or with a message like this.
  const refused = async (work, how, what = '') => {
    let error = null;
    try { await (typeof work === 'function' ? work() : work); } catch (caught) { error = caught; }
    if (!error) throw new Error('was not refused: ' + what + ' (' + how + ')');
    const fits = how instanceof RegExp ? how.test(error.message || String(error)) : error.code === how;
    if (!fits) throw new Error(what + ' failed, but not as ' + how + ': ' + (error.code || '') + ' ' + (error.message || error));
    return error;
  };
  const bytes = text => new TextEncoder().encode(text), words = data => new TextDecoder().decode(data);
  const print = async data => hex(await crypto.subtle.digest('SHA-256', data));
  const made = (size, seed = 1) => { const out = new Uint8Array(size); for (let i = 0; i < size; i++) out[i] = (i * 31 + seed * 7 + (i >> 8)) & 255; return out; };
  const readAll = async stream => { const reader = stream.getReader(), parts = []; let size = 0; for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); size += value.length; } const whole = new Uint8Array(size); let at = 0; for (const part of parts) { whole.set(part, at); at += part.length; } return whole; };
  // Every file under a folder of an interface, by path, hidden ones too.
  const tree = async (files, at = '') => { const out = []; for (const entry of await files.list(at)) { const path = at ? at + '/' + entry.name : entry.name; out.push(path + (entry.kind === 'folder' ? '/' : entry.kind === 'other' ? ' (link)' : '')); if (entry.kind === 'folder') out.push(...await tree(files, path)); } return out; };

  const root = await setting('root'), run = ((await setting('run')) || 'files,store,home,page').split(',');
  const wants = name => run.some(item => item === name || item.startsWith(name + '='));
  const places = await invoke('places');
  await say('in ' + navigator.userAgent + ' at ' + location.href);

  if (wants('files')) {
    const dir = root + '/files', files = tauriFiles(tauri, dir);
    await step('before a folder is granted, nothing in it can be reached, by the file plugin or by the app\'s own commands', async () => {
      await refused(call(() => fs.readDir(dir)), 'EFORBIDDEN', 'listing');
      await refused(call(() => fs.readFile(dir + '/plain.txt')), 'EFORBIDDEN', 'reading');
      await refused(call(() => fs.writeFile(dir + '/planted.txt', bytes('x'))), 'EFORBIDDEN', 'writing');
      await refused(call(() => invoke('settle', { path: dir + '/plain.txt' })), 'EFORBIDDEN', 'settle');
      await refused(call(() => invoke('real_path', { path: dir })), 'EFORBIDDEN', 'real_path');
      await refused(call(() => invoke('name_file', { from: dir + '/plain.txt', to: dir + '/renamed.txt' })), 'EFORBIDDEN', 'name_file');
      await refused(call(() => invoke('reveal', { path: dir })), 'EFORBIDDEN', 'reveal');
      await refused(files.list(''), 'EFORBIDDEN', 'the interface');
    });
    await invoke('test_grant', { path: dir });
    await invoke('test_grant', { path: root + '/other' });
    await step('a granted folder is listed in name order, a link as a link, and a file is read whole or as a stream', async () => {
      same(await files.list(''), [['.ff-staging-00000000000000bb', 'folder'], ['.formfiller', 'folder'], ['a link.txt', 'other'], ['plain.txt', 'file'], ['staging link', 'other'], ['way nowhere', 'other'], ['way out', 'other'], ['way to granted', 'other']]
        .map(([name, kind]) => ({ name, kind })), 'the listing, hidden names too');
      same(await files.stat('plain.txt'), { kind: 'file', bytes: 5 });
      same(await files.stat('no such file'), null); same(await files.stat('plain.txt/inside a file'), null);
      for (const name of ['a link.txt', 'way nowhere', 'way out', 'way to granted']) same(await files.stat(name), { kind: 'other', bytes: 0 }, name);
      same(words(await files.read('plain.txt')), 'plain');
      same(words(await readAll(files.readStream('plain.txt'))), 'plain');
      same(await files.sha256('plain.txt'), await print(bytes('plain')));
      await refused(files.readStream('a link.txt').getReader().read(), 'ELOOP', 'a link read as a stream');
      await refused(files.sha256('a link.txt'), 'ELOOP', 'a link fingerprinted');
      await refused(files.read('no such file'), 'ENOENT', 'a file that is not there');
      for (const bad of ['../outside', '/etc/hosts', 'a//x', 'a/./x', 'a/../x']) await refused(files.createFile(bad, bytes('no')), /Not a path inside the archive/, bad);
    });
    await step('a new file appears whole under a name not taken; a taken name is refused and what has it is untouched', async () => {
      await files.createFolder('a'); await files.createFolder('b'); await files.createFolder('a/inner'); await files.createFolder('empty');
      await files.createFile('a/x.txt', bytes('first'));
      await files.createFile('b/y.txt', bytes('second'));
      await files.createFile('a/nothing in it.txt', new Uint8Array(0));
      same(await files.stat('a/nothing in it.txt'), { kind: 'file', bytes: 0 });
      await refused(files.createFile('a/x.txt', bytes('replaced?')), 'EEXIST', 'a file onto a file');
      await refused(files.createFile('a/inner', bytes('replaced?')), 'EEXIST', 'a file onto a folder');
      await refused(files.createFile('a link.txt', bytes('replaced?')), 'EEXIST', 'a file onto a link');
      await refused(files.createFile('way nowhere', bytes('replaced?')), 'EEXIST', 'a file onto a link that leads nowhere');
      await refused(files.createFolder('a/inner'), 'EEXIST', 'a folder onto a folder');
      await refused(files.createFolder('a/x.txt'), 'EEXIST', 'a folder onto a file');
      await refused(files.createFile('nowhere/f.txt', bytes('x')), 'ENOENT', 'a file in a folder that is not there');
      // A Mac's disk takes names that differ only in case, or in how an accent is written, for one.
      await files.createFile('a/Café.txt', bytes('café'));
      if (await files.stat('a/CAFÉ.TXT')) {
        await refused(files.createFile('a/CAFÉ.TXT', bytes('replaced?')), 'EEXIST', 'the same name in capitals');
        await refused(files.createFile('a/Café.txt', bytes('replaced?')), 'EEXIST', 'the same name with its accent written apart');
      } else await say('      (this disk tells capitals apart, so that clash was not tried)');
      same(words(await files.read('a/x.txt')), 'first'); same(words(await files.read('a/Café.txt')), 'café');
    });
    await step('a rename goes only to a name not taken: not onto a file, not onto a folder, not even an empty one', async () => {
      await refused(files.rename('b/y.txt', 'a/x.txt'), 'EEXIST', 'a file onto a file');
      await refused(files.rename('a', 'empty'), 'EEXIST', 'a folder onto an empty folder');
      await refused(files.rename('b', 'a'), 'EEXIST', 'a folder onto a folder');
      await refused(files.rename('b/y.txt', 'a/inner'), 'EEXIST', 'a file onto a folder');
      await refused(files.rename('no such file', 'a/new'), 'ENOENT', 'what is not there');
      same([words(await files.read('a/x.txt')), words(await files.read('b/y.txt'))], ['first', 'second'], 'both untouched');
      await files.rename('b/y.txt', 'a/y.txt');
      await files.rename('empty', 'a/was empty');
      await files.createFolder('c'); await files.createFile('c/deep.txt', bytes('deep')); await files.rename('c', 'a/moved');
      same(words(await files.read('a/moved/deep.txt')), 'deep');
      same(await files.stat('b/y.txt'), null); same(await files.stat('c'), null);
      for (const name of ['a link.txt', 'way out', 'way to granted', 'way nowhere']) await refused(files.rename(name, 'a/moved link'), /A link is not moved/, name);
    });
    await step('a file from a stream: gathered, appended 8 MiB at a time, and what is written is what came (20 MiB)', async () => {
      const block = made(1024 * 1024 + 13, 3), count = 20, total = block.length * count;
      async function* source() { for (let n = 0; n < count; n++) { const lent = block.slice(); yield lent; lent.fill(0xee); } }
      same(await files.createFileFrom('a/streamed.bin', source()), { bytes: total });
      same(await files.stat('a/streamed.bin'), { kind: 'file', bytes: total });
      const whole = new Uint8Array(total); for (let n = 0; n < count; n++) whole.set(block, n * block.length);
      const want = await print(whole);
      same(await files.sha256('a/streamed.bin'), want, 'fingerprinted whole');
      same(await print(await readAll(files.readStream('a/streamed.bin'))), want, 'read back as a stream');
      same(await print(await files.read('a/streamed.bin')), want, 'read back whole');
      same(await files.createFileFrom('a/from a web stream.txt', new ReadableStream({ start(controller) { controller.enqueue(bytes('one ')); controller.enqueue(bytes('two')); controller.close(); } })), { bytes: 7 });
      same(words(await files.read('a/from a web stream.txt')), 'one two');
      same(await files.createFileFrom('a/empty stream.bin', (async function* () { /* nothing */ })()), { bytes: 0 });
      same(await files.stat('a/empty stream.bin'), { kind: 'file', bytes: 0 });
      await refused(files.createFileFrom('a/x.txt', source()), 'EEXIST', 'a stream onto a taken name');
      same(words(await files.read('a/x.txt')), 'first', 'the file there is untouched');
      let sent = false;
      const failing = new ReadableStream({ pull(controller) { if (sent) controller.error(new Error('the drive went away')); else { sent = true; controller.enqueue(made(9 * 1024 * 1024)); } } }, { highWaterMark: 0 });
      await refused(files.createFileFrom('a/half.bin', failing), /the drive went away/, 'a stream that fails after 9 MiB');
      await refused(files.createFileFrom('a/odd.txt', (async function* () { yield bytes('fine'); yield 'not bytes'; })()), /A piece of a\/odd.txt is not bytes/, 'a piece that is not bytes');
      await refused(files.createFileFrom('nowhere/f.txt', source()), 'ENOENT', 'a stream into a folder that is not there');
    });
    await step('nothing is written through a link: into another granted folder the interface refuses, out of them all the app does', async () => {
      await refused(files.createFile('way to granted/x.txt', bytes('x')), /Not inside the archive/, 'a file through a link to a granted folder');
      await refused(files.createFolder('way to granted/inner'), /Not inside the archive/, 'a folder through it');
      await refused(files.createFile('way out/x.txt', bytes('x')), 'EFORBIDDEN', 'a file through a link out');
      await refused(files.list('way out'), 'EFORBIDDEN', 'listing through a link out');
      await refused(files.read('way out/secret.txt'), 'EFORBIDDEN', 'reading through a link out');
      await refused(call(() => fs.readFile(dir + '/way out/secret.txt')), 'EFORBIDDEN', 'the plugin itself, through a link out');
      await refused(call(() => fs.writeFile(dir + '/way out/planted.txt', bytes('x'))), 'EFORBIDDEN', 'the plugin itself, writing through a link out');
      await refused(call(() => invoke('name_file', { from: dir + '/a/x.txt', to: dir + '/way out/stolen.txt' })), 'EFORBIDDEN', 'name_file through a link out');
      await refused(call(() => invoke('settle', { path: dir + '/way out/secret.txt' })), 'EFORBIDDEN', 'settle through a link out');
    });
    await step('the index cache is the one file rewritten; one program at a time holds the lock, and a lock whose program is gone is taken over', async () => {
      // The terminal left a lock here naming a process that has ended.
      same((await files.lockHolder())?.stale, true, 'the lock left by a program that is gone');
      await files.lock();
      const mine = await files.lockHolder(), who = await invoke('whoami');
      same([mine.pid, mine.host, mine.stale], [who.pid, who.host, false], 'the lock names this app');
      ok(who.pid > 1 && who.host, 'the app knows its process and this computer');
      await refused(tauriFiles(tauri, dir).lock({ wait: 150 }), 'ELOCKED', 'a second lock');
      await files.unlock();
      same(await files.lockHolder(), null);
      await files.replaceIndex(bytes('one')); await files.replaceIndex(bytes('two'));
      same(words(await files.read('.formfiller/index.json')), 'two');
      // And in a folder whose lock the terminal itself holds, the app waits, then says who holds it.
      await invoke('test_grant', { path: root + '/locked' });
      const held = tauriFiles(tauri, root + '/locked'), error = await refused(held.lock({ wait: 150 }), 'ELOCKED', 'the terminal\'s lock');
      ok(/Another Form Filler is changing this archive \(process \d+/.test(error.message), error.message);
      same((await held.lockHolder()).stale, false);
    });
    await step('a staging folder is removed whole, a link in it never followed; nothing else is removed', async () => {
      await files.createFolder('.ff-staging-0123456789abcdef'); await files.createFolder('.ff-staging-0123456789abcdef/inner');
      await files.createFile('.ff-staging-0123456789abcdef/inner/f.txt', bytes('staged'));
      await files.createFile('.ff-staging-fedcba9876543210', bytes('a file named like a staging folder'));
      await files.createFolder('a/.ff-staging-xyz');
      for (const path of ['a', 'a/.ff-staging-xyz', '.ff-staging-fedcba9876543210', 'staging link', 'way out']) await refused(files.discardStaging(path), /Not a staging folder Form Filler made/, path);
      // The terminal put a staging folder here with links out of it and into the other granted folder.
      await files.discardStaging('.ff-staging-00000000000000bb');
      await files.discardStaging('.ff-staging-0123456789abcdef');
      same(await files.stat('.ff-staging-0123456789abcdef'), null); same(await files.stat('.ff-staging-00000000000000bb'), null);
      same((await files.stat('a/.ff-staging-xyz'))?.kind, 'folder');
    });
    await step('an archive made through the app\'s files: filed, added to, moved, indexed and verified, with no hidden file left', async () => {
      const book = openArchive(files, { now: () => new Date(2026, 10, 17, 15, 30, 0) });
      await book.init();
      const { path } = await book.createItem({ matter: 'Taxes/2026', title: 'Form 1040', direction: 'out', counterparty: 'IRS', channel: 'export',
        files: [{ role: 'original', name: 'f1040.pdf', bytes: bytes('%PDF- the invented blank form') }, { role: 'filled', name: 'f1040.pdf', bytes: bytes('%PDF- the invented form, filled') }] });
      same(path, 'Taxes/2026/2026-11-17 sent IRS - Form 1040');
      await book.addFile(path, { role: 'confirmation', name: 'receipt.pdf', bytes: bytes('%PDF- an invented receipt') });
      const again = await book.createItem({ matter: 'Taxes/2026', title: 'Form 1040', direction: 'out', counterparty: 'IRS', channel: 'export' });
      same(again.path, 'Taxes/2026/2026-11-17 sent IRS - Form 1040 (2)');
      const moved = await book.moveItem(again.path, 'Housing/Rue de l’Été');
      same(moved.path, 'Housing/Rue de l’Été/2026-11-17 sent IRS - Form 1040 (2)');
      const report = await book.verify();
      same({ ok: report.ok, items: report.items, files: report.files, missing: report.missing, changed: report.changed, unfinished: report.unfinished, problems: report.problems }, { ok: true, items: 2, files: 3, missing: [], changed: [], unfinished: [], problems: [] }, 'verify');
      same((await book.rebuildIndex()).items.length, 2);
      const left = (await tree(files)).filter(path => /\.ff-new-|\.tmp$/.test(path));
      same(left, [], 'hidden half-written files');
    });
  }

  if (wants('store')) {
    const folder = places.data + '/vault', store = tauriStore(tauri, folder), data = tauriFiles(tauri, places.data);
    await step('the app\'s data folder is its own from the start; the store writes whole files there and keeps the copy before', async () => {
      same(await store.get('vault.json'), null); same(await store.list(), []);
      await store.put('locker/index.age', bytes('one')); await store.put('locker/index.age', bytes('two'));
      await store.put('profile.age', bytes('first')); await store.put('profile.age', bytes('second'), { prev: false });
      same([words(await store.get('locker/index.age')), words(await store.get('locker/index.age.prev')), words(await store.get('profile.age')), await store.get('profile.age.prev')], ['two', 'one', 'second', null]);
      same(await store.list(), ['locker/index.age', 'profile.age']); same(await store.list('locker/'), ['locker/index.age']);
      await refused(store.put('../outside', bytes('x')), /Not a name in the vault/, 'a name with ".."');
      await store.clear();
      same(await data.stat('vault'), null, 'cleared: the folder itself is gone too');
    });
    await step('a vault made in the store, at age\'s own work factor: your details and a locker document come back; a wrong passphrase is refused; forgotten, it leaves no folder', async () => {
      const passphrase = 'invented horse battery staple', started = performance.now();
      const { vault, recoveryKey } = await createVault(store, passphrase);
      const making = Math.round(performance.now() - started);
      await vault.writeProfile({ details: { fullName: 'Jane Roe', email: 'jane@example.org' }, signature: 'data:image/png;base64,iVBORw0KGgo=' });
      const document = made(3 * 1024 * 1024, 9), entry = await vault.addDocument({ title: 'Invented ID card', kind: 'id', name: 'card.pdf', bytes: document });
      vault.lock();
      same((await vaultInfo(store)).recipient, vault.recipient);
      same((await tree(data, 'vault')).sort(), ['vault/identity.age', 'vault/locker/', 'vault/locker/' + entry.id + '.age', 'vault/locker/index.age', 'vault/profile.age', 'vault/vault.json'].sort(), 'the vault\'s files');
      await refused(unlockVault(store, 'not the passphrase'), 'EPASSPHRASE', 'a wrong passphrase');
      const unlocking = performance.now(), opened = await unlockVault(store, passphrase), took = Math.round(performance.now() - unlocking);
      same((await opened.readProfile()).details, { fullName: 'Jane Roe', email: 'jane@example.org' });
      same(await print(await opened.readDocument(entry.id)), await print(document), 'the locker document, byte for byte');
      await opened.changePassphrase('another invented passphrase');
      opened.lock();
      await refused(unlockVault(store, passphrase), 'EPASSPHRASE', 'the old passphrase');
      const again = await unlockVault(store, 'another invented passphrase'); again.lock();
      const byKey = await unlockVault(store, recoveryKey); same((await byKey.listDocuments()).length, 1); byKey.lock();
      await say('      a vault made in ' + making + ' ms, unlocked in ' + took + ' ms');
      await forgetVault(store);
      same(await data.stat('vault'), null, 'forgotten: no folder is left');
    });
  }

  if (wants('home')) {
    await step('of your home folder the page learns only Form Filler\'s own names, and reaches nothing else in it', async () => {
      const home = places.home, parent = homeFiles(tauri, home);
      same(places.archive, home + '/Form Filler Archive');
      same(await parent.list(''), [{ name: '.ff-staging-00000000000000aa', kind: 'folder' }, { name: 'Form Filler Archive (restored 2026-11-17 1530) (2)', kind: 'other' }], 'what the app tells of the home folder');
      await refused(call(() => fs.readDir(home)), 'EFORBIDDEN', 'the plugin listing the home folder');
      await refused(call(() => fs.readFile(home + '/.zshrc')), 'EFORBIDDEN', 'the plugin reading a file there');
      await refused(call(() => fs.readFile(home + '/Documents/private.txt')), 'EFORBIDDEN', 'the plugin reading in Documents');
      await refused(call(() => fs.writeFile(home + '/planted.txt', bytes('x'))), 'EFORBIDDEN', 'the plugin writing there');
      await refused(call(() => fs.mkdir(home + '/Form Filler Archive')), 'EFORBIDDEN', 'the plugin making the archive before its name is granted');
      for (const name of ['Documents', '.zshrc', '', '..', 'Form Filler Archive/../Documents', 'Form Filler Archives', 'Form Filler Archive (restored 2026-11-17 1530) (0)', '.ff-staging-xyz'])
        await refused(call(() => invoke('grant_home', { name })), 'EFORBIDDEN', 'granting ' + JSON.stringify(name));
      for (const work of [() => parent.stat('Documents'), () => parent.list('Documents'), () => parent.read('.zshrc'), () => parent.createFile('notes.txt', bytes('x')), () => parent.rename('Form Filler Archive', 'Documents'), () => parent.discardStaging('Documents')])
        await refused(work, 'EFORBIDDEN', String(work));
      ok((await invoke('real_path', { path: home })).endsWith('/home'), 'the home folder\'s own real path is told, and nothing in it is read for that');
      await refused(call(() => invoke('real_path', { path: home + '/Documents' })), 'EFORBIDDEN', 'the real path of anything else there');
    });
    await step('a restore\'s moves in the home folder: staged out of sight, put in place with one rename, never onto a name that is taken, a link included', async () => {
      const home = places.home, parent = homeFiles(tauri, home), staging = '.ff-staging-0123456789abcdef';
      same(await parent.stat('Form Filler Archive'), null);
      await parent.createFolder(staging); await parent.createFolder(staging + '/archive'); await parent.createFolder(staging + '/archive/Taxes');
      same(await parent.createFileFrom(staging + '/archive/Taxes/filled - form.pdf', (async function* () { yield bytes('%PDF- an invented form'); })()), { bytes: 22 });
      await parent.rename(staging + '/archive', 'Form Filler Archive');
      same(words(await parent.read('Form Filler Archive/Taxes/filled - form.pdf')), '%PDF- an invented form');
      same(await parent.stat('Form Filler Archive'), { kind: 'folder', bytes: 0 });
      // Again: the name is taken, so is the next (the terminal put a link there), and the copy goes to the one after.
      await parent.createFolder(staging + '/archive');
      await refused(parent.rename(staging + '/archive', 'Form Filler Archive'), 'EEXIST', 'onto the archive');
      await parent.rename(staging + '/archive', 'Form Filler Archive (restored 2026-11-17 1530)');
      await parent.createFolder(staging + '/archive');
      await refused(parent.rename(staging + '/archive', 'Form Filler Archive (restored 2026-11-17 1530) (2)'), 'EEXIST', 'onto a name a link has');
      await refused(parent.createFile('Form Filler Archive (restored 2026-11-17 1530) (2)/x.txt', bytes('x')), 'EFORBIDDEN', 'through that link');
      await parent.rename(staging + '/archive', 'Form Filler Archive (restored 2026-11-17 1530) (3)');
      await parent.discardStaging(staging);
      same((await parent.list('')).map(entry => entry.name), ['.ff-staging-00000000000000aa', 'Form Filler Archive', 'Form Filler Archive (restored 2026-11-17 1530)', 'Form Filler Archive (restored 2026-11-17 1530) (2)', 'Form Filler Archive (restored 2026-11-17 1530) (3)']);
      // The archive in its usual place is an archive like any other.
      await invoke('grant_home', { name: 'Form Filler Archive' });
      const book = openArchive(tauriFiles(tauri, places.archive));
      await book.init();
      same((await book.rebuildIndex()).notRecorded, ['Taxes/filled - form.pdf'], 'what the index finds there');
    });
  }

  if (wants('page')) {
    const early = () => (window.__ffEarly || []).filter(line => !/service ?worker/i.test(line));
    const summary = () => document.querySelector('#app .panel .subtle')?.textContent || '';
    const open = async (name, type, wanted) => {
      const data = new Uint8Array(await invoke('test_fixture', { name })), picker = document.querySelector('#form-file'), carried = new DataTransfer();
      carried.items.add(new File([data], name, { type }));
      picker.files = carried.files;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      for (const started = performance.now(); ;) {
        if (!document.querySelector('#app .busy') && wanted.test(summary())) return Math.round(performance.now() - started);
        if (performance.now() - started > 180000) throw new Error('after 3 minutes (window ' + document.visibilityState + ') the page says: ' + (document.querySelector('#app .busy')?.textContent || summary() || document.querySelector('#app .note')?.textContent || 'nothing'));
        await new Promise(done => setTimeout(done, 100));
      }
    };
    const labels = () => [...document.querySelectorAll('.list li .label')].map(span => span.textContent);
    // What an earlier build of the test app left in the window's own storage is cleared, so that anything found there
    // afterwards was put there by this one.
    for (const key of Object.keys(localStorage)) if (key.startsWith('ff:')) localStorage.removeItem(key);
    await step('the page is Form Filler\'s own, served by the app, and it loaded with nothing blocked', async () => {
      same(location.origin, 'tauri://localhost');
      ok(document.querySelector('#desk .desk-bar'), 'the app\'s own bar is across the top');
      ok(/Form Filler \d+\.\d+\.\d+/.test(document.querySelector('footer.version')?.textContent || ''), 'the footer says the version');
      ok(document.querySelector('#form-file'), 'the form picker is there');
      same(early(), [], 'what went wrong while the page loaded');
    });
    await step('a PDF opens under the content policy: the text reader\'s worker and WebAssembly load, and its 13 blanks are found', async () => {
      const took = await open('form.pdf', 'application/pdf', /13 blanks found/);
      same(labels().slice(9, 11), ['Day', 'Night'], 'each checkbox by its own caption');
      await say('      form.pdf read in ' + took + ' ms: ' + labels().join(' | '));
      same(early(), [], 'blocked or failed while it opened');
    });
    await step('a PDF with its own fields, and a crooked phone photo, open as they do on the web page', async () => {
      await open('fillable.pdf', 'application/pdf', /9 blanks found · 8 are the PDF’s own fields/);
      await open('form-photo.png', 'image/png', /13 blanks found · straightened 1\.2°/);
      same(early(), [], 'blocked or failed while they opened');
      // Each form's blanks are remembered as a file in the data folder (written just after the form is read), and
      // nothing is kept in the window's own storage.
      const remembered = tauriFiles(tauri, places.data);
      for (let tries = 0; (await remembered.stat('templates') ? (await remembered.list('templates')).length : 0) < 3; tries++) { if (tries > 50) throw new Error('the three forms were not remembered in the data folder: ' + JSON.stringify(await tree(remembered))); await invoke('test_wait', { ms: 100 }); }
      same(Object.keys(localStorage).filter(key => key.startsWith('ff:')), [], 'kept in the window\'s own storage');
    });
    await step('nothing is fetched from anywhere but the app itself, and the window goes nowhere else', async () => {
      await refused(fetch('https://example.org/'), /./, 'a fetch from the web');
      const picture = await new Promise(done => { const image = new Image(); image.onload = () => done('loaded'); image.onerror = () => done('refused'); image.src = 'https://example.org/picture.png'; });
      same(picture, 'refused', 'a picture from the web');
      const blocked = (window.__ffEarly || []).filter(line => line.startsWith('content policy: '));
      ok(blocked.some(line => /connect-src/.test(line)) && blocked.some(line => /img-src/.test(line)), 'the content policy said so: ' + JSON.stringify(blocked));
      window.__ffEarly = [];
      location.href = 'https://example.org/';
      await new Promise(done => setTimeout(done, 1500));
      same(location.origin, 'tauri://localhost', 'still on its own page');
    });
    await say('      window.print is ' + typeof window.print + '; a service worker ' + (navigator.serviceWorker?.controller ? 'controls the page' : 'does not control the page') + '; streams ' + (typeof ReadableStream.prototype[Symbol.asyncIterator] === 'function' ? 'can' : 'cannot') + ' be read with for-await here');
  }

  if (wants('big')) {
    const megabytes = Number(run.find(item => item.startsWith('big='))?.slice(4)) || 2048;
    await invoke('test_grant', { path: root + '/big' });
    const archive = tauriFiles(tauri, root + '/big/archive'), drive = tauriFiles(tauri, root + '/big/drive'), restored = tauriFiles(tauri, root + '/big/restored'), data = tauriFiles(tauri, places.data);
    const MB = 1024 * 1024, clock = () => new Date(2026, 10, 17, 15, 30, 0);
    let wrote = 0, count = 0;
    await step('a made-up archive of ' + megabytes + ' MB written through the app\'s files', async () => {
      const started = performance.now(), book = openArchive(archive, { now: clock });
      await book.init();
      const { vault } = await createVault(tauriStore(tauri, places.data + '/vault'), 'invented horse battery staple');
      await vault.writeProfile({ details: { fullName: 'Jane Roe' } });
      await vault.addDocument({ title: 'Invented ID card', name: 'card.pdf', bytes: made(2 * MB, 5) });
      vault.lock();
      // Half of it in scans of 64 MB, a quarter in files of 1 MB, a quarter in files of 64 KB: about as many small
      // files as megabytes.
      const big = made(64 * MB, 1), middle = made(MB, 2), small = made(64 * 1024, 3);
      const plan = [[big, Math.max(1, Math.round(megabytes / 2 / 64)), 'scan', 1], [middle, Math.round(megabytes / 4), 'page', 40], [small, Math.round(megabytes / 4 * 16), 'note', 200]];
      for (const [block, files, role, perItem] of plan) {
        for (let done = 0, item = 0; done < files; item++) {
          const documents = [];
          for (let n = 0; n < perItem && done < files; n++, done++) { const lent = block.slice(); lent[0] = done & 255; lent[1] = (done >> 8) & 255; documents.push({ role, name: role + ' ' + done + '.bin', bytes: lent }); }
          await book.createItem({ matter: 'Made up/' + role + 's', title: role + ' batch ' + item, direction: 'in', counterparty: 'Nobody', files: documents });
          wrote += documents.reduce((sum, document) => sum + document.bytes.length, 0); count += documents.length;
        }
      }
      const seconds = (performance.now() - started) / 1000;
      await say('      ' + count + ' files, ' + Math.round(wrote / MB) + ' MB, written in ' + seconds.toFixed(1) + ' s (' + Math.round(wrote / MB / seconds) + ' MB/s), each written through to the disk');
    });
    let backup = null;
    const timed = async (name, bytesDone, work) => {
      const started = performance.now(); let longest = 0, last = started, ticking = true;
      // How long the page goes without answering while the work runs: a timer that should fire every 50 ms.
      (async () => { while (ticking) { await new Promise(done => setTimeout(done, 50)); const now = performance.now(); longest = Math.max(longest, now - last - 50); last = now; } })();
      const result = await work(); ticking = false;
      const seconds = (performance.now() - started) / 1000;
      await say('      ' + name + ': ' + seconds.toFixed(1) + ' s, ' + Math.round(bytesDone() / MB / seconds) + ' MB/s; the page\'s longest pause was ' + Math.round(longest) + ' ms (window ' + document.visibilityState + ')');
      return result;
    };
    await step('backed up to another folder, read back and checked against its fingerprint', async () => {
      backup = await timed('backup', () => wrote, () => makeBackup({ data, archive, destination: drive, now: clock }));
      same([backup.files > count, backup.skipped], [true, []]);
      same((await listBackups(drive)).backups.map(entry => entry.path), [backup.path]);
      await say('      snapshot.tar.age is ' + Math.round(backup.sealed / MB) + ' MB for ' + backup.files + ' files');
    });
    await step('checked fully with the passphrase: every file in it against the manifest', async () => {
      const report = await timed('full check', () => wrote, () => verifyBackup(tauriFiles(tauri, root + '/big/drive/' + backup.path), { secret: 'invented horse battery staple' }));
      same([report.ok, report.fully, report.problems], [true, true, []]);
    });
    await step('restored into an empty place: every file checked, then moved into place', async () => {
      const store = tauriStore(tauri, places.data + '/vault');
      await forgetVault(store);
      const result = await timed('restore', () => wrote, () => restoreBackup({ backup: tauriFiles(tauri, root + '/big/drive/' + backup.path), secret: 'invented horse battery staple', data, archive: { parent: restored, name: 'Form Filler Archive' } }));
      same(result.placed.map(item => item.beside), result.placed.map(() => false), 'nothing went beside');
      const book = openArchive(tauriFiles(tauri, root + '/big/restored/Form Filler Archive'), { now: clock });
      const report = await timed('the archive\'s own check of every file', () => wrote, () => book.verify());
      same([report.ok, report.files], [true, count]);
    });
    void BACKUPS;
  }

  if (wants('screens')) {
    const PASSPHRASE = 'invented horse battery staple', here = root + '/screens';
    const app = document.getElementById('app'), desk = () => document.getElementById('desk');
    const said = () => desk().innerText.replace(/\s+/g, ' ');
    // What a person does: a button pressed, a box typed in. And a wait kept by the app, since a page's own timers slow.
    const press = selector => { const target = document.querySelector(selector); if (!target) throw new Error('nothing to press at ' + selector + '; the screen says: ' + said().slice(0, 300)); target.click(); };
    const act = name => press('#desk [data-act="' + name + '"]'), go = name => press('#desk [data-go="' + name + '"]');
    const type = (selector, value) => { const box = document.querySelector(selector); if (!box) throw new Error('no box at ' + selector + '; the screen says: ' + said().slice(0, 300)); box.value = value; box.dispatchEvent(new Event('input', { bubbles: true })); };
    const until = async (test, what, seconds = 90) => { for (const started = performance.now(); ;) { const found = await test(); if (found) return found; if (performance.now() - started > seconds * 1000) throw new Error('waited ' + seconds + ' s for ' + what + '; the screen says: ' + said().slice(0, 400) + ' | ' + (app.querySelector('.note')?.textContent || '')); await invoke('test_wait', { ms: 100 }); } };
    const says = (words, seconds) => until(() => !desk().querySelector('.busy') && said().includes(words), '“' + words + '”', seconds);
    const noted = words => until(() => [...app.querySelectorAll('.note')].some(item => item.textContent.includes(words)), 'the note “' + words + '”');
    // The dialogs answer with what this script puts in line, and grant it as a pick in the real dialog would.
    const answers = [], dialog = window.__TAURI__.dialog;
    const answer = async () => { const next = answers.shift() ?? null; if (next) await invoke('test_grant', { path: next }); return next; };
    dialog.open = answer; dialog.save = answer;
    const archive = () => tauriFiles(tauri, places.archive), dataFolder = tauriFiles(tauri, places.data);
    let stamp = '';

    await step('first run in the app: the vault is made in the data folder, the recovery key shown, the archive made in the home folder by name', async () => {
      await until(() => document.querySelector('#desk [name="setup-passphrase"]'), 'the setup screen');
      same(app.hidden, true, 'the form page waits behind the setup');
      type('[name="setup-passphrase"]', PASSPHRASE); type('[name="setup-again"]', PASSPHRASE);
      act('make-vault');
      const key = (await until(() => document.querySelector('#desk-key code'), 'the recovery key')).innerText.replace(/\s+/g, '');
      ok(/^AGE-SECRET-KEY-1[0-9A-Z]{58}$/.test(key), 'a recovery key is shown');
      act('key-kept');
      await until(() => document.querySelector('#desk [data-act="archive-home"]'), 'the archive step');
      act('archive-home');
      await until(() => !app.hidden, 'the form page');
      same((await tree(dataFolder, 'vault')).sort(), ['vault/identity.age', 'vault/profile.age', 'vault/vault.json']);
      same((await archive().list('')).map(entry => entry.name), ['.formfiller', '_Inbox', '_Unsorted']);
      same(JSON.parse(words(await dataFolder.read('settings.json'))).archive, { holder: 'home' });
    });
    await step('your details are saved locked, and your name, date of birth and address show by their last characters', async () => {
      document.getElementById('details-panel').open = true;
      for (const [key, value] of Object.entries({ fullName: 'Jane Roe', email: 'jane@example.org', address: '12 Elm Street', birthDate: '02/30/1980' })) type('[name="detail-' + key + '"]', value);
      press('#save-details');
      await noted('Your details are saved, locked with your passphrase.');
      await until(() => document.querySelector('[name="hidden-fullName"]'), 'the hidden name');
      same([...app.querySelectorAll('#details-panel .details input[readonly]')].map(box => box.value), ['••••••oe', '•••••••••reet', '••••••1980']);
      ok(!document.documentElement.innerHTML.includes('Jane Roe'), 'the name is nowhere in the page while it is hidden');
      ok(!words(await dataFolder.read('vault/profile.age')).includes('Jane Roe'), 'and not in plain text in the vault');
    });
    await step('a form is filled, its PDF saved where the dialog says, and filed in the archive with the form it came from', async () => {
      const bytesOf = new Uint8Array(await invoke('test_fixture', { name: 'form.pdf' })), picker = document.querySelector('#form-file'), carried = new DataTransfer();
      carried.items.add(new File([bytesOf], 'form.pdf', { type: 'application/pdf' }));
      picker.files = carried.files; picker.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => !app.querySelector('.busy') && /13 blanks found/.test(app.querySelector('.panel .subtle')?.textContent || ''), 'the form\'s 13 blanks', 180);
      same(app.querySelector('[data-blank]').value, '••••••oe', 'your name on the form, hidden');
      ok(!app.querySelector('#hand-photo'), 'no handwriting reader in the app');
      answers.push(here + '/saved/form - filled.pdf');
      press('#pdf-edit');
      await noted('Saved as ' + here + '/saved/form - filled.pdf');
      const saved = new Uint8Array(await call(() => fs.readFile(here + '/saved/form - filled.pdf')));
      same(words(saved.subarray(0, 5)), '%PDF-');
      press('#file-it');
      await until(() => document.querySelector('#desk [name="file-with"]'), 'the filing screen');
      type('[name="file-with"]', 'IRS'); type('[name="file-matter"]', 'Taxes/2026');
      act('file-it');
      await says('It is in your archive as');
      const report = await openArchive(archive()).verify();
      same([report.ok, report.items, report.files], [true, 1, 2], 'the archive verifies');
      const [item] = (await archive().list('Taxes/2026')).map(entry => entry.name);
      same((await archive().list('Taxes/2026/' + item)).map(entry => entry.name), ['filled - form - filled.pdf', 'original - form.pdf', 'record.json']);
      same(await archive().sha256('Taxes/2026/' + item + '/filled - form - filled.pdf'), await print(saved), 'the PDF that was saved, byte for byte');
      same(await archive().sha256('Taxes/2026/' + item + '/original - form.pdf'), await print(bytesOf), 'the form itself, byte for byte');
    });
    await step('the archive screen lists it and checks every file; the locker seals a document and gives back the same bytes', async () => {
      go('archive');
      await says('· IRS · form');
      act('shelf-check');
      await says('Every file is as it was filed: 1 item, 2 files');
      go('locker');
      await says('Nothing is in the locker yet.');
      answers.push(here + '/an invented card.pdf');
      act('doc-pick');
      await until(() => document.querySelector('#desk [name="doc-title"]'), 'the title box');
      type('[name="doc-title"]', 'Invented ID card');
      act('doc-add');
      await says('“Invented ID card” is in the locker.');
      answers.push(here + '/saved/a copy.pdf');
      act('doc-save');
      await says('A copy of “Invented ID card” was saved');
      same(await print(await call(() => fs.readFile(here + '/saved/a copy.pdf'))), await print(await call(() => fs.readFile(here + '/an invented card.pdf'))), 'the copy is the document, byte for byte');
      act('lock');
      await says('The locker is locked.');
      ok(!said().includes('Invented ID card'), 'locked, the locker shows nothing');
      type('[name="desk-secret"]', 'not the passphrase'); act('unlock'); await says('That passphrase does not open this vault.');
      type('[name="desk-secret"]', PASSPHRASE); act('unlock');
      await says('Invented ID card');
    });
    await step('a backup is made on the folder picked, read back, and checked fully with the passphrase', async () => {
      go('backup');
      await says('Choose a drive or a folder for them');
      answers.push(here + '/drive');
      act('backup-choose');
      await says('There is no backup there yet.');
      act('backup-now');
      await says('Backed up.', 180);
      const made = (await listBackups(tauriFiles(tauri, here + '/drive'))).backups;
      same([made.length, made[0].missing], [1, []]);
      stamp = made[0].name;
      act('check'); await says('matches its fingerprints');
      act('check-fully'); type('[name="check-secret"]', PASSPHRASE); act('check-go');
      await says('is whole and opens.', 180);
    });
    await step('the vault forgotten leaves no folder, and a restore puts it back in its place; the archive, still there, gets its copy beside it', async () => {
      go('form');
      document.getElementById('details-panel').open = true;
      press('#forget-details');
      ok(/every document in your locker from this Mac for good/.test(app.querySelector('#details-panel .warn').textContent), 'the warning says the locker goes too');
      press('#forget-yes');
      await noted('Your details are forgotten');
      same(await dataFolder.stat('vault'), null, 'no empty folder is left');
      go('backup');
      await until(() => document.querySelector('#desk [data-act="restore-this"]'), 'the backup in the list');
      act('restore-this');
      type('[name="restore-secret"]', PASSPHRASE);
      act('restore-go');
      await says('Nothing was overwritten.', 240);
      ok(/Your vault[^.]*: back in place\./.test(said()), 'the vault is back in place: ' + said().slice(0, 300));
      ok(/Your archive: something was there already, so this copy is beside it, as “Form Filler Archive \(restored /.test(said()), 'the archive\'s copy is beside it');
      same((await tree(dataFolder, 'vault')).filter(path => !path.endsWith('/')).length, 5, 'the vault\'s five files');
      const beside = tauriFiles(tauri, await invoke('grant_home', { name: 'Form Filler Archive (restored ' + stamp + ')' }));
      same((await openArchive(beside).verify()).ok, true, 'the copy beside verifies');
    });
  }

  // Where the time of a backup's check goes: each stage alone, on a made-up snapshot of a few large files.
  if (wants('bench')) {
    const megabytes = Number(run.find(item => item.startsWith('bench='))?.slice(6)) || 512, MB = 1024 * 1024, secret = 'invented horse battery staple';
    await invoke('test_grant', { path: root + '/big' });
    const archive = tauriFiles(tauri, root + '/big/archive'), drive = tauriFiles(tauri, root + '/big/drive'), data = tauriFiles(tauri, places.data);
    const book = openArchive(archive);
    await book.init();
    const { vault } = await createVault(tauriStore(tauri, places.data + '/vault'), secret);
    await vault.writeProfile({ details: { fullName: 'Jane Roe' } }); vault.lock();
    const block = made(64 * MB, 1);
    for (let n = 0; n < Math.round(megabytes / 64); n++) { block[0] = n; await book.createItem({ matter: 'Made up', title: 'scan ' + n, direction: 'in', counterparty: 'Nobody', files: [{ role: 'scan', name: 'scan ' + n + '.bin', bytes: block }] }); }
    const stage = async (name, size, work) => {
      const started = performance.now(); let longest = 0, last = started, ticking = true;
      (async () => { while (ticking) { await new Promise(done => setTimeout(done, 20)); const now = performance.now(); longest = Math.max(longest, now - last - 20); last = now; } })();
      const result = await work(); ticking = false;
      const seconds = (performance.now() - started) / 1000;
      await say('      ' + name.padEnd(58) + seconds.toFixed(1).padStart(6) + ' s ' + String(Math.round(size / MB / seconds)).padStart(5) + ' MB/s   longest pause ' + Math.round(longest) + ' ms   (window ' + document.visibilityState + (document.hasFocus() ? ', in front' : ', not in front') + ')');
      return result;
    };
    const drain = async stream => { const reader = stream.getReader(); let size = 0; for (;;) { const { done, value } = await reader.read(); if (done) return size; size += value.length; } };
    const backup = await stage('backup, whole', megabytes * MB, () => makeBackup({ data, archive, destination: drive }));
    const folder = tauriFiles(tauri, root + '/big/drive/' + backup.path), sealed = backup.sealed;
    await stage('verifyBackup with the passphrase, whole (first)', sealed, () => verifyBackup(folder, { secret }));
    // The same check with the window hidden, then minimized: what macOS does to a page nobody can see.
    if (wants('hidden')) {
      await say('      the app ' + ((await setting('throttling')) === 'default' ? 'leaves macOS free to slow a hidden page' : 'asks macOS not to slow a hidden page'));
      for (const [state, back] of run.includes('hidden=all') ? [['hide', 'show'], ['minimize', 'unminimize']] : [['hide', 'show']]) {
        await invoke('test_window', { state });
        for (const seconds of [5, 45]) {
          await invoke('test_wait', { ms: seconds * 1000 });
          await stage('the same check, ' + state + ' for ' + seconds + ' s more', sealed, () => verifyBackup(folder, { secret }));
        }
        await invoke('test_window', { state: back });
        await invoke('test_wait', { ms: 2000 });
      }
      await stage('the same check, the window shown again', sealed, () => verifyBackup(folder, { secret }));
    }
    await stage('verifyBackup, the copy only (no passphrase)', sealed, () => verifyBackup(folder));
    await stage('the key opened with the passphrase (scrypt)', 0, async () => unlockKey(await folder.read('identity.age'), secret));
    for (const piece of [65536, MB, 4 * MB]) await stage('read the snapshot, ' + piece / 1024 + ' KiB at a time', sealed, () => drain(tauriFiles(tauri, root + '/big/drive/' + backup.path, { piece }).readStream('snapshot.tar.age')));
    await stage('SHA-256 in JavaScript, of 64 MB in memory, 1 MiB at a time', 64 * MB, async () => { const hash = hasher.create(); for (let at = 0; at < block.length; at += MB) hash.update(block.subarray(at, at + MB)); return hex(hash.digest()); });
    await stage('SHA-256 by the system (WebCrypto), of 64 MB in memory', 64 * MB, () => crypto.subtle.digest('SHA-256', block));
    await stage('fingerprint the snapshot (read and SHA-256 in JavaScript)', sealed, () => folder.sha256('snapshot.tar.age'));
    const key = await unlockKey(await folder.read('identity.age'), secret);
    for (const piece of [65536, MB, 4 * MB]) await stage('open it with age only, read ' + piece / 1024 + ' KiB at a time', sealed, async () => drain(await key.decrypt(tauriFiles(tauri, root + '/big/drive/' + backup.path, { piece }).readStream('snapshot.tar.age'))));
    await stage('open with age, and read the tar member by member', sealed, async () => readTar(await key.decrypt(folder.readStream('snapshot.tar.age')), async ({ pieces }) => { await drain(pieces); }));
    await stage('the same, each member fingerprinted in JavaScript', sealed, async () => readTar(await key.decrypt(folder.readStream('snapshot.tar.age')), async ({ pieces }) => { const hash = hasher.create(), reader = pieces.getReader(); for (;;) { const { done, value } = await reader.read(); if (done) break; hash.update(value); } hash.digest(); }));
    await stage('verifyBackup with the passphrase, whole', sealed, () => verifyBackup(folder, { secret }));
    await forgetVault(tauriStore(tauri, places.data + '/vault'));
  }

  // What a hidden window does to the page's own work: a form opened while the window cannot be seen.
  if (wants('pagehidden')) {
    for (const key of Object.keys(localStorage)) if (key.startsWith('ff:template:')) localStorage.removeItem(key);
    const summary = () => (document.querySelector('.busy')?.textContent || '') + ' | ' + (document.querySelector('.panel .subtle')?.textContent || '');
    const start = async name => {
      const data = new Uint8Array(await invoke('test_fixture', { name })), picker = document.querySelector('#form-file'), carried = new DataTransfer();
      carried.items.add(new File([data], name, { type: name.endsWith('.pdf') ? 'application/pdf' : 'image/png' }));
      picker.files = carried.files; picker.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const found = () => /blanks found/.test(document.querySelector('.panel .subtle')?.textContent || '') && !document.querySelector('.busy');
    for (const name of ['form.pdf', 'form-photo.png']) {
      await invoke('test_window', { state: 'hide' }); await invoke('test_wait', { ms: 3000 });
      const started = performance.now();
      await start(name);
      let hidden = null;
      for (const seconds of [5, 15, 30]) { await invoke('test_wait', { ms: (seconds === 5 ? 5 : seconds === 15 ? 10 : 15) * 1000 }); if (found() && hidden === null) hidden = seconds; await say('      ' + name + ', window ' + document.visibilityState + ', after ' + seconds + ' s: ' + summary()); }
      await invoke('test_window', { state: 'show' });
      const shown = performance.now();
      while (!found() && performance.now() - shown < 60000) await invoke('test_wait', { ms: 200 });
      await say('      ' + name + ': ' + (hidden !== null ? 'read while hidden, within ' + hidden + ' s' : found() ? 'not read while hidden for 30 s; read ' + ((performance.now() - shown) / 1000).toFixed(1) + ' s after the window was shown' : 'not read even a minute after the window was shown') + ' (' + Math.round((performance.now() - started) / 1000) + ' s in all)');
    }
  }

  if (wants('pick')) {
    const picked = root + '/picked', dialog = window.__TAURI__.dialog;
    await step('a folder picked in the real dialog is the app\'s to use, with its subfolders and hidden names; its neighbours are not', async () => {
      await refused(tauriFiles(tauri, picked).list(''), 'EFORBIDDEN', 'before the pick');
      await say('WAITING for the folder "picked" to be chosen in the dialog (it is the one shown: press Open)');
      const chosen = await dialog.open({ directory: true, recursive: true, title: 'Form Filler Test: choose the folder named picked', defaultPath: picked });
      same(chosen, picked, 'the folder the dialog gave back');
      const book = openArchive(tauriFiles(tauri, picked), { now: () => new Date(2026, 10, 17, 15, 30, 0) });
      await book.init();
      const { path } = await book.createItem({ matter: 'Taxes/2026', title: 'Form 1040', direction: 'out', counterparty: 'IRS', files: [{ role: 'filled', name: 'f1040.pdf', bytes: bytes('%PDF- an invented form') }] });
      same((await book.verify()).ok, true, 'an archive made in it verifies: ' + path);
      await refused(tauriFiles(tauri, root + '/other').list(''), 'EFORBIDDEN', 'the folder beside it');
      await refused(call(() => fs.readDir(root)), 'EFORBIDDEN', 'the folder that holds it');
    });
    await step('a file named in the real save dialog can be written, and nothing beside it', async () => {
      await say('WAITING for the save dialog (the name and place are filled in: press Save)');
      const target = await dialog.save({ title: 'Form Filler Test: save here', defaultPath: root + '/saved/filled by the dialog.pdf' });
      same(target, root + '/saved/filled by the dialog.pdf', 'the path the dialog gave back');
      await call(() => fs.writeFile(target, bytes('%PDF- saved through the dialog')));
      same(words(await call(() => fs.readFile(target))), '%PDF- saved through the dialog');
      await refused(call(() => fs.writeFile(root + '/saved/another file.pdf', bytes('x'))), 'EFORBIDDEN', 'another file in that folder');
    });
  }

  if (wants('picked')) {
    await step('after a restart, the folder picked before is still the app\'s to use, with no new pick; nothing else is', async () => {
      const book = openArchive(tauriFiles(tauri, root + '/picked'), { now: () => new Date(2026, 10, 18, 9, 0, 0) });
      const report = await book.verify();
      same([report.ok, report.items], [true, 1], 'the archive made before the restart');
      await book.createItem({ matter: 'Taxes/2026', title: 'Form 4868', direction: 'out', counterparty: 'IRS', files: [{ role: 'filled', name: 'f4868.pdf', bytes: bytes('%PDF- another invented form') }] });
      same((await book.verify()).items, 2);
      await refused(tauriFiles(tauri, root + '/other').list(''), 'EFORBIDDEN', 'the folder beside it');
      // A grant for one file (the save dialog's) is kept too; that it is, is told here, not required.
      await say('      the file named in the save dialog before the restart ' + (await call(() => fs.readFile(root + '/saved/filled by the dialog.pdf')).then(() => 'can still be read', () => 'can no longer be read')));
    });
  }

  if (wants('picker')) {
    await step('the page\'s own "Choose the form" button opens the file panel, and the form chosen there is read', async () => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('ff:template:')) localStorage.removeItem(key);
      await say('WAITING for tests/fixtures/form.pdf to be chosen with the page\'s "Choose the form" button');
      for (const started = performance.now(); ;) {
        const summary = document.querySelector('.panel .subtle')?.textContent || '';
        if (!document.querySelector('.busy') && /blanks found/.test(summary)) { ok(/^form\.pdf · 1 page · 13 blanks found/.test(summary), summary); break; }
        if (performance.now() - started > 480000) throw new Error('no form was chosen in 8 minutes');
        await new Promise(done => setTimeout(done, 200));
      }
    });
  }

  if (wants('print')) {
    await say('WAITING: the page asks to be printed with window.print(); look for the print panel, then close it');
    try { window.print(); await say('      window.print() came back'); } catch (error) { await say('      window.print() failed: ' + error); }
    await new Promise(done => setTimeout(done, 20000));
    await say('WAITING: now the app is asked to print the page (print_page); look for the print panel, then close it');
    await invoke('print_page').then(() => say('      print_page came back'), error => say('      print_page failed: ' + error));
    await new Promise(done => setTimeout(done, 20000));
  }

  const failed = results.filter(passed => !passed).length;
  await say('RESULT ' + (results.length - failed) + ' passed, ' + failed + ' failed');
  await invoke('test_done', { code: failed ? 1 : 0 });
})().catch(async error => {
  try { await window.__TAURI__.core.invoke('test_report', { what: 'FAIL  the checks themselves stopped: ' + (error?.stack || error) }); await window.__TAURI__.core.invoke('test_done', { code: 2 }); } catch { /* nothing more to say */ }
});
