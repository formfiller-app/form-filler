// Walks the Mac app's own screens by clicking, in a browser: first-run setup, your details kept locked and shown
// hidden, a form filled and its PDF saved and filed in the archive, the archive list, the locker, a backup made and
// checked, everything moved aside, a restore, and the vault forgotten. The page is the built one (dist), exactly as
// the app shows it; what the app itself would give the page (its file plugin, its commands, its dialogs) is stood in
// for here by tests/tauri-stand-in.js, over real folders in a temporary place, and a dialog answers with the folder
// or file the walk names. So this checks the screens and the page's code; scripts/mac-check.mjs checks the same file
// code inside the app itself. Everything is invented.
//   node scripts/walk-mac.cjs [dist] [--engine chromium|webkit] [--shots DIR]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const playwright = require('playwright');

const folder = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dist');
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const engine = option('--engine') || 'chromium', shots = option('--shots') ? path.resolve(option('--shots')) : null;
if (!playwright[engine]?.launch) { console.error('Unknown --engine "' + engine + '": use chromium or webkit.'); process.exit(2); }
const fixtures = path.resolve(__dirname, '../tests/fixtures');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'form-filler-walk-mac-'));
const data = path.join(work, 'data'), home = path.join(work, 'home'), drive = path.join(work, 'drive'), saved = path.join(work, 'saved'), archive = path.join(home, 'Form Filler Archive');
for (const made of [data, home, drive, saved, path.join(home, 'Documents')]) fs.mkdirSync(made, { recursive: true });
fs.writeFileSync(path.join(home, 'Documents/private.txt'), 'mine');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const PASSPHRASE = 'invented horse battery staple';
const DETAILS = { fullName: 'Jane Roe', email: 'jane@example.org', phone: '555-0100', address: '12 Elm Street', city: 'Springfield', state: 'IN', zip: '46001', birthDate: '02/30/1980' };
const hashOf = bytes => createHash('sha256').update(bytes).digest('hex');
// Every file under a folder by path with its SHA-256, and every folder as "path/".
const tree = (dir, at = '') => { const out = new Map(); for (const entry of fs.readdirSync(path.join(dir, at), { withFileTypes: true })) { const inner = at ? at + '/' + entry.name : entry.name; if (entry.isDirectory()) { out.set(inner + '/', 'folder'); for (const [name, hash] of tree(dir, inner)) out.set(name, hash); } else if (entry.isFile()) out.set(inner, hashOf(fs.readFileSync(path.join(dir, inner)))); } return out; };
const everyFile = dir => [...tree(dir)].filter(([, hash]) => hash !== 'folder').map(([name]) => path.join(dir, name));
const results = [];
let look = async () => '';
// A step that fails says where in this script it stopped, and what the app's screen said then.
const step = async (name, work) => {
  try { await work(); results.push([true, name]); console.log('PASS  ' + name); }
  catch (error) {
    results.push([false, name]);
    const line = String(error.stack || '').split('\n').find(frame => frame.includes('walk-mac.cjs'))?.trim() || '';
    console.log('FAIL  ' + name + '\n        ' + [...String(error.message).split('\n').slice(0, 8), line, 'the screen said: ' + (await look().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 500)].join('\n        '));
  }
};

// What the page is given in place of the app: each call crosses to this script, which asks the stand-in. Bytes
// cross as base64, and an error as its text, thrown in the page as the app's plugin throws it.
const PAGE_SIDE = () => {
  const toBytes = text => Uint8Array.from(atob(text), letter => letter.charCodeAt(0));
  const fromBytes = bytes => { let text = ''; for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000)); return btoa(text); };
  const out = value => value instanceof Uint8Array ? { $bytes: fromBytes(value) } : value;
  const back = value => !value || typeof value !== 'object' ? value : '$bytes' in value ? toBytes(value.$bytes) : '$date' in value ? new Date(value.$date) : Array.isArray(value) ? value.map(back) : Object.fromEntries(Object.entries(value).map(([name, item]) => [name, back(item)]));
  const ask = async (kind, name, args) => { const answer = await window.__ffBridge(kind, name, args); if (answer.error !== undefined) throw answer.error; return back(answer.value); };
  const files = {};
  for (const name of ['readDir', 'lstat', 'stat', 'readFile', 'writeFile', 'mkdir', 'rename', 'remove', 'copyFile']) files[name] = (...args) => ask('fs', name, args.map(out));
  files.open = async (...args) => {
    const { $handle } = await ask('fs', 'open', args);
    return { read: async buffer => { const bytes = await ask('handle', 'read', [$handle, buffer.length]); if (!bytes) return null; buffer.set(bytes); return bytes.length; }, close: () => ask('handle', 'close', [$handle]) };
  };
  window.__TAURI__ = { core: { invoke: (command, args) => ask('invoke', command, args || {}) }, fs: files, dialog: { open: options => ask('dialog', 'open', options || {}), save: options => ask('dialog', 'save', options || {}) } };
};

(async () => {
  const lib = await import(path.resolve(__dirname, '../src/lib/index.js'));
  const { nodeFiles } = await import(path.resolve(__dirname, '../src/lib/files/node.js'));
  const { nodeStore } = await import(path.resolve(__dirname, '../src/lib/stores/node.js'));
  const { tauriStandIn } = await import(path.resolve(__dirname, '../tests/tauri-stand-in.js'));
  const standIn = tauriStandIn({ granted: [data], home, data });
  const answers = [], asked = [], handles = new Map();
  let nextHandle = 0;
  const toBytes = value => value && typeof value === 'object' && '$bytes' in value ? new Uint8Array(Buffer.from(value.$bytes, 'base64')) : value === null ? undefined : value;
  const fromBytes = value => value instanceof Uint8Array ? { $bytes: Buffer.from(value).toString('base64') } : value instanceof Date ? { $date: value.getTime() } : Array.isArray(value) ? value.map(fromBytes)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, fromBytes(item)])) : value;
  const bridge = async (kind, name, args) => {
    try {
      if (kind === 'fs' && name === 'open') { handles.set(++nextHandle, await standIn.fs.open(...args.map(toBytes))); return { value: { $handle: nextHandle } }; }
      if (kind === 'fs') return { value: fromBytes(await standIn.fs[name](...args.map(toBytes))) };
      if (kind === 'handle' && name === 'read') { const buffer = new Uint8Array(args[1]), read = await handles.get(args[0]).read(buffer); return { value: read ? fromBytes(buffer.subarray(0, read)) : null }; }
      if (kind === 'handle') { await handles.get(args[0])?.close(); handles.delete(args[0]); return { value: null }; }
      if (kind === 'invoke') return { value: fromBytes(await standIn.invoke(name, args)) };
      // A dialog answers with what the walk put in line for it, and grants it as the app's dialog would.
      asked.push(name + ': ' + (args.title || args.defaultPath || ''));
      const answer = answers.length ? answers.shift() : null;
      if (answer) await standIn.grant(answer);
      return { value: answer };
    } catch (error) { return { error: typeof error === 'string' ? error : String(error?.message || error) }; }
  };

  const server = http.createServer((request, response) => {
    const file = path.join(folder, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(folder) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await playwright[engine].launch();
  console.log('Walking the Mac app\'s screens in ' + engine + ' ' + browser.version() + ', over a stand-in for the app.');
  const outside = [], problems = [];
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  context.on('request', request => { const url = request.url(); if (!url.startsWith(origin) && !/^(data|blob):/.test(url)) outside.push(url); });
  await context.exposeFunction('__ffBridge', bridge);
  await context.addInitScript(PAGE_SIDE);
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/^(Estimating resolution|Detected \d+ diacritics)/.test(message.text())) problems.push(message.text()); });
  const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); } };
  const act = name => page.click('#desk [data-act="' + name + '"]');
  const go = name => page.click('#desk [data-go="' + name + '"]');
  const desk = () => page.locator('#desk').innerText();
  look = desk;
  // Until the screen says this, with nothing still running.
  const says = (words, timeout = 60000) => page.waitForFunction(wanted => !document.querySelector('#desk .busy') && document.querySelector('#desk').innerText.includes(wanted), words, { timeout });
  const note = (words, timeout = 60000) => page.waitForFunction(wanted => [...document.querySelectorAll('#app .note')].some(item => item.textContent.includes(wanted)), words, { timeout });
  const onForm = () => page.waitForFunction(() => !document.getElementById('app').hidden && document.querySelector('#desk .tab.on')?.textContent === 'Fill a form');
  const openForm = async (name, done) => { await page.setInputFiles('#form-file', path.join(fixtures, name)); await page.waitForFunction(text => !document.querySelector('#app .busy') && (document.querySelector('#app .panel .subtle')?.textContent || '').includes(text), done, { timeout: 120000 }); };
  const openDetails = () => page.evaluate(() => { document.getElementById('details-panel').open = true; });
  const vaultNow = async () => { const vault = await lib.unlockVault(nodeStore(path.join(data, 'vault')), PASSPHRASE); const state = { profile: await vault.readProfile(), documents: await vault.listDocuments() }; vault.lock(); return state; };
  const stamp = () => fs.readdirSync(path.join(drive, 'Form Filler Backups')).filter(name => /^\d{4}-\d{2}-\d{2} \d{4}/.test(name)).sort();
  let recoveryKey = '', item = '', before = null;

  await page.goto(origin);
  await step('first run: a passphrase makes the vault, the recovery key is shown once, and the archive is made in its usual place', async () => {
    await page.waitForSelector('#desk [name="setup-passphrase"]');
    assert.match(await desk(), /Welcome to Form Filler/);
    assert.equal(await page.evaluate(() => document.getElementById('app').hidden), true, 'the form page waits behind the setup');
    await page.fill('[name="setup-passphrase"]', PASSPHRASE); await page.fill('[name="setup-again"]', PASSPHRASE + ' not the same');
    await act('make-vault'); await says('The two passphrases are not the same.');
    await page.fill('[name="setup-passphrase"]', PASSPHRASE); await page.fill('[name="setup-again"]', PASSPHRASE);
    await act('make-vault');
    await page.waitForSelector('#desk-key code');
    recoveryKey = (await page.locator('#desk-key code').innerText()).replace(/\s+/g, '');
    assert.match(recoveryKey, /^AGE-SECRET-KEY-1[0-9A-Z]{58}$/);
    await shot('mac-1-recovery-key');
    await act('key-print');
    assert.ok(standIn.log.includes('print page'), 'the app was asked to print');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('print-desk-key')), true, 'the key alone is on the page to be printed');
    await act('key-kept');
    await page.waitForSelector('#desk [data-act="archive-home"]');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('print-desk-key')), false);
    assert.match(await desk(), /~\/Form Filler Archive/);
    // Another folder can be chosen, and one that a syncing service would copy elsewhere is warned of.
    fs.mkdirSync(path.join(home, 'Dropbox'));
    answers.push(path.join(home, 'Dropbox')); await act('archive-choose'); await says('copied to Dropbox');
    await act('archive-home');
    await onForm();
    assert.deepEqual(fs.readdirSync(archive).sort(), ['.formfiller', '_Inbox', '_Unsorted']);
    assert.deepEqual(fs.readdirSync(path.join(data, 'vault')).sort(), ['identity.age', 'profile.age', 'vault.json']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8')).archive.holder, 'home');
    assert.deepEqual(fs.readdirSync(path.join(home, 'Dropbox')), [], 'nothing was made in the folder that was not agreed to');
  });

  await step('your details are kept locked in the app\'s data folder, and your name, date of birth and address are shown by their last characters', async () => {
    await openDetails();
    for (const [key, value] of Object.entries(DETAILS)) await page.fill('[name="detail-' + key + '"]', value);
    await page.click('#save-details');
    await note('Your details are saved, locked with your passphrase.');
    await page.waitForSelector('[name="hidden-fullName"]');
    assert.deepEqual(await page.$$eval('#details-panel .details input[readonly]', inputs => inputs.map(input => [input.name, input.value])), [['hidden-fullName', '••••••oe'], ['hidden-address', '•••••••••reet'], ['hidden-birthDate', '••••••1980']]);
    assert.equal(await page.inputValue('[name="detail-email"]'), 'jane@example.org', 'an e-mail address is not hidden');
    assert.equal((await page.content()).includes('Jane Roe'), false, 'the name is nowhere in the page while it is hidden');
    for (const file of everyFile(data)) for (const secret of ['Jane Roe', 'Elm Street', '02/30/1980', 'jane@example.org']) assert.equal(fs.readFileSync(file, 'latin1').includes(secret), false, secret + ' is not in ' + path.basename(file));
    // Saved again while they are hidden, what is hidden stays as it was.
    await page.fill('[name="detail-phone"]', '555-0199'); await page.click('#save-details');
    for (let tries = 0; (await vaultNow()).profile.details.phone !== '555-0199'; tries++) { if (tries > 100) throw new Error('the changed phone number was not saved'); await page.waitForTimeout(100); }
    assert.deepEqual((await vaultNow()).profile.details, { ...DETAILS, phone: '555-0199', dateStyle: 'us' }, 'the hidden name, address and date of birth are as they were');
    await page.click('#details-panel [data-reveal]');
    assert.equal(await page.inputValue('[name="detail-fullName"]'), 'Jane Roe');
    await page.click('#details-panel [data-reveal]');
    await page.waitForSelector('[name="hidden-fullName"]');
    await shot('mac-2-details-hidden');
  });

  await step('on the filled form your name shows by its last characters until you ask; the PDF carries it whole, and is saved where the dialog says', async () => {
    await openForm('form.pdf', '13 blanks found');
    assert.equal(await page.locator('#hand-photo').count(), 0, 'no handwriting reader in the app: it would fetch its model from the web');
    const first = page.locator('[data-blank]').first();
    assert.deepEqual([await first.inputValue(), await first.getAttribute('readonly')], ['••••••oe', '']);
    assert.match(await page.locator('.list li').first().innerText(), /Name\s+••••••oe/);
    await page.click('.filled-panel [data-reveal]');
    assert.deepEqual([await page.locator('[data-blank]').first().inputValue(), await page.locator('[data-blank]').first().getAttribute('readonly')], ['Jane Roe', null]);
    await page.click('.filled-panel [data-reveal]');
    assert.equal(await page.locator('[data-blank]').first().inputValue(), '••••••oe');
    await page.fill('#answers', 'Respiratory Care\nVentilator. VNT-2219. 1');
    const target = path.join(saved, 'form - filled.pdf');
    answers.push(target);
    await page.click('#pdf-edit');
    await note('Saved as ' + target);
    const text = spawnSync('pdftotext', ['-layout', target, '-']).stdout.toString();
    assert.match(text, /Jane Roe/); assert.match(text, /Respiratory Care/);
    assert.match(asked.at(-1), /^save: /);
    // Printing shows what is hidden first: a printed form carries your details whole.
    const prints = standIn.log.filter(line => line === 'print page').length;
    await page.click('#print');
    await page.waitForFunction(() => document.querySelector('[data-blank]').value === 'Jane Roe');
    assert.equal(standIn.log.filter(line => line === 'print page').length, prints + 1);
    await page.click('.filled-panel [data-reveal]');
  });

  await step('the PDF just made is filed in the archive with the form it was made from, in a matter you name', async () => {
    await page.click('#file-it');
    await page.waitForSelector('#desk [name="file-with"]');
    await act('file-it'); await says('Say what it is, and who it is with.');
    await page.fill('[name="file-with"]', 'IRS'); await page.fill('[name="file-matter"]', 'Taxes/2026');
    await act('file-it');
    await says('It is in your archive as');
    const made = fs.readdirSync(path.join(archive, 'Taxes/2026'));
    assert.equal(made.length, 1); assert.match(made[0], /^\d{4}-\d{2}-\d{2} sent IRS - form$/);
    item = 'Taxes/2026/' + made[0];
    assert.deepEqual(fs.readdirSync(path.join(archive, item)).sort(), ['filled - form - filled.pdf', 'original - form.pdf', 'record.json']);
    const record = JSON.parse(fs.readFileSync(path.join(archive, item, 'record.json'), 'utf8'));
    assert.equal(record.form.sha256, hashOf(fs.readFileSync(path.join(fixtures, 'form.pdf'))), 'the record carries the form\'s fingerprint');
    assert.equal(hashOf(fs.readFileSync(path.join(archive, item, 'original - form.pdf'))), record.form.sha256, 'the form itself, byte for byte');
    assert.equal(hashOf(fs.readFileSync(path.join(archive, item, 'filled - form - filled.pdf'))), hashOf(fs.readFileSync(path.join(saved, 'form - filled.pdf'))), 'the PDF that was saved, byte for byte');
    assert.equal((await lib.openArchive(nodeFiles(archive)).verify()).ok, true, 'the archive verifies from the command line\'s side');
    await shot('mac-3-filed');
    // With no matter named it waits in _Unsorted.
    await go('form'); await onForm();
    await page.click('#file-it'); await page.waitForSelector('#desk [name="file-with"]');
    await page.fill('[name="file-title"]', 'A second copy'); await page.fill('[name="file-with"]', 'City Hall');
    await act('file-it'); await says('because no matter was named');
    assert.equal(fs.readdirSync(path.join(archive, '_Unsorted')).length, 1);
  });

  await step('the archive is listed by matter; every file is checked; an item is moved; Finder is asked to show it', async () => {
    await go('archive');
    await says('IRS · form');
    assert.match(await desk(), /Taxes\/2026/); assert.match(await desk(), /_Unsorted/);
    await act('shelf-check');
    await says('Every file is as it was filed: 2 items, 4 files');
    await page.click('#desk .item summary >> text=IRS · form');
    await page.fill('[name="move:' + item + '"]', 'Taxes:2026'); await page.click('#desk [data-act="move"][data-path="' + item + '"]');
    await says('Not a usable matter');
    await page.click('#desk .item summary >> text=IRS · form');
    await page.fill('[name="move:' + item + '"]', 'Taxes/2026/Federal'); await page.click('#desk [data-act="move"][data-path="' + item + '"]');
    await says('Moved to Taxes/2026/Federal/');
    item = 'Taxes/2026/Federal/' + path.basename(item);
    assert.ok(fs.existsSync(path.join(archive, item, 'record.json')));
    assert.equal((await desk()).includes('Every file is as it was filed'), false, 'an earlier check is not left standing after a change');
    await page.click('#desk .item summary >> text=IRS · form');
    await page.click('#desk [data-act="reveal"][data-path="' + item + '"]');
    await page.waitForFunction(() => true);
    assert.ok(standIn.log.includes('reveal ' + fs.realpathSync(path.join(archive, item))), 'Finder was asked for the item');
    // Something put in the folder by hand is told, and left as it is.
    fs.writeFileSync(path.join(archive, 'Taxes/2026/a loose note.txt'), 'put here in Finder');
    await act('shelf-again'); await says('a loose note.txt (not recorded)');
    await shot('mac-4-archive');
  });

  await step('the locker: a document is sealed in, listed, and a copy saved out is the same bytes; locked, it is not shown', async () => {
    await go('locker');
    await says('Nothing is in the locker yet.');
    answers.push(path.join(fixtures, 'options.pdf'));
    await act('doc-pick');
    await page.waitForSelector('#desk [name="doc-title"]');
    assert.equal(await page.inputValue('[name="doc-title"]'), 'options');
    await page.fill('[name="doc-title"]', 'Invented ID card'); await page.selectOption('[name="doc-kind"]', 'identity');
    await act('doc-add');
    await says('“Invented ID card” is in the locker.');
    assert.match(await desk(), /Invented ID card\s+identity · options\.pdf/);
    const documents = (await vaultNow()).documents;
    assert.deepEqual(documents.map(entry => [entry.title, entry.kind, entry.name, entry.sha256]), [['Invented ID card', 'identity', 'options.pdf', hashOf(fs.readFileSync(path.join(fixtures, 'options.pdf')))]]);
    assert.equal(fs.readFileSync(path.join(data, 'vault/locker', documents[0].id + '.age'), 'latin1').startsWith('age-encryption.org/v1'), true);
    answers.push(path.join(saved, 'a copy.pdf'));
    await act('doc-save'); await says('A copy of “Invented ID card” was saved');
    assert.equal(hashOf(fs.readFileSync(path.join(saved, 'a copy.pdf'))), hashOf(fs.readFileSync(path.join(fixtures, 'options.pdf'))));
    await act('lock');
    await says('The locker is locked.');
    assert.equal((await desk()).includes('Invented ID card'), false);
    await page.fill('[name="desk-secret"]', 'not the passphrase'); await act('unlock'); await says('That passphrase does not open this vault.');
    await page.fill('[name="desk-secret"]', PASSPHRASE); await act('unlock');
    await says('Invented ID card');
    await shot('mac-5-locker');
  });

  await step('a backup is made on the drive you pick, read back, and checked fully with the passphrase', async () => {
    await go('backup');
    await says('Choose a drive or a folder for them');
    answers.push(path.join(archive, '_Inbox')); await act('backup-choose'); await says('inside what a backup copies');
    answers.push(drive); await act('backup-choose');
    await says('There is no backup there yet.');
    before = { archive: tree(archive), vault: await vaultNow(), templates: tree(path.join(data, 'templates')) };
    await act('backup-now');
    await says('Backed up.');
    const [made] = stamp();
    assert.deepEqual(fs.readdirSync(path.join(drive, 'Form Filler Backups', made)).sort(), ['README.txt', 'identity.age', 'snapshot.sha256', 'snapshot.tar.age']);
    assert.match(await desk(), new RegExp(made.replace(/[()]/g, '\\$&')));
    assert.match(JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8')).backup.last, /^\d{4}-\d{2}-\d{2}T/);
    await act('check'); await says('matches its fingerprints');
    await act('check-fully'); await page.fill('[name="check-secret"]', 'not the passphrase'); await act('check-go'); await says('That passphrase does not open this key file.');
    await act('check-fully'); await page.fill('[name="check-secret"]', PASSPHRASE); await act('check-go');
    await says('is whole and opens.');
    assert.deepEqual(tree(archive), new Map([...before.archive]), 'a backup changes nothing in the archive');
    await shot('mac-6-backup');
  });

  await step('everything moved aside, the app knows nothing; restored from the drive, it is all back, byte for byte', async () => {
    fs.renameSync(data, data + ' aside'); fs.mkdirSync(data);
    fs.renameSync(archive, path.join(home, 'the archive, moved aside'));
    await page.reload();
    await page.waitForSelector('#desk [name="setup-passphrase"]');
    answers.push(drive);
    await act('restore-pick');
    await page.waitForSelector('#desk [name="restore-secret"]');
    assert.match(await desk(), /Your archive goes to ~\/Form Filler Archive/);
    await page.fill('[name="restore-secret"]', 'not the passphrase'); await act('restore-go'); await says('That passphrase does not open this key file.');
    assert.deepEqual([fs.readdirSync(data), fs.existsSync(archive)], [[], false], 'a wrong passphrase writes nothing');
    await page.fill('[name="restore-secret"]', PASSPHRASE); await act('restore-go');
    await says('Your archive: back in place', 120000);
    const said = await desk();
    for (const what of ['Your vault', 'The forms the app remembers', 'The app’s settings', 'Your archive']) assert.match(said, new RegExp(what + '[^\\n]*: back in place'), what);
    await shot('mac-7-restored');
    await Promise.all([page.waitForNavigation(), act('reload')]);
    await page.waitForSelector('#desk .lock:has-text("Locked")');
    assert.deepEqual(tree(archive), before.archive, 'the archive, folder for folder and byte for byte');
    assert.deepEqual(tree(path.join(data, 'templates')), before.templates);
    assert.deepEqual(await vaultNow(), before.vault, 'your details and the locker as they were');
    assert.deepEqual(fs.readdirSync(home).filter(name => name.startsWith('.ff-staging-')), [], 'no staging is left');
    assert.equal(fs.readFileSync(path.join(home, 'Documents/private.txt'), 'utf8'), 'mine');
    // And the app has it all again: the locker, the archive's list, and the form it remembered.
    await go('locker'); await page.fill('[name="desk-secret"]', recoveryKey); await act('unlock'); await says('Invented ID card');
    await go('archive'); await says('IRS · form');
    await go('form'); await onForm();
    await openForm('form.pdf', '13 blanks remembered from last time');
    assert.equal(await page.locator('[data-blank]').first().inputValue(), '••••••oe', 'your details fill the form again, hidden');
  });

  await step('restored again over what is there, nothing is overwritten: each copy goes beside', async () => {
    await go('backup');
    await page.waitForSelector('#desk [data-act="restore-this"]');
    const was = tree(archive);
    await act('restore-this');
    await page.fill('[name="restore-secret"]', PASSPHRASE); await act('restore-go');
    await says('Nothing was overwritten.', 120000);
    assert.equal((await desk()).match(/so this copy is beside it/g).length, 4);
    assert.deepEqual(tree(archive), was, 'the archive in place is untouched');
    const [made] = stamp();
    assert.deepEqual(tree(path.join(home, 'Form Filler Archive (restored ' + made + ')')), before.archive);
    assert.ok(fs.existsSync(path.join(data, 'vault (restored ' + made + ')', 'vault.json')));
    await Promise.all([page.waitForNavigation(), act('reload')]);
    await page.waitForSelector('#desk .lock:has-text("Locked")');
  });

  await step('forgetting everything kept here removes the vault and its folder, and leaves the archive and the backups', async () => {
    await openDetails();
    await page.fill('#unlock-secret', PASSPHRASE); await page.click('#unlock');
    await page.waitForSelector('#forget-details');
    await page.click('#forget-details');
    assert.match(await page.locator('#details-panel .warn').innerText(), /every document in your locker from this Mac for good/);
    await page.click('#forget-yes');
    await note('Your details are forgotten');
    assert.equal(fs.existsSync(path.join(data, 'vault')), false, 'no empty folder is left to stand in a restore\'s way');
    assert.equal(fs.existsSync(path.join(archive, item, 'record.json')), true);
    assert.equal(stamp().length, 1);
  });

  await step('nothing went wrong on the page, and nothing was asked of any web address', async () => {
    assert.deepEqual(problems, []);
    assert.deepEqual(outside, []);
    assert.ok(!standIn.log.some(line => line.startsWith('write file') && / (?!new|append)\S*$/.test(line) && line.includes(archive + '/') && !line.includes('.ff-new-')), 'no file in the archive was written under its own name');
  });

  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(work, { recursive: true, force: true });
  const failed = results.filter(([passed]) => !passed);
  console.log(failed.length ? failed.length + ' of ' + results.length + ' steps FAILED.' : 'All ' + results.length + ' steps pass.');
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
