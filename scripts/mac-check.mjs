// Runs the checks in tests/shell/selftest.js inside the Mac app's own window: a test build of the app is started with
// folders made here for it, the checks run in its real WebKit against the real file plugin, and what they report is
// printed. Then what the app left on the disk is looked at from outside, with Node. Everything is invented, and it
// all happens in one temporary folder, removed at the end; the app's data folder and your home folder are stood in
// for by folders in it, so nothing of yours is read or written.
//
//   npm run mac:check                              builds the test app first, then runs this
//   npm run mac:try                                the test app opened for a person to try, with nothing of theirs
//                                                  in it: see "A trial" below
//   node scripts/mac-check.mjs [--run files,store,home,page,screens,quit] [--big MB] [--root FOLDER] [--app APP] [--keep]
//
// --big MB also backs up, checks and restores a made-up archive of that many megabytes, timed, and watches the app's
// memory while it does (it needs about four times that much room). --root puts the temporary folder somewhere else
// than the system's own. --keep leaves it there to be looked at, and --work FOLDER runs again in one that was kept
// (for what must outlast a restart). --run also takes pick, picked, picker and print, which wait for someone to
// click: see tests/shell/selftest.js. --open starts the app as Finder does when it is double-clicked (through macOS's
// own `open`, which hands the bundle to Launch Services), not as a program run from the terminal.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { openArchive } from '../src/lib/index.js';
import { nodeFiles } from '../src/lib/files/node.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const big = Number(option('--big')) || 0, keep = process.argv.includes('--keep');
const run = (option('--run') || 'files,store,home,page,screens,quit').split(',').filter(Boolean).concat(big ? ['big=' + big] : []);
const wants = name => run.some(item => item === name || item.startsWith(name + '='));
const app = resolve(option('--app') || join(repo, 'src-tauri/target/release/bundle/macos/Form Filler Test.app'));
const program = app.endsWith('.app') ? join(app, 'Contents/MacOS/form-filler') : app;
if (!existsSync(program)) { console.error('There is no test build of the app at ' + app + '.\nBuild one with: npm run mac:check'); process.exit(2); }

// A trial (--try): the test app opened as any app is, for a person to click through, with a folder standing in for
// their home folder and one for the app's data folder, so that no vault, archive or setting of theirs is read or
// made. The folders are in "Form Filler Trial" in the home folder (or in --root), and are kept from one trial to
// the next, as an app's are; delete that folder to start again, or when done. What the Mac's own panels are pointed
// at is real: a form opened from anywhere, a PDF saved anywhere.
if (process.argv.includes('--try')) {
  const trial = join(resolve(option('--root') || homedir()), 'Form Filler Trial'), folders = { home: join(trial, 'A stand-in for your home folder'), data: join(trial, 'The app\'s data'), drive: join(trial, 'A drive for backups') };
  for (const folder of Object.values(folders)) mkdirSync(folder, { recursive: true });
  copyFileSync(join(repo, 'tests/fixtures/form.pdf'), join(trial, 'an invented form to try.pdf'));
  console.log('Opening "Form Filler Test" for a trial. Its folders are in:\n  ' + trial + '\nNothing of yours is read or made. Quit the app (Command-Q) to end the trial.');
  const tried = spawn(program, [], { env: { ...process.env, FF_TEST_ROOT: trial, FF_TEST_DATA: folders.data, FF_TEST_HOME: folders.home }, stdio: 'inherit' });
  const ended = await new Promise(done => tried.on('exit', (status, signal) => done(signal || status)));
  console.log('The trial has ended (' + ended + '). What it made is still in:\n  ' + trial + '\nDelete that folder when you have looked, or to start a new trial from nothing.');
  process.exit(0);
}

// The checks, bundled into one script the app can run in its page.
const out = join(repo, 'src-tauri/target/selftest');
await build({ root: repo, configFile: false, logLevel: 'error', build: { lib: { entry: join(repo, 'tests/shell/selftest.js'), formats: ['iife'], name: 'FormFillerChecks', fileName: () => 'selftest.js' }, outDir: out, emptyOutDir: true, minify: false, target: 'es2022', reportCompressedSize: false } });

// The folders the app may use, and things in them it must leave alone.
const again = option('--work'), work = again ? resolve(again) : mkdtempSync(join(resolve(option('--root') || tmpdir()), 'form-filler-mac-check-'));
const root = join(work, 'root'), data = join(work, 'data'), home = join(work, 'home'), files = join(root, 'files');
// The app's own screens are clicked through in a start of their own, as a first run: an empty data folder, and a
// home folder with nothing of Form Filler's in it yet.
const firstRun = { data: join(work, 'first run/data'), home: join(work, 'first run/home') };
// Closing the window is tried in a start of its own too, with folders of its own: it ends the app, so nothing else
// can be checked in that start, and nothing another start made is touched by it.
const quitRun = { data: join(work, 'quit/data'), home: join(work, 'quit/home') };
if (!again) setUp();
function setUp() {
for (const folder of [firstRun.data, join(firstRun.home, 'Documents'), quitRun.data, quitRun.home, join(root, 'screens/saved'), join(root, 'screens/drive'), join(root, 'picked'), join(root, 'saved'), files, join(root, 'other'), join(root, 'outside'), join(root, 'locked/.formfiller'), join(root, 'big/archive'), join(root, 'big/drive'), join(root, 'big/restored'), data, join(home, 'Documents'), join(home, '.ff-staging-00000000000000aa'), join(files, '.formfiller'), join(files, '.ff-staging-00000000000000bb')]) mkdirSync(folder, { recursive: true });
const gone = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
writeFileSync(join(files, 'plain.txt'), 'plain');
writeFileSync(join(root, 'outside/secret.txt'), 'secret');
symlinkSync('plain.txt', join(files, 'a link.txt'));
symlinkSync(join(root, 'other'), join(files, 'way to granted'));
symlinkSync(join(root, 'outside'), join(files, 'way out'));
symlinkSync('nowhere at all', join(files, 'way nowhere'));
symlinkSync(join(files, 'a'), join(files, 'staging link'));
writeFileSync(join(files, '.formfiller/lock'), JSON.stringify({ pid: gone, host: hostname(), since: '2026-11-17T15:00:00.000Z' }));
writeFileSync(join(files, '.ff-staging-00000000000000bb/f.txt'), 'staged');
symlinkSync(join(root, 'outside'), join(files, '.ff-staging-00000000000000bb/a link out'));
symlinkSync(join(root, 'other'), join(files, '.ff-staging-00000000000000bb/a link to the other'));
writeFileSync(join(root, 'locked/.formfiller/lock'), JSON.stringify({ pid: process.pid, host: hostname(), since: new Date().toISOString() }));
writeFileSync(join(home, 'Documents/private.txt'), 'mine');
writeFileSync(join(firstRun.home, 'Documents/private.txt'), 'mine');
copyFileSync(join(repo, 'tests/fixtures/fillable.pdf'), join(root, 'screens/an invented card.pdf'));
writeFileSync(join(home, '.zshrc'), 'mine');
symlinkSync(join(home, 'Documents'), join(home, 'Form Filler Archive (restored 2026-11-17 1530) (2)'));
}

// The app's memory, and its page's (WebKit runs the page in a process of its own, which appears with the app).
const processes = () => spawnSync('ps', ['-axo', 'pid=,rss=,comm='], { encoding: 'utf8' }).stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(([, pid, rss, name]) => ({ pid: Number(pid), mb: Number(rss) / 1024, name }));
const before = new Set(processes().filter(entry => /WebKit/.test(entry.name)).map(entry => entry.pid));
const peak = { app: 0, page: 0 };

const started = Date.now(), lines = [];
const viaOpen = process.argv.includes('--open'), told = join(work, 'told.txt');
// The checks and the invented forms they open are handed to the app in the temporary folder, not where this
// repository is: started as Finder starts it, the app answers to macOS for the folders it reads, and a repository
// kept in Downloads or Documents would have macOS ask whether the app may read there.
const given = join(work, 'given');
mkdirSync(given, { recursive: true });
copyFileSync(join(out, 'selftest.js'), join(given, 'selftest.js'));
for (const name of ['form.pdf', 'fillable.pdf', 'form-photo.png']) copyFileSync(join(repo, 'tests/fixtures', name), join(given, name));
if (viaOpen && !app.endsWith('.app')) { console.error('--open needs the app bundle (…/Form Filler Test.app), not the program inside it.'); process.exit(2); }
// --defaults A=YES,B=NO starts the app with those settings for this run only (nothing is written anywhere).
const settings = (option('--defaults') || '').split(',').filter(Boolean).flatMap(pair => ['-' + pair.split('=')[0], pair.split('=')[1]]);
// Unless someone has to click in it, the app stays out of the Dock and does not come to the front, so a run does not
// take the keyboard from whoever is at the Mac. While something is timed, or the page reads a form, its window is
// small, in a corner and above the others: macOS slows the page of a window that cannot be seen, and a hidden page is
// given no turns to draw in, which the PDF reader waits for.
const clicking = ['pick', 'picker', 'print'].some(wants) || process.argv.includes('--front');

// One start of the app, with the checks it is to run and the folders that stand in for its data and your home.
// `waiting` is how long the app may take before it is stopped, and `stuck` what to say if it does.
async function start(checks, folders, { waiting = big ? 3600 : viaOpen ? 240 : 900, stuck = 'no result' } = {}) {
  const inView = big || ['bench', 'page', 'screens', 'pagehidden'].some(name => checks.some(item => item === name || item.startsWith(name + '=')));
  const environment = { FF_TEST_ROOT: root, FF_TEST_DATA: folders.data, FF_TEST_HOME: folders.home, FF_TEST_SCRIPT: join(given, 'selftest.js'), FF_TEST_FIXTURES: given, FF_TEST_RUN: checks.join(','),
    ...(process.argv.includes('--throttled') ? { FF_TEST_THROTTLING: 'default' } : {}), ...(clicking ? {} : { FF_TEST_QUIET: '1' }), ...(inView ? { FF_TEST_WINDOW: 'corner' } : {}) };
  const from = lines.length;
  const child = viaOpen
    ? spawn('/usr/bin/open', ['-n', '-W', ...(clicking ? [] : ['-g']), '--stdout', told, '--stderr', told, ...Object.entries(environment).flatMap(([name, value]) => ['--env', name + '=' + value]), app, ...(settings.length ? ['--args', ...settings] : [])], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(program, settings, { env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  const watching = setInterval(() => {
    for (const entry of processes()) {
      if (entry.pid === child.pid) peak.app = Math.max(peak.app, entry.mb);
      else if (/WebKit\.WebContent/.test(entry.name) && !before.has(entry.pid)) peak.page = Math.max(peak.page, entry.mb);
    }
  }, 500);
  let held = '';
  child.stdout.on('data', piece => { held += piece; const whole = held.split('\n'); held = whole.pop(); for (const line of whole) { lines.push(line); console.log(line); } });
  child.stderr.on('data', piece => process.stderr.write(piece));
  // Started through `open`, the app is not this script's child: it is found by the path of its program.
  const stopApp = () => { if (viaOpen) spawnSync('/usr/bin/pkill', ['-f', program]); };
  const limit = setTimeout(() => { console.log('STOPPED the app: ' + stuck + ' after ' + Math.round((Date.now() - started) / 1000) + ' s'); stopApp(); child.kill('SIGKILL'); }, waiting * 1000);
  let code = await new Promise(done => child.on('exit', (status, signal) => done(signal ? 'stopped by ' + signal : status)));
  clearTimeout(limit); clearInterval(watching);
  // Started through `open`, the app wrote what it had to say into a file, and `open` cannot say how the app ended.
  if (viaOpen) {
    for (const line of (existsSync(told) ? readFileSync(told, 'utf8') : '').split('\n').filter(Boolean)) { lines.push(line); console.log(line); }
    rmSync(told, { force: true });
  }
  return lines.slice(from).some(line => /RESULT \d+ passed, 0 failed/.test(line)) && (viaOpen || code === 0) ? 0 : code === 0 ? 'no result' : code;
}
const others = run.filter(item => item !== 'screens' && item !== 'quit');
let code = others.length ? await start(others, { data, home }) : 0;
if (wants('screens')) { const second = await start(['screens'], firstRun); code = code === 0 ? second : code; }
// Last, because it ends with the app gone: the window is closed, and the app must end by itself within the minute.
if (wants('quit')) {
  const third = await start(['quit'], quitRun, { waiting: 60, stuck: 'the app did not end after its window was closed' });
  code = code === 0 ? third : code;
}

// What the app left, looked at from outside.
const problems = [];
const check = (so, what) => { if (!so) problems.push(what); };
const text = path => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
const everything = (dir, at = '') => readdirSync(join(dir, at), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? [join(at, entry.name) + '/', ...everything(dir, join(at, entry.name))] : [join(at, entry.name)]);
check(code === 0 && !lines.some(line => /RESULT \d+ passed, [1-9]\d* failed/.test(line)), 'the checks in the app did not all pass (the app ended with ' + code + ')');
check(text(join(root, 'outside/secret.txt')) === 'secret' && readdirSync(join(root, 'outside')).length === 1, 'the folder that was never granted was touched');
check(text(join(home, 'Documents/private.txt')) === 'mine' && text(join(home, '.zshrc')) === 'mine' && readdirSync(join(home, 'Documents')).length === 1, 'something in the stand-in home folder that is not Form Filler\'s was touched');
if (wants('files')) {
  check(readdirSync(join(root, 'other')).length === 0, 'something was written through a link into the other granted folder');
  check(text(join(files, 'a/x.txt')) === 'first' && text(join(files, 'a/y.txt')) === 'second', 'a file that was not to be replaced is not as it was');
  check(statSync(join(files, 'a/streamed.bin')).size === 20 * (1024 * 1024 + 13), 'the streamed file is not the size that was sent');
  const left = everything(files).filter(path => /\.ff-new-|\.tmp$|half\.bin|odd\.txt/.test(path));
  check(left.length === 0, 'half-written files were left: ' + left.join(', '));
  check(!existsSync(join(files, '.ff-staging-0123456789abcdef')) && !existsSync(join(files, '.ff-staging-00000000000000bb')) && existsSync(join(files, '.ff-staging-fedcba9876543210')), 'the staging folders are not as they should be');
  check(!existsSync(join(files, '.formfiller/lock')), 'the app left its lock');
  check(lstatSync(join(files, 'way out')).isSymbolicLink() && lstatSync(join(files, 'a link.txt')).isSymbolicLink(), 'a link was replaced');
  // The archive the app made, read by the command line's own file interface.
  const report = await openArchive(nodeFiles(files)).verify();
  check(report.ok && report.items === 2 && report.files === 3, 'the archive the app made does not verify from the command line: ' + JSON.stringify({ ok: report.ok, items: report.items, files: report.files, missing: report.missing, changed: report.changed, unfinished: report.unfinished, problems: report.problems }));
}
if (wants('store')) check(!existsSync(join(data, 'vault')), 'a forgotten vault left its folder');
if (wants('screens')) {
  // What the screens made, seen from outside: a vault back in its place, an archive that verifies from the command
  // line, a restored copy beside it that is the same folder for folder, and nothing else touched in the home folder.
  const archive = join(firstRun.home, 'Form Filler Archive'), names = readdirSync(firstRun.home).sort();
  check(names.length === 3 && names[0] === 'Documents' && names[1] === 'Form Filler Archive' && /^Form Filler Archive \(restored \d{4}-\d{2}-\d{2} \d{4}\)$/.test(names[2]), 'the first-run home folder holds: ' + names.join(', '));
  check(text(join(firstRun.home, 'Documents/private.txt')) === 'mine', 'something in the first-run home folder that is not Form Filler\'s was touched');
  check(existsSync(join(firstRun.data, 'vault/vault.json')) && existsSync(join(firstRun.data, 'vault/identity.age')) && !readdirSync(firstRun.data).some(name => name.startsWith('vault (restored')), 'the vault is not back in its place: ' + readdirSync(firstRun.data).join(', '));
  if (existsSync(archive)) {
    const report = await openArchive(nodeFiles(archive)).verify();
    check(report.ok && report.items === 1 && report.files === 2, 'the archive the screens made does not verify from the command line: ' + JSON.stringify({ ok: report.ok, items: report.items, files: report.files, missing: report.missing, changed: report.changed, unfinished: report.unfinished }));
    if (names[2]) check(JSON.stringify(everything(join(firstRun.home, names[2])).sort()) === JSON.stringify(everything(archive).sort()), 'the restored copy beside the archive does not hold the same files');
  }
  check(existsSync(join(root, 'screens/saved/form - filled.pdf')) && existsSync(join(root, 'screens/saved/a copy.pdf')), 'the files the save dialog named were not written');
}
if (wants('home')) {
  check(text(join(home, 'Form Filler Archive/Taxes/filled - form.pdf')) === '%PDF- an invented form', 'the archive is not in its place in the stand-in home folder');
  check(!existsSync(join(home, '.ff-staging-0123456789abcdef')) && existsSync(join(home, '.ff-staging-00000000000000aa')), 'staging in the stand-in home folder is not as it should be');
  const names = readdirSync(home).sort();
  check(JSON.stringify(names) === JSON.stringify(['.ff-staging-00000000000000aa', '.zshrc', 'Documents', 'Form Filler Archive', 'Form Filler Archive (restored 2026-11-17 1530)', 'Form Filler Archive (restored 2026-11-17 1530) (2)', 'Form Filler Archive (restored 2026-11-17 1530) (3)']), 'the stand-in home folder holds: ' + names.join(', '));
}
if (big) console.log('         memory at its highest, looked at every half second: the app ' + Math.round(peak.app) + ' MB, its page ' + Math.round(peak.page) + ' MB');
for (const problem of problems) console.log('FAIL  seen from outside: ' + problem);
console.log((problems.length ? 'NOT ALL PASSED' : 'ALL PASSED') + ' in ' + Math.round((Date.now() - started) / 1000) + ' s' + (keep || again ? '; left in ' + work : ''));
if (!keep && !again) rmSync(work, { recursive: true, force: true });
process.exit(problems.length ? 1 : 0);
