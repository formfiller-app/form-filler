// Walks Form Filler in Chromium at phone size with the invented forms in tests/fixtures: a crooked phone photo of a
// form, the same form as a PDF, and a PDF with its own fill-in fields. Fills each, edits on the page, adds a blank,
// remembers a form, fills your details and today's date, signs, makes copies from a CSV, saves and reopens a template,
// prefills from a link, works offline, and (with --handwriting) reads the synthetic handwritten page. Every PDF is
// checked with pdftotext and pdf-lib.
//   node scripts/walk.cjs [dist] [--engine chromium|webkit] [--browser-path FILE] [--shots DIR] [--handwriting]
// --engine webkit walks the same steps in WebKit, the engine of Safari, of an iPhone and of the Mac app's window.
// --browser-path walks in another build of the engine (an older one, say) instead of the one Playwright installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const playwright = require('playwright');

const folder = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dist');
const shots = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const handwriting = process.argv.includes('--handwriting');
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const engine = option('--engine') || 'chromium', browserPath = option('--browser-path');
if (!playwright[engine]?.launch) { console.error('Unknown --engine "' + engine + '": use chromium or webkit.'); process.exit(2); }
const fixtures = path.resolve(__dirname, '../tests/fixtures');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'form-filler-walk-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const ANSWERS = 'Jane Roe. 11/13/2026. Respiratory Care\nVentilator. VNT-2219. 1\nOximeter. OX-77. 2\n-. x\nReturn by Friday. J. R. Smith';
// The invented passphrase the walk locks the invented details with, and the recovery key the page gives back.
const PASSPHRASE = 'invented horse battery staple';
let recoveryKey = '';
// A page unlocked again, once Lock now in another tab has locked it too (it locks every tab).
const unlockAgain = async (target, secret) => {
  await target.waitForSelector('#unlock-secret');
  await target.fill('#unlock-secret', secret); await target.click('#unlock');
  await target.waitForSelector('[name=detail-fullName]');
};
// What this browser holds for the page: localStorage as text, and each file of the vault in IndexedDB as text.
const held = target => target.evaluate(async () => ({
  plain: Object.entries(localStorage).map(([key, value]) => key + '=' + value).join('\n'),
  files: await new Promise((done, failed) => {
    const opening = indexedDB.open('form-filler-vault');
    opening.onerror = () => failed(opening.error);
    opening.onsuccess = () => {
      const tx = opening.result.transaction('files'), files = tx.objectStore('files'), keys = files.getAllKeys(), values = files.getAll();
      tx.oncomplete = () => done(keys.result.map((key, index) => [String(key), new TextDecoder().decode(values.result[index])]));
    };
  }),
}));
const HF = /^https:\/\/([a-z0-9-]+\.)*(huggingface\.co|hf\.co)\//;
const results = [];
const step = async (name, work) => { try { await work(); results.push([true, name]); console.log('PASS  ' + name); } catch (error) { results.push([false, name]); console.log('FAIL  ' + name + '\n        ' + String(error.message).split('\n').slice(0, 8).join('\n        ')); } };
// pdftotext's text; a complaint from poppler about the file fails the step.
const pdfText = file => { const run = spawnSync('pdftotext', ['-layout', file, '-']); assert.equal(run.stderr.toString(), '', 'poppler reads ' + path.basename(file) + ' without complaint'); return run.stdout.toString(); };
const today = (() => { const date = new Date(); return String(date.getMonth() + 1).padStart(2, '0') + '/' + String(date.getDate()).padStart(2, '0') + '/' + date.getFullYear(); })();

(async () => {
  const { PDFDocument } = await import('pdf-lib');
  const lib = await import(path.resolve(__dirname, '../src/lib/index.js'));
  const server = http.createServer((request, response) => {
    const file = path.join(folder, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(folder) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, origin = 'http://127.0.0.1:' + port + '/', sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  // The server gone, as when there is no connection (nothing can be fetched from it), and back again.
  const serverDown = () => new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy(); });
  const serverUp = () => new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const browser = await playwright[engine].launch(browserPath ? { executablePath: browserPath } : {});
  console.log('Walking in ' + engine + ' ' + browser.version() + (browserPath ? ' (' + browserPath + ')' : '') + '.');
  const outside = [], problems = [];
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
    context.on('request', request => { const url = request.url(); if (!url.startsWith(origin) && !/^(data|blob):/.test(url)) outside.push(url); });
    const page = await context.newPage();
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/^(Estimating resolution|Detected \d+ diacritics)/.test(message.text())) problems.push(message.text()); });
    return { context, page };
  };
  let { context, page } = await open();
  const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }); } };
  const values = () => page.$$eval('[data-blank]', inputs => inputs.map(input => input.type === 'checkbox' ? input.checked : input.value));
  const save = async (button, name) => { const [download] = await Promise.all([page.waitForEvent('download'), page.click(button)]); const file = path.join(scratch, name); await download.saveAs(file); return file; };
  const fieldsOf = async file => { const doc = await PDFDocument.load(fs.readFileSync(file)); return doc.getForm().getFields().map(field => [field.getName(), field.constructor.name === 'PDFCheckBox' ? field.isChecked() : field.constructor.name === 'PDFDropdown' ? field.getSelected()[0] : field.constructor.name === 'PDFRadioGroup' ? field.getSelected() : field.getText() ?? '']); };
  const summary = () => page.locator('.panel .subtle').first().innerText();
  const labels = () => page.$$eval('.list li .label', spans => spans.map(span => span.textContent));
  // On a PDF the page reads the words from its own drawing of the page. The invented PDFs name Helvetica without
  // carrying it, so each device draws them with its own fonts, and a caption can read differently there (on GitHub's
  // Linux machine "Day" came back "pay"). What must hold everywhere: a box is called by its own caption, by none
  // ("checkbox"), or is unclear, and then none of the words it might be is another box's caption.
  const readingsOf = label => [...label.matchAll(/“([^”]*)”/g)].map(match => match[1]);
  const nothingOf = (label, others) => label === 'checkbox' || (/^unclear: /.test(label) && readingsOf(label).every(reading => !others.includes(reading)));
  // The invented form's table: two rows of Item | Serial number | Qty, blanks 4 to 9. A cell is labelled by its own
  // column's header, or unlabelled ("blank") where the header's two reads did not agree: never another column's.
  const HEADERS = ['Item', 'Serial number', 'Qty'];
  const tableCells = async () => (await labels()).slice(3, 9);
  const ownHeaders = cells => cells.every((label, index) => label === HEADERS[index % 3] || label === 'blank');
  const openForm = async (name, done) => { await page.setInputFiles('#form-file', path.join(fixtures, name)); await page.waitForFunction(text => !document.querySelector('.busy') && (document.querySelector('.panel .subtle')?.textContent || '').includes(text), done, { timeout: 120000 }); };
  const typeAnswers = async text => { await page.fill('#answers', text); await page.waitForTimeout(100); };
  const expected = ['Jane Roe', '11/13/2026', 'Respiratory Care', 'Ventilator', 'VNT-2219', '1', 'Oximeter', 'OX-77', '2', false, true, 'Return by Friday', 'J. R. Smith'];

  await page.goto(origin);
  await step('the page is installable: a manifest with icons, and a service worker that keeps its files', async () => {
    const manifest = await (await page.request.get(origin + 'manifest.webmanifest')).json();
    assert.equal(manifest.display, 'standalone'); assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
    await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 30000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    const kept = await page.evaluate(async () => { const keys = await caches.keys(); const cache = await caches.open(keys.find(key => key.startsWith('form-filler-'))); return (await cache.keys()).length; });
    assert.ok(kept >= 15, kept + ' files kept');
    const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version;
    assert.match(await page.locator('footer.version').innerText(), new RegExp('^Form Filler ' + version.replace(/\./g, '\\.') + '( · [0-9a-f]{7})?$'), 'the page says which version it is');
  });
  // The page's first screen, and the worked example behind it (src/app/example.js, its words in example-words.js).
  // Everything in the example is invented; nothing in it is sent or kept, which the last of these steps checks.
  await step('the page opens with three ways in: an example, your own form, and finding a form', async () => {
    assert.deepEqual(await page.$$eval('.choice h3', titles => titles.map(title => title.textContent)), ['Try an example', 'Use my own form', 'Find a form']);
    assert.equal(await page.locator('#form-file').count(), 1, '"Use my own form" is the form picker itself');
    assert.equal(await page.locator('#template-file').count(), 1);
    assert.equal(await page.locator('.not-built').count(), 0, 'nothing on the first screen is marked unbuilt any more');
    assert.equal(await page.locator('#find-start').count(), 1, 'the third choice opens the finder');
  });
  // The finder (src/app/find.js, its forms and matching in find-words.js). Every form in it is invented, the matching
  // uses no model, and a question it cannot answer gets nothing rather than something plausible.
  await step('find a form: the whole bank of invented forms is listed, each saying who issued it, where it applies and when it was checked', async () => {
    await page.click('#find-start');
    await page.waitForSelector('#find-query');
    assert.equal(await page.locator('#form-file').count(), 0, 'the finder has the screen while it is open');
    const titles = await page.$$eval('.found h4', heads => heads.map(head => head.textContent));
    assert.ok(titles.length >= 10, 'a bank, not a handful: ' + titles.length + ' forms');
    for (const title of titles) assert.match(title, /\(invented form\)$/, title + ' says it is invented');
    assert.match(await page.locator('#find-count').innerText(), new RegExp('All ' + titles.length + ' invented forms'));
    const about = await page.$$eval('.found .about dt', terms => [...new Set(terms.map(term => term.textContent))]);
    assert.deepEqual(about, ['Issued by', 'Applies in', 'Last checked'], 'every card says all three');
    assert.ok(await page.locator('.found.stale').count() >= 1, 'a form checked longer ago than promised says so, rather than passing as fresh');
    assert.ok(await page.locator('.found.elsewhere').count() >= 1, 'a form whose blanks are not understood says it opens at the official site');
    await shot('find-1-bank');
  });
  await step('find a form: asking in plain words narrows the bank, and the caret stays where it was typed', async () => {
    await page.click('#find-try-0');
    await page.waitForFunction(() => document.querySelectorAll('.found').length > 0 && document.querySelectorAll('.found').length < 10, null, { timeout: 15000 });
    const first = await page.$$eval('.found h4', heads => heads.map(head => head.textContent));
    assert.match(first[0], /Withholding/, 'starting a job in Indiana puts the withholding form first, got: ' + first[0]);
    assert.ok(first.length < 10, 'and leaves the forms that have nothing to do with it out: ' + first.length + ' shown');
    assert.match(await page.locator('#find-count').innerText(), /of \d+ forms match/);
    // Typed into rather than clicked: the results change under the box and the caret is not thrown to the start.
    await page.fill('#find-query', '');
    await page.click('#find-query');
    await page.locator('#find-query').pressSequentially('a doctor wants my records');
    await page.waitForFunction(() => /Medical Records/.test(document.body.textContent), null, { timeout: 15000 });
    assert.deepEqual(await page.$eval('#find-query', box => [box.id, box.selectionStart === box.value.length]), ['find-query', true], 'the caret is still at the end of what was typed');
    assert.match((await page.$$eval('.found h4', heads => heads.map(head => head.textContent)))[0], /Medical Records/);
    await shot('find-2-asked');
  });
  await step('find a form: a question the bank cannot answer gets nothing, not a nearly-right form', async () => {
    await page.fill('#find-query', 'how do I register a hot air balloon on Mars');
    await page.waitForSelector('#find-nothing');
    assert.equal(await page.locator('.found').count(), 0, 'nothing is listed');
    assert.match(await page.locator('#find-nothing').innerText(), /no results rather than made-up ones/, 'and it says why');
    assert.match(await page.locator('#find-count').innerText(), /None of the \d+ forms here match/);
    await page.click('#find-clear');
    await page.waitForFunction(() => document.querySelectorAll('.found').length >= 10, null, { timeout: 15000 });
    await page.click('#find-leave');
    await page.waitForSelector('#example-start');
    assert.equal(await page.locator('.choice').count(), 3, 'leaving the finder brings the three ways in back');
    assert.equal(await page.locator('#form-file').count(), 1, 'and the form picker with them');
  });
  await step('try an example: an invented packet of three forms opens in one tap, already filled in', async () => {
    await page.click('#example-start');
    await page.waitForSelector('#example-packet');
    const titles = await page.$$eval('#example-packet .example-sheet h4', found => found.map(item => item.textContent));
    assert.equal(titles.length, 3);
    for (const title of titles) assert.match(title, /\(invented form\)$/, title + ' says it is invented');
    assert.match(await page.locator('#example-filled').innerText(), /^20 blanks$/, 'the packet arrives filled in');
    assert.equal(await page.locator('#example-packet .fields i').count(), 0, 'no blank is left empty');
    assert.match(await page.locator('.example-head').innerText(), /Nothing is sent, nothing is saved, no vault is made/);
    assert.equal(await page.locator('#form-file').count(), 0, 'the example is the whole screen: no form to find');
    await shot('example-1-packet');
  });
  await step('the address is changed once and lands on both forms that carry it, and on no other', async () => {
    const carried = () => page.$$eval('#example-carrying .example-sheet', sheets => sheets.map(sheet => ({
      form: sheet.dataset.form,
      address: sheet.querySelector('[data-field=address] dd')?.textContent,
      zip: sheet.querySelector('[data-field=zip] dd')?.textContent,
      marked: [...sheet.querySelectorAll('.field.changed dt')].map(mark => mark.textContent),
    })));
    assert.deepEqual(await carried(), [
      { form: 'withholding', address: '418 Larkspur Lane, Apt 3', zip: '47401', marked: [] },
      { form: 'deposit', address: '418 Larkspur Lane, Apt 3', zip: '47401', marked: [] },
    ]);
    await page.click('#example-move');
    assert.deepEqual(await carried(), [
      { form: 'withholding', address: '1620 Mulberry Court', zip: '47803', marked: ['Street address', 'City', 'ZIP code'] },
      { form: 'deposit', address: '1620 Mulberry Court', zip: '47803', marked: ['Street address', 'City', 'ZIP code'] },
    ], 'one change, on both forms at once');
    assert.match(await page.locator('#example-now').innerText(), /Now on both forms below: 1620 Mulberry Court, Terre Haute, IN 47803/);
    // The third form does not ask for an address, so nothing of it moved.
    const info = await page.locator('#example-packet [data-form=info]').innerText();
    assert.ok(!/Mulberry|Larkspur/.test(info), 'the information sheet asks for no address: ' + info.replace(/\n/g, ' · '));
    // Typed in by hand, it reaches both forms as it is typed, and the box keeps its caret (the screen is not redrawn).
    await page.$eval('#example-street', box => { box.focus(); box.setSelectionRange(box.value.length, box.value.length); });
    await page.locator('#example-street').pressSequentially(', rear');
    assert.deepEqual((await carried()).map(sheet => sheet.address), ['1620 Mulberry Court, rear', '1620 Mulberry Court, rear']);
    assert.deepEqual(await page.evaluate(() => [document.activeElement.id, document.activeElement.selectionStart === document.activeElement.value.length]), ['example-street', true], 'the box being typed in keeps the caret');
    await page.click('#example-back');
    assert.deepEqual((await carried()).map(sheet => sheet.address), ['418 Larkspur Lane, Apt 3', '418 Larkspur Lane, Apt 3']);
    await page.click('#example-move');
    await shot('example-2-address');
  });
  await step('what the people office would receive and what payroll would receive: only payroll carries the bank details', async () => {
    await page.click('#example-share');
    await page.waitForSelector('#share-hr');
    const hr = await page.locator('#share-hr').innerText(), payroll = await page.locator('#share-payroll').innerText();
    assert.deepEqual(await page.$$eval('#share-hr h5', found => found.map(item => item.textContent)), ['New Hire Information Sheet (invented form)', 'Indiana State Withholding — Form SW-1 (invented form)']);
    assert.deepEqual(await page.$$eval('#share-payroll h5', found => found.map(item => item.textContent)), ['Indiana State Withholding — Form SW-1 (invented form)', 'Direct Deposit Authorization (invented form)']);
    assert.ok(!/Routing number|Account number|Wabash|2337/.test(hr), 'the people office is sent nothing of the bank: ' + hr.replace(/\n/g, ' · '));
    assert.match(hr, /No bank details\./);
    assert.match(payroll, /Carries your bank details\./);
    for (const word of ['Routing number', 'Account number', 'Wabash Mutual Credit Union']) assert.ok(payroll.includes(word), 'payroll is sent ' + word);
    assert.match(payroll, /Account number\s+•+2337/, 'and the numbers are shown by their last characters, never whole');
    assert.ok(!payroll.includes('4455000122337') && !payroll.includes('999000999'), 'no bank number is shown whole');
    assert.ok(!/02\/30\/1991|Emergency/.test(payroll), 'payroll is sent no date of birth and no emergency contact');
    assert.ok(payroll.includes('1620 Mulberry Court'), 'the address the person changed is the one payroll receives');
    assert.match(await page.locator('.ends').innerText(), /Nothing was sent, nothing was saved, and no vault was made/);
    await shot('example-3-offices');
  });
  await step('leaving the example brings back the three ways in, and nothing of it was kept anywhere', async () => {
    await page.click('#example-leave');
    await page.waitForSelector('#example-start');
    assert.equal(await page.locator('.choice').count(), 3);
    assert.equal(await page.locator('#example-packet').count(), 0, 'the example is gone');
    assert.equal(await page.locator('#form-file').count(), 1, 'and the form picker is back');
    const kept = await held(page);
    assert.ok(!/Avery|Nolan|Mulberry|Larkspur|4455|Wabash/.test(kept.plain + JSON.stringify(kept.files)), 'the invented person is in nothing this browser keeps');
  });
  await step('a crooked phone photo of a form: straightened, and its 13 blanks found', async () => {
    await openForm('form-photo.png', 'blanks found');
    assert.match(await summary(), /13 blanks found · straightened 1\.2°/);
    assert.deepEqual((await labels()).slice(9, 11), ['Day', 'Night'], 'each checkbox is labelled by its own caption, on its right');
    assert.deepEqual(await tableCells(), [...HEADERS, ...HEADERS], 'each table cell is labelled by its column\'s header');
  });
  await step('loose answers land in order: periods and lines move on, a dash skips, x ticks', async () => {
    await page.uncheck('#use-details');
    await typeAnswers(ANSWERS);
    assert.deepEqual(await values(), expected);
    assert.match(await page.locator('.list').innerText(), /Name\s+Jane Roe/);
    await shot('form-1-filled');
  });
  await step('an answer changed on the form itself stays changed', async () => {
    await page.locator('[data-blank]').nth(2).fill('Respiratory Therapy'); await page.waitForTimeout(50);
    await typeAnswers(ANSWERS + '\n');
    assert.equal((await values())[2], 'Respiratory Therapy');
  });
  await step('the editable PDF holds a field per blank with its answer; the print-ready one has the answers as text', async () => {
    const fields = await fieldsOf(await save('#pdf-edit', 'filled.pdf'));
    assert.equal(fields.length, 13);
    assert.deepEqual(fields.map(([, value]) => value), [...expected.slice(0, 2), 'Respiratory Therapy', ...expected.slice(3)]);
    const printable = await save('#pdf-print', 'print.pdf'), text = pdfText(printable);
    for (const word of ['Jane Roe', 'VNT-2219', 'Return by Friday', 'J. R. Smith']) assert.ok(text.includes(word), word + ' in the print-ready PDF');
    assert.equal((await fieldsOf(printable)).length, 0, 'nothing left to edit');
    assert.match(await page.locator('.prints').innerText(), /Editable PDF\s+[0-9a-f]{64}[\s\S]*Print-ready PDF\s+[0-9a-f]{64}/);
  });
  await step('a blank the finder missed can be added by dragging across it, and removed', async () => {
    await page.click('#add-mode');
    const box = await page.locator('.sheet').boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.71); await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.74, { steps: 4 }); await page.mouse.up();
    assert.equal(await page.locator('[data-blank]').count(), 14);
    await page.locator('.remove').last().click();
    assert.equal(await page.locator('[data-blank]').count(), 13);
    await page.click('#add-mode');
  });
  await step('the same form as a PDF: its own page is kept, and the same 13 blanks are found', async () => {
    await openForm('form.pdf', 'form.pdf');
    assert.match(await summary(), /13 blanks found/);
    const cells = await tableCells();
    assert.ok(ownHeaders(cells), 'the table cells, each by its own column\'s header or none: ' + JSON.stringify(cells));
    const [day, night] = (await labels()).slice(9, 11);
    assert.ok((day === 'Day' || nothingOf(day, ['Night'])) && (night === 'Night' || nothingOf(night, ['Day'])), 'the checkboxes\' captions: ' + JSON.stringify([day, night]));
    await typeAnswers(ANSWERS);
    assert.deepEqual(await values(), expected);
    const editable = await save('#pdf-edit', 'filled-from-pdf.pdf');
    assert.match(pdfText(editable), /Equipment Loan Request \(invented form\)/, 'the original page text is still text: the page was copied, not photographed');
    assert.equal((await fieldsOf(editable)).length, 13);
    await shot('form-2-pdf');
  });
  await step('a form seen before is remembered by its fingerprint: its blanks come back at once, with no reading', async () => {
    const started = Date.now();
    await openForm('form-photo.png', 'remembered from last time');
    assert.match(await summary(), /13 blanks remembered from last time/);
    assert.ok(Date.now() - started < 8000, 'took ' + (Date.now() - started) + ' ms');
    assert.equal(await page.locator('#refind').count(), 1);
  });
  await step('your details and today\'s date fill their blanks, and typed answers pass over them', async () => {
    await page.locator('#details-panel summary').click();
    await page.fill('[name=detail-fullName]', 'Jane Roe');
    await page.fill('[name=passphrase]', PASSPHRASE); await page.fill('[name=passphrase-again]', PASSPHRASE);
    await page.click('#save-details');
    recoveryKey = (await (await page.waitForSelector('#recovery-key code')).innerText()).replace(/\s+/g, '');
    assert.match(recoveryKey, /^AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}$/, 'the recovery key is shown once');
    await page.click('#key-kept');
    await page.check('#use-details');
    await typeAnswers('Respiratory Care\nVentilator');
    const now = await values();
    assert.deepEqual(now.slice(0, 4), ['Jane Roe', today, 'Respiratory Care', 'Ventilator']);
    assert.match(await page.locator('.list').innerText(), /Jane Roe\s+filled for you/);
    assert.match(await page.locator('.toggle').first().innerText(), /\(2 blanks\)/);
    await typeAnswers('2) 12/01/2026. Respiratory Care');
    assert.deepEqual((await values()).slice(1, 3), ['12/01/2026', 'Respiratory Care'], 'a numbered answer still goes where it says');
    await shot('form-3-details');
  });
  await step('your details are kept only locked: nothing of them in plain text in this browser, and on a new visit they open with the passphrase or the recovery key', async () => {
    const kept = await held(page);
    assert.ok(!kept.plain.includes('Jane Roe'), 'no detail in plain text in localStorage');
    assert.deepEqual(kept.files.map(([name]) => name).sort(), ['identity.age', 'profile.age', 'vault.json']);
    for (const [name, data] of kept.files) {
      if (name !== 'vault.json') assert.ok(data.startsWith('age-encryption.org/v1\n'), name + ' is an age file');
      assert.ok(!data.includes('Jane Roe'), name + ' holds nothing of you in plain text');
    }
    const again = await context.newPage();
    try {
      await again.goto(origin);
      await again.waitForSelector('#unlock-secret');
      assert.equal(await again.locator('[name=detail-fullName]').count(), 0, 'locked: no detail on the page');
      await again.fill('#unlock-secret', 'not the passphrase'); await again.click('#unlock');
      await again.waitForFunction(() => /does not open your details/.test(document.body.innerText));
      await again.fill('#unlock-secret', PASSPHRASE); await again.press('#unlock-secret', 'Enter');
      await again.waitForSelector('[name=detail-fullName]');
      assert.equal(await again.inputValue('[name=detail-fullName]'), 'Jane Roe');
      await again.click('#lock-now');
      await again.waitForSelector('#unlock-secret');
      await again.fill('#unlock-secret', recoveryKey.toLowerCase()); await again.click('#unlock');
      await again.waitForSelector('[name=detail-fullName]');
      assert.equal(await again.inputValue('[name=detail-fullName]'), 'Jane Roe', 'the recovery key opens them too');
    } finally { await again.close(); }
    await unlockAgain(page, PASSPHRASE);   // Lock now there locked this page too
  });
  await step('signing: drawn with a finger in the pad, placed as a picture in the Signature blank', async () => {
    await typeAnswers('Respiratory Care');
    await page.locator('[data-sign]').first().click();
    const pad = await page.locator('dialog.pad canvas').boundingBox();
    await page.mouse.move(pad.x + pad.width * 0.1, pad.y + pad.height * 0.6); await page.mouse.down();
    for (const [x, y] of [[0.2, 0.3], [0.3, 0.7], [0.45, 0.25], [0.6, 0.7], [0.8, 0.4]]) await page.mouse.move(pad.x + pad.width * x, pad.y + pad.height * y, { steps: 6 });
    await page.mouse.up();
    await shot('form-4-sign');
    assert.equal(await page.isEnabled('dialog.pad [name=keep]'), true, 'with your details unlocked, the signature can be kept');
    await page.check('dialog.pad [name=keep]');
    await page.click('dialog.pad button[value=use]');
    await page.waitForSelector('.blank img.signed');
    await page.waitForSelector('img.saved-sign');
    const kept = await held(page);
    assert.ok(!/ff:signature|data:image/.test(kept.plain), 'the kept signature is not in plain text in localStorage');
    assert.ok(kept.files.every(([, data]) => !data.includes('data:image')), 'nor anywhere in the vault in plain text');
    const editable = await save('#pdf-edit', 'signed.pdf'), bytes = fs.readFileSync(editable).toString('latin1');
    assert.equal((await fieldsOf(editable)).length, 12, 'the signature is a picture, not one of the fields');
    assert.equal((bytes.match(/\/Subtype \/Image/g) || []).length, 3, 'the page picture, the signature and its see-through mask');
    assert.match(bytes, /\/SMask/);
    await page.click('.blank .unsign');
    assert.equal(await page.locator('.blank img.signed').count(), 0);
  });
  await step('a kept signature comes back on a new visit, locked with your details; "Forget it" forgets it there, and on the next visit', async () => {
    const again = await context.newPage();
    try {
      await again.goto(origin);
      await again.waitForSelector('#unlock-secret');
      assert.equal(await again.locator('img.saved-sign').count(), 0, 'not shown while locked');
      await again.fill('#unlock-secret', PASSPHRASE); await again.click('#unlock');
      await again.waitForSelector('img.saved-sign');
      await again.click('#forget-signature');
      await again.waitForFunction(() => !document.querySelector('img.saved-sign') && /saved signature is forgotten/.test(document.body.innerText));
      const kept = await held(again);
      assert.equal(kept.files.some(([name]) => name.endsWith('.prev')), false, 'no earlier copy kept that still holds it');
      await again.reload();
      await again.waitForSelector('#unlock-secret');
      await again.fill('#unlock-secret', PASSPHRASE); await again.click('#unlock');
      await again.waitForSelector('[name=detail-fullName]');
      assert.equal(await again.locator('img.saved-sign').count(), 0, 'and it does not come back');
      assert.equal(await again.inputValue('[name=detail-fullName]'), 'Jane Roe', 'your details are as they were');
    } finally { await again.close(); }
  });
  await step('a new passphrase: the old one is refused, the new one and the recovery key open, and no earlier key file is kept', async () => {
    const again = await context.newPage(), changed = 'another invented passphrase';
    try {
      await again.goto(origin);
      await again.waitForSelector('#unlock-secret');
      await again.fill('#unlock-secret', PASSPHRASE); await again.click('#unlock');
      await again.waitForSelector('[name=detail-fullName]');
      await again.locator('#details-panel details.more summary').click();
      await again.fill('[name=passphrase-change]', changed); await again.fill('[name=passphrase-change-again]', changed);
      await again.click('#change-passphrase');
      await again.waitForFunction(() => /passphrase is changed/.test(document.body.innerText));
      assert.equal((await held(again)).files.some(([name]) => name === 'identity.age.prev'), false);
      for (const [secret, opens] of [[PASSPHRASE, false], [changed, true], [recoveryKey, true]]) {
        if (await again.locator('#lock-now').count()) await again.click('#lock-now');
        await again.waitForSelector('#unlock-secret');
        await again.fill('#unlock-secret', secret); await again.click('#unlock');
        if (opens) await again.waitForSelector('[name=detail-fullName]');
        else await again.waitForFunction(() => /does not open your details/.test(document.body.innerText));
      }
    } finally { await again.close(); }
    await unlockAgain(page, changed);
  });
  await step('a PDF with its own fields: those are the blanks, plus the drawn signature line; the same fields are filled', async () => {
    await openForm('fillable.pdf', 'fillable.pdf');
    assert.match(await summary(), /9 blanks found · 8 are the PDF’s own fields/);
    assert.equal(await page.locator('select[data-blank]').count(), 1, 'the drop-down is a choice box');
    assert.deepEqual(await page.$$eval('input[type=radio][data-blank]', buttons => buttons.map(button => button.value)), ['Day', 'Night'], 'the radio group is a button over each of its own buttons');
    await typeAnswers('jane@example.org. 555-0100. emer. night. x. Visiting the unit for training');
    const editable = await save('#pdf-edit', 'fillable-filled.pdf'), fields = Object.fromEntries(await fieldsOf(editable));
    assert.deepEqual(Object.keys(fields).sort(), ['blank-9', 'email', 'escort', 'full_name', 'phone', 'reason', 'shift', 'unit', 'visit_date'], 'its own 8 fields, one added for the signature line');
    assert.equal(fields.full_name, 'Jane Roe'); assert.equal(fields.visit_date, today); assert.equal(fields.email, 'jane@example.org');
    assert.equal(await page.locator('select[data-blank]').first().inputValue(), 'Emergency', 'the page shows the choice "emer" picks');
    assert.equal(await page.locator('input[type=radio][value=Night]').isChecked(), true, 'the page shows the button "night" picks');
    assert.equal(fields.unit, 'Emergency'); assert.equal(fields.shift, 'Night'); assert.equal(fields.escort, true); assert.equal(fields.reason, 'Visiting the unit for training');
    const printable = await save('#pdf-print', 'fillable-print.pdf'), text = pdfText(printable);
    assert.equal((await fieldsOf(printable)).length, 0);
    for (const word of ['Jane Roe', 'jane@example.org', 'Emergency', 'Visiting the unit']) assert.ok(text.includes(word), word + ' in the print-ready PDF');
    await shot('form-5-fillable');
  });
  await step('a radio button tapped on the page is the answer', async () => {
    await page.locator('input[type=radio][value=Day]').check();
    const fields = Object.fromEntries(await fieldsOf(await save('#pdf-edit', 'fillable-day.pdf')));
    assert.equal(fields.shift, 'Day');
  });
  await step('what a PDF field cannot take is said, not dropped: a choice it does not offer', async () => {
    await typeAnswers('jane@example.org. 555-0100. Pharmacy');
    await save('#pdf-edit', 'fillable-wrong.pdf');
    assert.match(await page.locator('.note').innerText(), /"Pharmacy" is not one of its choices \(ICU, Emergency, Floor\)/);
  });
  await step('many copies from a CSV: columns matched by number, the unknown one named, one PDF with a copy per row', async () => {
    await openForm('form.pdf', 'form.pdf');
    await page.uncheck('#use-details'); await typeAnswers('');
    await page.locator('#merge-panel summary').click();
    const columns = await save('#csv-blank', 'columns.csv');
    assert.equal(lib.parseCsv(fs.readFileSync(columns, 'utf8'))[0].length, 13);
    const csv = path.join(scratch, 'rows.csv');
    fs.writeFileSync(csv, '1,#4,blank 5,Color,Day\r\nLee Doe,Ventilator,VNT-1001,blue,x\r\n"Roe, Jane",Oximeter,OX-2002,,\r\nSam Poe,Nebulizer,NB-3003,red,\r\n');
    await page.setInputFiles('#csv-file', csv);
    await page.waitForSelector('#merge-go');
    const listing = await page.locator('.columns').innerText();
    assert.match(listing, /Color → matches no blank/); assert.match(listing, /#4 → blank 4/);
    // The column "Day" goes to the box beside "Day", or to no box where this device's drawing of the PDF leaves that
    // box unclear; never to the Night box.
    const day = (await labels())[9] === 'Day';
    assert.match(listing, day ? /Day → blank 10 \(Day\)/ : /Day → matches no blank/, 'the column "Day": ' + JSON.stringify(listing));
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#merge-go')]);
    const merged = path.join(scratch, 'merged.pdf'); await download.saveAs(merged);
    assert.equal((await PDFDocument.load(fs.readFileSync(merged))).getPageCount(), 3);
    const text = pdfText(merged);
    for (const word of ['Lee Doe', 'Roe, Jane', 'Sam Poe', 'VNT-1001', 'OX-2002', 'NB-3003']) assert.ok(text.includes(word), word + ' in the merged PDF');
    // The first copy (its row says "x" under Day) has its Day box ticked, and not its Night box; the others neither.
    // With the Day box unclear, no copy has a box ticked.
    const shift = text.split('\f').map(sheet => sheet.split('\n').find(line => /Day/.test(line) && /Night/.test(line)) || '');
    if (day) assert.match(shift[0], /X\s*Day\s+Night/, 'copy 1: ' + JSON.stringify(shift[0]));
    for (const line of shift.slice(day ? 1 : 0, 3)) assert.doesNotMatch(line, /X/, 'a copy with no box to tick: ' + JSON.stringify(line));
    assert.equal((await fieldsOf(merged)).length, 0, 'merged copies are print-ready');
    await shot('form-6-merge');
  });
  await step('a PDF longer than the 10 pages shown: every page is in the filled copy, in order, and the page says so', async () => {
    const long = await PDFDocument.create();
    for (let sheet = 1; sheet <= 12; sheet++) {
      const sheetPage = long.addPage([612, 792]);
      sheetPage.drawText('Sheet ' + sheet + ' of the invented form', { x: 72, y: 720, size: 12 }); sheetPage.drawText('Name:', { x: 72, y: 652, size: 11 });
      sheetPage.drawLine({ start: { x: 112, y: 650 }, end: { x: 380, y: 650 }, thickness: 1 });
    }
    const file = path.join(scratch, 'long.pdf'); fs.writeFileSync(file, await long.save());
    await page.setInputFiles('#form-file', file);
    // One job at a time: another form chosen while this one is being opened is not opened, and the page says so.
    await page.waitForSelector('.busy');
    await page.setInputFiles('#form-file', path.join(fixtures, 'form.png'));
    await page.waitForFunction(() => [...document.querySelectorAll('.note')].some(note => /“form\.png” was not opened: the page is still busy/.test(note.textContent)), null, { timeout: 10000 });
    await page.waitForFunction(() => !document.querySelector('.busy') && (document.querySelector('.panel .subtle')?.textContent || '').includes('long.pdf'), null, { timeout: 300000 });
    assert.match(await summary(), /10 pages · 10 blanks found/);
    assert.match(await page.locator('.note').first().innerText(), /Only the first 10 pages are shown; the other 2 are kept as they are\./);
    await typeAnswers('Jane Roe');
    for (const [button, name] of [['#pdf-edit', 'long-filled.pdf'], ['#pdf-print', 'long-print.pdf']]) {
      const made = await save(button, name), sheets = pdfText(made).split('\f').filter(text => text.trim());
      assert.equal((await PDFDocument.load(fs.readFileSync(made))).getPageCount(), 12, name + ' has all 12 pages');
      sheets.forEach((text, index) => assert.ok(text.includes('Sheet ' + (index + 1) + ' of'), name + ': page ' + (index + 1) + ' is sheet ' + (index + 1)));
    }
    assert.ok(pdfText(path.join(scratch, 'long-print.pdf')).split('\f')[0].includes('Jane Roe'), 'the answer is on page 1');
  });
  await step('a form remembered by an earlier version keeps its labels but says so, until its blanks are found again', async () => {
    // What 2.2.0 remembered for the invented photo: the same blanks, the Day box called "shift" and the Night box "Day",
    // and no mark saying how they were named.
    await openForm('form-photo.png', 'remembered from last time');
    const hash = (await page.locator('.prints dd').first().innerText()).trim();
    await page.evaluate(hash => { const key = 'ff:template:' + hash, saved = JSON.parse(localStorage.getItem(key)); delete saved.labels; saved.blanks[9].label = 'shift'; saved.blanks[10].label = 'Day'; localStorage.setItem(key, JSON.stringify(saved)); }, hash);
    await openForm('form-photo.png', 'remembered from last time');
    assert.match(await page.locator('.note').first().innerText(), /remembered by an earlier version/);
    assert.deepEqual((await labels()).slice(9, 11), ['shift', 'Day'], 'its old labels, as they were');
    await page.click('#refind');
    await page.waitForFunction(() => !document.querySelector('.busy') && /13 blanks found/.test(document.querySelector('.panel .subtle')?.textContent || ''), null, { timeout: 120000 });
    assert.deepEqual((await labels()).slice(9, 11), ['Day', 'Night'], 'found again: named again');
    assert.equal(await page.locator('.note', { hasText: 'earlier version' }).count(), 0, 'and the note is gone');
    await openForm('form-photo.png', 'remembered from last time');
    assert.equal(await page.locator('.note', { hasText: 'earlier version' }).count(), 0, 'remembered by this version: no note');
  });
  await step('the checkbox sheet: a caption on either side, Yes/No pairs both ways round, and a box that cannot be told shown as unclear', async () => {
    await openForm('checkboxes.png', 'blanks found');
    assert.match(await summary(), /11 blanks found/);
    assert.deepEqual(await labels(), ['Name', 'Yes', 'Yes', 'Yes', 'No', 'Yes', 'No', 'I agree to the house rules', 'I have read the notice', 'unclear: “Maybe”?', 'unclear: “Maybe”?']);
    assert.equal(await page.locator('.list .label.unsure').count(), 2);
  });
  await step('the checkbox sheet as the PDF the page opens (drawn by this browser, not poppler): no box gets words that are not its own', async () => {
    await openForm('checkboxes.pdf', 'blanks found');
    const got = await labels(), want = ['Name', 'Yes', 'Yes', 'Yes', 'No', 'Yes', 'No', 'I agree to the house rules', 'I have read the notice'];
    assert.equal(got.length, 11, JSON.stringify(got));
    // Each box has its own caption, or none ("checkbox") where the reader lost it, or is unclear: never another's words.
    // The last two ("Maybe", as near one box as the next) are never called by a caption.
    assert.equal(got[0], 'Name', JSON.stringify(got));
    got.slice(1, 9).forEach((label, index) => assert.ok(label === want[index + 1] || nothingOf(label, want.filter(other => other !== want[index + 1])), 'blank ' + (index + 2) + ': ' + JSON.stringify(got)));
    got.slice(9).forEach((label, index) => assert.ok(nothingOf(label, want), 'blank ' + (index + 10) + ': ' + JSON.stringify(got)));
    assert.ok(got.slice(0, 9).filter((label, index) => label === want[index]).length >= 8, 'at least 8 of the 9 captions read: ' + JSON.stringify(got));
  });
  let templateFile;
  await step('a template file: the photo form\'s blanks and its page picture, in plain JSON another program can read', async () => {
    await openForm('form-photo.png', 'remembered from last time');
    templateFile = await save('#template-save', 'template.json');
    const template = lib.readTemplate(fs.readFileSync(templateFile, 'utf8'));
    assert.equal(template.blanks.length, 13); assert.equal(template.form.type, 'image');
    assert.match(template.pages[0].image, /^data:image\/jpeg;base64,/);
    assert.equal(JSON.parse(fs.readFileSync(templateFile, 'utf8')).labels, 2, 'the file says its checkboxes were named this version\'s way');
  });
  let oldTemplateFile;
  await step('a template file saved by an earlier version says so as it is put in place; an offer made for another file\'s template lapses when a form is opened', async () => {
    // What 2.2.0 saved for the invented photo: the same blanks, the Day box called "shift" and the Night box "[] Day",
    // and no mark saying how they were named.
    const old = JSON.parse(fs.readFileSync(templateFile, 'utf8')); delete old.labels; old.blanks[9].label = 'shift'; old.blanks[10].label = '[] Day';
    oldTemplateFile = path.join(scratch, 'template-2.2.0.json'); fs.writeFileSync(oldTemplateFile, JSON.stringify(old));
    await page.setInputFiles('#template-file', oldTemplateFile);
    await page.waitForFunction(() => /blanks are in place/.test(document.querySelector('.note')?.textContent || ''), null, { timeout: 30000 });
    assert.match(await page.locator('.note').first().innerText(), /saved by an earlier version.*Find the blanks again/);
    assert.deepEqual((await labels()).slice(9, 11), ['shift', '[] Day'], 'its old labels, as they were');
    // The same file as if made for another file of the same size, without its picture: offered, not put in place.
    const other = { ...old, form: { ...old.form, sha256: 'f'.repeat(64) }, pages: old.pages.map(({ image, ...rest }) => rest) };
    const otherFile = path.join(scratch, 'template-other.json'); fs.writeFileSync(otherFile, JSON.stringify(other));
    await page.setInputFiles('#template-file', otherFile);
    await page.waitForSelector('#template-anyway');
    // Opening the photo again brings up its own note (remembered as 2.2.0 named it); the old offer must not come with it.
    await openForm('form-photo.png', 'remembered from last time');
    assert.match(await page.locator('.note').first().innerText(), /remembered by an earlier version/);
    assert.equal(await page.locator('#template-anyway').count(), 0, 'the offer lapsed');
    // This version's template file puts this version's labels back, with no note about an earlier version.
    await page.setInputFiles('#template-file', templateFile);
    await page.waitForFunction(() => /blanks are in place/.test(document.querySelector('.note')?.textContent || ''), null, { timeout: 30000 });
    assert.doesNotMatch(await page.locator('.note').first().innerText(), /earlier version/);
    assert.deepEqual((await labels()).slice(9, 11), ['Day', 'Night']);
  });
  await step('offline: with no connection the page opens again and still finds a new form\'s blanks', async () => {
    // The server is taken away, so nothing can be fetched; the page has to come from what it kept. (The browser's
    // own "offline" switch is not used: in WebKit under Playwright it stops the kept page from loading too.)
    await serverDown();
    try {
      await page.reload();
      await page.waitForSelector('#form-file', { state: 'attached' });
      assert.equal(await page.evaluate(() => fetch('./manifest.webmanifest?fresh=' + Date.now(), { cache: 'no-store' }).then(response => response.headers.get('content-type'))), 'application/manifest+json', 'the kept copy answers');
      assert.equal(await new Promise(resolve => http.get(origin, () => resolve('answered')).on('error', () => resolve('no connection'))), 'no connection', 'and the server really is gone');
      await openForm('form.png', 'blanks found');
      assert.match(await summary(), /13 blanks found/);
    } finally { await serverUp(); }
  });
  await context.close();
  ({ context, page } = await open());
  await step('on a new device, the template file alone opens the form, its blanks in place, ready to fill', async () => {
    await page.goto(origin);
    await page.setInputFiles('#template-file', templateFile);
    await page.waitForFunction(() => /remembered from last time/.test(document.querySelector('.panel .subtle')?.textContent || ''), null, { timeout: 30000 });
    await page.uncheck('#use-details'); await typeAnswers(ANSWERS);
    assert.deepEqual(await values(), expected);
    assert.equal((await fieldsOf(await save('#pdf-edit', 'from-template.pdf'))).length, 13);
  });
  await step('on a new device, a template file saved by an earlier version opens the form and says how to name its checkboxes again', async () => {
    await page.goto(origin);
    await page.setInputFiles('#template-file', oldTemplateFile);
    await page.waitForFunction(() => /template file itself/.test(document.querySelector('.note')?.textContent || ''), null, { timeout: 30000 });
    assert.match(await page.locator('.note').first().innerText(), /saved by an earlier version.*open the original form/);
  });
  // The page draws itself again when the vault has been read, just after it opens. On a slow device (GitHub's Mac, once)
  // that came while a file was being chosen, and the file went to a picker no longer on the page: nothing opened. Here
  // the read is made late on purpose: another tab holds the vault's files (a transaction kept going) until the page has
  // opened and its picker has been found, so the step does not hang on how fast the machine is.
  await step('a file chosen while the page draws itself again still opens: the picker is kept, not made again', async () => {
    const { context: other, page: busy } = await open();
    try {
      const reading = target => target.evaluate(() => /Looking for your saved details/.test(document.body.textContent));
      await busy.goto(origin);
      await busy.waitForFunction(() => !/Looking for your saved details/.test(document.body.textContent));
      await busy.evaluate(() => new Promise((done, failed) => {
        const opening = indexedDB.open('form-filler-vault');
        opening.onerror = () => failed(opening.error);
        opening.onsuccess = () => {
          const files = opening.result.transaction('files', 'readwrite').objectStore('files'), until = performance.now() + 60000;
          window.holdingVault = true;
          const spin = () => { if (window.holdingVault && performance.now() < until) files.get('vault.json').onsuccess = spin; };
          spin(); done();
        };
      }));
      const late = await other.newPage();
      late.on('pageerror', error => problems.push(error.message));
      await late.goto(origin);
      assert.ok(await reading(late), 'the vault is still being read when the page has opened');
      const picker = await late.$('#template-file');
      await picker.focus();
      await busy.evaluate(() => { window.holdingVault = false; });
      await late.waitForFunction(() => !/Looking for your saved details/.test(document.body.textContent), null, { timeout: 15000 });
      assert.ok(await picker.evaluate(input => input.isConnected), 'the picker found before the page drew itself again is still on the page');
      assert.ok(await picker.evaluate(input => document.activeElement === input), 'and it still has the keyboard\'s focus');
      await picker.setInputFiles(templateFile);
      await late.waitForFunction(() => /remembered from last time/.test(document.querySelector('.panel .subtle')?.textContent || ''), null, { timeout: 30000 });
    } finally { await other.close(); }
  });
  await step('a template the command line made from a PDF\'s own fields (in points) lands on the page drawn in pixels', async () => {
    const made = path.join(scratch, 'fields.json');
    const run = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/form-filler.mjs'), 'fields', path.join(fixtures, 'fillable.pdf'), '--out', made], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    await openForm('fillable.pdf', 'fillable.pdf');
    await page.setInputFiles('#template-file', made);
    await page.waitForFunction(() => /8 blanks remembered/.test(document.querySelector('.panel .subtle')?.textContent || ''), null, { timeout: 30000 });
    const sheet = await page.locator('.sheet').boundingBox(), first = await page.locator('[data-blank]').first().boundingBox();
    // Full name's field: x = 160 pt of 612, top at 792 - 698 pt of 792.
    assert.ok(Math.abs((first.x - sheet.x) / sheet.width - 160 / 612) < 0.01 && Math.abs((first.y - sheet.y) / sheet.height - 94 / 792) < 0.01, JSON.stringify([sheet, first]));
  });
  await step('another program can hand over answers in the link: #answers=…', async () => {
    await page.goto(origin + '#answers=' + encodeURIComponent('Jane Roe. 11/13/2026. Nursing'));
    await page.reload();
    await openForm('form.png', 'blanks found');
    await page.uncheck('#use-details');
    assert.deepEqual((await values()).slice(0, 3), ['Jane Roe', '11/13/2026', 'Nursing']);
  });
  if (handwriting) await step('handwriting (synthetic: handwriting-style fonts): five lines cut, read on the device, shown beside their pictures', async () => {
    await page.selectOption('#hand-model', 'small');
    await page.setInputFiles('#hand-photo', path.join(fixtures, 'handwritten.png'));
    await page.waitForFunction(() => !document.querySelector('.busy') && document.querySelectorAll('[data-hand]').length && [...document.querySelectorAll('[data-hand]')].every(input => !input.placeholder), null, { timeout: 300000 });
    const read = await page.$$eval('[data-hand]', inputs => inputs.map(input => input.value));
    const written = ['Jane Roe', '11/13/2026', 'Respiratory Care', 'Ventilator VNT 2219', 'Return by Friday'];
    assert.equal(read.length, 5, JSON.stringify(read));
    const exact = read.filter((text, index) => text === written[index]).length;
    console.log('        read: ' + JSON.stringify(read));
    assert.ok(exact >= 3, exact + ' of 5 lines read exactly');
    assert.equal(await page.locator('.hand img').count(), 5);
    await page.locator('.hand').scrollIntoViewIfNeeded(); await shot('form-7-handwriting');
    await page.locator('[data-hand]').nth(3).fill('Ventilator VNT 2219');
    await page.click('#hand-use');
    assert.match(await page.inputValue('#answers'), /Ventilator VNT 2219\nReturn by Friday$/);
  });
  if (handwriting) await step('paper answers with blank numbers in front (synthetic): each read line goes to its numbered blank; an unreadable number is set aside and named', async () => {
    await page.uncheck('#use-details'); await typeAnswers('');
    await page.setInputFiles('#hand-photo', path.join(fixtures, 'handwritten-numbered.png'));
    await page.waitForFunction(() => !document.querySelector('.busy') && document.querySelectorAll('[data-hand]').length && [...document.querySelectorAll('[data-hand]')].every(input => !input.placeholder), null, { timeout: 300000 });
    console.log('        read: ' + JSON.stringify(await page.$$eval('[data-hand]', inputs => inputs.map(input => input.value))));
    await page.click('#hand-use');
    const now = await values();
    assert.equal(now[2], 'Jane Roe'); assert.equal(now[6], 'Respiratory Care'); assert.equal(now[1], 'Ventilator');
    console.log('        note: ' + await page.locator('.note').first().innerText());
    await page.locator('.sheet').first().scrollIntoViewIfNeeded(); await shot('form-9-numbered-paper');
  });
  await step('in a browser without the newest JavaScript (no Map.getOrInsertComputed, as in Chromium 143) a PDF still opens', async () => {
    // What such a browser lacks is taken away here, once, before anything else runs: in the page by a script that
    // runs first, and in the PDF reader's worker (which that script does not reach) by putting the same line at the
    // top of the worker's own file.
    const strip = 'for (const kind of [Map, WeakMap]) for (const name of ["getOrInsertComputed", "getOrInsert"]) delete kind.prototype[name]; delete Math.sumPrecise;\n';
    const old = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    try {
      await old.addInitScript(strip);
      await old.route(url => /pdf\.worker[^/]*\.mjs$/.test(url.pathname), async route => { const response = await route.fetch(); await route.fulfill({ response, body: strip + await response.text() }); });
      const other = await old.newPage();
      await other.goto(origin);
      assert.equal(await other.evaluate(() => typeof Map.prototype.getOrInsertComputed), 'undefined', 'the feature really is missing here');
      await other.setInputFiles('#form-file', path.join(fixtures, 'fillable.pdf'));
      await other.waitForFunction(() => !document.querySelector('.busy') && (document.querySelector('.sheet') || document.querySelector('.note')), null, { timeout: 120000 });
      assert.deepEqual(await other.locator('.note').allInnerTexts(), [], 'the page reports no error');
      assert.match(await other.locator('.panel .subtle').first().innerText(), /9 blanks found · 8 are the PDF’s own fields/);
    } finally { await old.close(); }
  });
  await step('what the browser kept is checked before it is used: a saved "signature" that is not a picture never reaches the page', async () => {
    // The browser's storage is shared by every page at the same site address, so another page could have written it.
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await fresh.addInitScript(() => { try { localStorage.setItem('ff:signature', JSON.stringify('x" onerror="window.planted = 1" alt="')); localStorage.setItem('ff:profile', JSON.stringify({ fullName: ['not', 'text'], email: 'jane@example.org' })); } catch { /* no storage */ } });
      const other = await fresh.newPage();
      await other.goto(origin);
      await other.waitForSelector('#details-panel[open]');
      await other.waitForTimeout(400);
      assert.equal(await other.evaluate(() => window.planted), undefined, 'nothing from storage ran as code');
      assert.equal(await other.locator('img.saved-sign').count(), 0, 'and it is not offered as a saved signature');
      assert.equal(await other.inputValue('[name=detail-fullName]'), '', 'a detail that is not text is dropped');
      assert.equal(await other.inputValue('[name=detail-email]'), 'jane@example.org', 'a detail that is text is kept');
      // Plain copies from an earlier version: said at the top of the page and in the panel (opened for it), and gone
      // once locked away with a passphrase.
      assert.ok(await other.isVisible('#plain-details'), 'said at the top of the page');
      assert.match(await other.locator('#plain-details').innerText(), /An earlier version kept your details in this browser in plain text/);
      assert.match(await other.locator('#details-panel').innerText(), /An earlier version of this page kept these details in this browser in plain text/);
      await other.fill('[name=passphrase]', PASSPHRASE); await other.fill('[name=passphrase-again]', PASSPHRASE);
      await other.click('#save-details');
      await other.waitForSelector('#recovery-key');
      const kept = await held(other);
      assert.ok(!/ff:profile|ff:signature|example\.org/.test(kept.plain), 'the plain copies are gone: ' + kept.plain);
      assert.ok(kept.files.every(([, data]) => !data.includes('example.org')), 'and the vault holds them locked');
      assert.equal(await other.inputValue('[name=detail-email]'), 'jane@example.org', 'nothing was lost');
    } finally { await fresh.close(); }
  });
  await step('on a computer: a form dropped on the page opens, the answers box is ready to type in, and it sits beside the form', async () => {
    await context.close();
    context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    context.on('request', request => { const url = request.url(); if (!url.startsWith(origin) && !/^(data|blob):/.test(url)) outside.push(url); });
    page = await context.newPage();
    page.on('pageerror', error => problems.push(error.message));
    await page.goto(origin);
    assert.ok(await page.locator('.desk').isVisible(), 'the page says a form can be dropped or pasted');
    const bytes = [...fs.readFileSync(path.join(fixtures, 'fillable.pdf'))];
    await page.evaluate(bytes => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'fillable.pdf', { type: 'application/pdf' }));
      document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    }, bytes);
    await page.waitForFunction(() => !document.querySelector('.busy') && (document.querySelector('.panel .subtle')?.textContent || '').includes('fillable.pdf') && document.querySelector('.sheet'), null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'answers', 'the answers box has the cursor');
    assert.equal(await page.evaluate(() => document.body.classList.contains('dropping')), false);
    const answersBox = await page.locator('.answers-panel').boundingBox(), sheet = await page.locator('.sheet').first().boundingBox();
    assert.ok(answersBox.x + answersBox.width <= sheet.x && Math.abs(answersBox.y - sheet.y) < 200, 'side by side: ' + JSON.stringify([answersBox, sheet]));
    await shot('form-8-computer');
  });
  await step('on a computer: ⌘S / Ctrl+S downloads the editable PDF', async () => {
    await page.keyboard.type('Jane Roe. jane@example.org. 555-0100');
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('ControlOrMeta+s')]);
    const file = path.join(scratch, 'keyed.pdf'); await download.saveAs(file);
    assert.equal(Object.fromEntries(await fieldsOf(file)).email, 'jane@example.org');
  });
  await step('on a computer: a pasted screenshot of a form opens as the form', async () => {
    const bytes = [...fs.readFileSync(path.join(fixtures, 'form.png'))];
    await page.locator('.top h1').click();
    await page.evaluate(bytes => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, bytes);
    await page.waitForFunction(() => !document.querySelector('.busy') && (document.querySelector('.panel .subtle')?.textContent || '').includes('pasted form.png'), null, { timeout: 120000 });
    assert.match(await summary(), /13 blanks/);
  });
  await step('a CSV opened before blanks are removed or added by hand: each column keeps to the blank it named, and the copy ticks that box', async () => {
    // Defect 16 (docs/INVENTORY.md): the columns were matched to blank numbers once, so removing blank 1 sent the Day
    // box's column to the Night box. The form pasted above (the invented form.png): blank 10 is the Day box, 11 the Night
    // box. The column is "10", by number, since the Day box's caption reads differently by device (WebKit does not read
    // "Day" on this pasted picture); a column by name keeps to its blank the same way (tests/lib.test.js).
    await page.uncheck('#use-details').catch(() => {});
    const boxes = page.locator('[data-blank]'), dayId = await boxes.nth(9).getAttribute('data-blank'), nightId = await boxes.nth(10).getAttribute('data-blank');
    await page.locator('#merge-panel summary').click();
    const csv = path.join(scratch, 'day.csv'); fs.writeFileSync(csv, '10\r\nx\r\n');
    await page.setInputFiles('#csv-file', csv); await page.waitForSelector('#merge-go');
    const listing = () => page.locator('.columns').innerText(), at = async id => page.locator('[data-blank="' + id + '"]').first();
    assert.match(await listing(), /10 → blank 10\b/);
    await page.click('#add-mode'); await page.locator('.remove').first().click();
    assert.match(await listing(), /10 → blank 9\b/, 'blank 1 removed: the Day box is blank 9 now, and the column with it');
    // A blank added by hand between the table and the Shift row, before the Day box: it is blank 10 again.
    await page.locator('.sheet').first().scrollIntoViewIfNeeded();
    const sheet = await page.locator('.sheet').first().boundingBox();
    await page.mouse.move(sheet.x + sheet.width * 0.6, sheet.y + sheet.height * 0.336); await page.mouse.down();
    await page.mouse.move(sheet.x + sheet.width * 0.9, sheet.y + sheet.height * 0.35, { steps: 4 }); await page.mouse.up();
    await page.click('#add-mode');
    assert.equal(await page.locator('[data-blank]').count(), 13);
    assert.match(await listing(), /10 → blank 10\b/, 'a blank added before it');
    // The copy: its one X is in the Day box, not the Night box (positions as fractions of the sheet, the page 612 pt across).
    const day = await (await at(dayId)).boundingBox(), night = await (await at(nightId)).boundingBox(), across = box => (box.x + box.width / 2 - sheet.x) / sheet.width * 612;
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#merge-go')]);
    const merged = path.join(scratch, 'day-merged.pdf'); await download.saveAs(merged);
    const words = spawnSync('pdftotext', ['-bbox', merged, '-']).stdout.toString(), x = words.match(/<word xMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*>X<\/word>/);
    assert.ok(x, 'an X in the copy: ' + words.slice(0, 300));
    const centre = (Number(x[1]) + Number(x[2])) / 2;
    assert.ok(Math.abs(centre - across(day)) < 6 && Math.abs(centre - across(night)) > 30, 'the X at ' + centre.toFixed(1) + ' pt; Day box at ' + across(day).toFixed(1) + ', Night box at ' + across(night).toFixed(1));
    // The Day box itself removed: its column says so, and there is nothing left to fill.
    await page.click('#add-mode'); await page.click('[data-remove="' + dayId + '"]'); await page.click('#add-mode');
    assert.match(await listing(), /10 → its blank was removed/);
    assert.ok(await page.locator('#merge-go').isDisabled(), 'no copies to make with no column matched');
  });
  await step('on a computer: the example\'s two forms, and then the two offices, sit side by side', async () => {
    await page.goto(origin);
    await page.click('#example-start');
    const pair = async selector => { const boxes = await page.locator(selector).all(); return Promise.all(boxes.map(box => box.boundingBox())); };
    const beside = ([left, right], what) => assert.ok(left && right && left.x + left.width <= right.x + 1 && Math.abs(left.y - right.y) < 40, what + ' side by side: ' + JSON.stringify([left, right]));
    beside(await pair('#example-carrying .example-sheet'), 'the two forms that carry the address');
    await page.click('#example-share');
    await page.waitForSelector('#share-hr');
    beside(await pair('.example-share'), 'what each office receives');
    await shot('example-4-computer');
  });
  await step('on a computer: the finder\'s cards sit two to a row', async () => {
    await page.goto(origin);
    await page.click('#find-start');
    await page.waitForSelector('.found');
    const boxes = (await Promise.all((await page.locator('.found').all()).map(card => card.boundingBox()))).slice(0, 2);
    const [left, right] = boxes;
    assert.ok(left && right && left.x + left.width <= right.x + 1 && Math.abs(left.y - right.y) < 40, 'two cards side by side: ' + JSON.stringify(boxes));
    await shot('find-3-computer');
  });
  await step('the page will not run inside another page, where that page could read what is typed', async () => {
    const framed = await context.newPage();
    try {
      await framed.setContent('<iframe src="' + origin + '" style="width:390px;height:600px"></iframe>');
      const frame = await (await framed.waitForSelector('iframe')).contentFrame();
      await frame.waitForFunction(() => /does not run inside another page/.test(document.body.innerText));
      assert.equal(await frame.locator('#unlock-secret, [name=detail-fullName], #answers').count(), 0, 'no box to type in');
    } finally { await framed.close(); }
  });
  await step('Forget my details: asked twice, then the vault and every plain copy are gone from this browser', async () => {
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const other = await fresh.newPage();
      await other.goto(origin);
      await other.locator('#details-panel summary').click();
      await other.fill('[name=detail-fullName]', 'Jane Roe');
      await other.fill('[name=passphrase]', PASSPHRASE); await other.fill('[name=passphrase-again]', PASSPHRASE);
      await other.click('#save-details');
      await other.waitForSelector('#key-kept'); await other.click('#key-kept');
      assert.equal((await held(other)).files.length, 3);
      await other.click('#forget-details');
      await other.waitForSelector('#forget-yes');
      assert.match(await other.locator('#details-panel').innerText(), /for good: they cannot be brought back/);
      await other.click('#forget-yes');
      await other.waitForFunction(() => /forgotten on this device/.test(document.body.innerText));
      const kept = await held(other);
      assert.deepEqual(kept.files, [], 'nothing left in the vault');
      assert.ok(!/ff:profile|ff:signature|Jane Roe/.test(kept.plain), 'and nothing in plain storage');
      assert.equal(await other.locator('[name=passphrase]').count(), 1, 'it starts again from nothing');
    } finally { await fresh.close(); }
  });
  await step('nothing was sent anywhere' + (handwriting ? ' (only the handwriting model fetched from Hugging Face; no code CDN)' : ''), async () => {
    assert.deepEqual(outside.filter(url => !(handwriting && HF.test(url))), []);
  });
  await step('no page or console errors', async () => assert.deepEqual(problems, []));
  await browser.close(); server.close();
  const failed = results.filter(([ok]) => !ok).length;
  console.log(failed ? failed + ' of ' + results.length + ' steps failed.' : 'All ' + results.length + ' steps pass.');
  process.exit(failed ? 1 : 0);
})();
