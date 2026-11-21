// The Mac app's own screens, beside the page that fills forms: first-run setup, the locker, the archive, filing a
// filled form, and backups with their restore. Loaded only inside the app (main.js), so none of it reaches the web
// page. A screen here decides nothing about your papers: each button calls the library that the command line and the
// tests use (src/lib/archive.js, vault.js, backup.js), through the app's file interface (files-tauri.js).
//
// Where things are kept is in settings.json in the app's data folder:
//   archive.holder   the folder that holds the archive: "home" for its usual place (your home folder, where the app
//                    reaches only Form Filler's own names), or the path of a folder you picked. The archive is
//                    always the folder named "Form Filler Archive" in it, so that a restore can stage beside it.
//   backup.to        the drive or folder you picked for backups; backup.last, when the last one was made
// The vault is the page's own (keep.js): this file asks the keeper for it and never sees the passphrase kept anywhere.
import './desk.css';
import { tauri, places } from './platform.js';
import { call, homeFiles, tauriFiles } from './files-tauri.js';
import { openArchive, UNSORTED } from '../lib/archive.js';
import { BACKUPS, listBackups, makeBackup, restoreBackup, verifyBackup } from '../lib/backup.js';
import { MIN_PASSPHRASE } from './keep.js';
import { ARCHIVE, byMatter, cloudHint, itemWords, restoredWords, sizeWords, verifyWords, whenWords, within } from './desk-words.js';

const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const encoder = new TextEncoder(), decoder = new TextDecoder();
const LOCKER_LIMIT = 200 * 1024 * 1024;   // a locker document is held whole in memory while it is sealed
const KINDS = ['document', 'identity', 'tax paper', 'licence', 'certificate', 'insurance', 'other'];
const SNAPSHOT = 'snapshot.tar.age';
const root = document.createElement('div');
root.id = 'desk';

let ctx = null, where = null, screen = 'form', decided = false;
let said = '', warned = false, working = '', stopper = null;
let locker = null, adding = null;                 // the locker's list; a document picked, waiting for its title
let shelf = null;                                 // the archive as last read: { index, book, report } or { problem }
let filing = null;                                // a PDF waiting to be filed: { made, original, title }, then .done
let backups = null, checking = null;              // the backups at the destination; one asked to be checked fully
let restoring = null;                             // { path, name } about to be restored, or { choices }, then .result
let picked = null;                                // a folder picked to hold the archive, not yet agreed to

const settings = () => ctx.store.settings();
const holder = () => settings().archive?.holder || null;
const holderPath = (kept = holder()) => kept === 'home' ? where.home : kept;
const archivePath = (kept = holder()) => holderPath(kept) + '/' + ARCHIVE;
// The folder that holds the archive: your home folder by Form Filler's own names only, or the folder you picked.
const holderFiles = (kept = holder()) => kept === 'home' ? homeFiles(tauri, where.home) : tauriFiles(tauri, kept);
const archiveFiles = async (kept = holder()) => { if (kept === 'home') await call(() => tauri.invoke('grant_home', { name: ARCHIVE })); return tauriFiles(tauri, archivePath(kept)); };
const dataFiles = () => tauriFiles(tauri, where.data);
const shown = path => !path ? '' : path === where.home ? 'your home folder' : path.startsWith(where.home + '/') ? '~' + path.slice(where.home.length) : path;
const nameOf = path => path.slice(path.lastIndexOf('/') + 1);
const field = name => root.querySelector('[name="' + name + '"]')?.value || '';
const grouped = key => key.slice(0, 16) + ' ' + key.slice(16).match(/.{1,6}/g).join(' ');
const panel = (title, body) => '<section class="panel"><h2>' + title + '</h2>' + body + '</section>';
const tools = (...buttons) => '<div class="tools">' + buttons.filter(Boolean).join('') + '</div>';
const button = (act, title, { kind = 'secondary', ...data } = {}) => '<button type="button" class="' + kind + '" data-act="' + act + '"' + Object.entries(data).map(([name, value]) => ' data-' + name + '="' + h(value) + '"').join('') + '>' + title + '</button>';
const IN_VIEW = '<p class="subtle">Keep this window in view while it works: macOS slows a window nobody can see, and this goes several times faster in view.</p>';

// One thing at a time: what is running is said at the top of the screen, and what went wrong is said when it stops.
async function run(doing, work, { stoppable = false } = {}) {
  if (working) return;
  working = doing; said = ''; warned = false; stopper = stoppable ? new AbortController() : null; draw();
  try { await work(stopper?.signal); }
  catch (error) { said = h(stopper?.signal.aborted ? 'Stopped. Nothing was kept.' : error?.message || String(error)); warned = true; }
  working = ''; stopper = null; draw();
}
const progress = words => { const slot = root.querySelector('#desk-working'); if (slot) slot.textContent = words; };
// A file interface whose streamed files are counted as they are written, for something to show while a backup or a
// restore runs. What is counted is told at most four times a second.
function counted(files, tell) {
  let told = 0;
  return { ...files, createFileFrom: (path, source) => files.createFileFrom(path, (typeof source.pipeThrough === 'function' ? source : new ReadableStream({ async start(controller) { for await (const piece of source) controller.enqueue(piece); controller.close(); } }))
    .pipeThrough(new TransformStream({ transform(piece, controller) { controller.enqueue(piece); if (Date.now() - told > 250) { told = Date.now(); tell(piece.length, true); } else tell(piece.length, false); } }))) };
}
const meter = words => { let total = 0; return (size, show) => { total += size; if (show) progress(words + ' ' + sizeWords(total) + ' so far.'); }; };
const pickFolder = async (title, defaultPath) => { const chosen = await tauri.dialog.open({ directory: true, recursive: true, multiple: false, title, ...(defaultPath ? { defaultPath } : {}) }); return typeof chosen === 'string' ? chosen.replace(/\/+$/, '') : null; };

// The screen drawn again. What was typed in its boxes is put back, so a redraw (something started, something failed,
// the vault locked) never loses it; a passphrase is not: it is read once, by the button that needs it, and gone.
let drawn = '';
function draw() {
  const state = ctx.keeper.state;
  const typed = drawn === screen ? [...root.querySelectorAll('input[name], select[name]')].filter(box => box.type !== 'password' && !box.readOnly).map(box => [box.name, box.value]) : [];
  drawn = screen;
  ctx.app.hidden = screen !== 'form';
  const tab = (name, title) => '<button type="button" class="tab' + (screen === name || (name === 'backup' && screen === 'restore') || (name === 'archive' && screen === 'filing') ? ' on' : '') + '" data-go="' + name + '">' + title + '</button>';
  const lock = state === 'open' ? '<span class="lock">Unlocked</span>' + button('lock', 'Lock now') : state === 'locked' ? '<span class="lock">Locked</span>' : state === 'none' && screen !== 'setup' ? '<button type="button" class="secondary" data-go="setup">Set up</button>' : '';
  root.innerHTML = '<nav class="desk-bar" aria-label="Form Filler"><div class="tabs">' + tab('form', 'Fill a form') + tab('locker', 'Locker') + tab('archive', 'Archive') + tab('backup', 'Backups') + '</div><div class="lock-state">' + lock + '</div></nav>' +
    (screen === 'form' ? '' : '<main class="desk-screen">' +
      (working ? '<div class="busy" role="status"><span id="desk-working">' + h(working) + '</span><div class="bar"><i></i></div>' + (stopper ? tools(button('stop', 'Stop')) : '') + '</div>' : '') +
      (said ? '<div class="note' + (warned ? ' warn' : '') + '" role="status">' + said + '</div>' : '') + (where ? SCREENS[screen]() : '<p class="subtle">Opening…</p>') + '</main>');
  for (const [name, value] of typed) { const box = [...root.querySelectorAll('input[name], select[name]')].find(item => item.name === name); if (box && value !== '') box.value = value; }
}

async function go(name) {
  if (working) return;
  screen = name; said = ''; warned = false; checking = null; drawn = '';
  if (name !== 'restore') restoring = null;
  if (name !== 'filing') filing = null;
  draw();
  if (name === 'locker') await readLocker();
  if (name === 'archive') await readShelf();
  if (name === 'backup') await readBackups();
}

// ---------- first-run setup ----------
function setupScreen() {
  const { keeper } = ctx, state = keeper.state;
  if (state === 'checking') return panel('Setting up', '<p class="subtle">Looking at what is kept here…</p>');
  if (state === 'none') return panel('Welcome to Form Filler',
    '<p>This Mac app fills forms as the web page does, and keeps your papers: a <b>vault</b> for your details, your signature and a locker of documents, locked with a passphrase; an <b>archive</b>, a plain folder of everything you file; and <b>backups</b> of both.</p>' +
    '<h3>1. Choose a passphrase for your vault</h3><p class="subtle">At least ' + MIN_PASSPHRASE + ' characters; a few unrelated words are best. It is never kept anywhere: if you forget it, only the recovery key you are shown next opens the vault.</p>' +
    '<div class="details passphrase"><label>A passphrase<input type="password" name="setup-passphrase" autocomplete="new-password"></label><label>The same passphrase again<input type="password" name="setup-again" autocomplete="new-password" data-enter="make-vault"></label></div>' +
    tools(button('make-vault', 'Make my vault', { kind: 'primary' }), button('restore-pick', 'Restore from a backup instead…'), button('setup-later', 'Not now')));
  if (keeper.recoveryKey) return panel('2. Keep your recovery key',
    '<div class="recovery" id="desk-key"><p>If you forget your passphrase, this is the only way back into your vault. Print it or write it down, and keep it somewhere safe. It is shown only now.</p><code>' + h(grouped(keeper.recoveryKey)) + '</code>' +
    tools(button('key-print', 'Print it'), button('key-kept', 'I have kept it', { kind: 'primary' })) + '</div>');
  if (!holder()) {
    const hint = picked ? cloudHint(picked, where.home) : null;
    return panel('3. Where your archive lives',
      '<p>Every paper you file is kept in one plain folder that is yours: you can open it in Finder, and it needs no app to read. It is always named “' + ARCHIVE + '”.</p>' +
      (picked ? '<p>It will be <b>' + h(shown(picked + '/' + ARCHIVE)) + '</b>.</p>' + (hint ? '<p class="warn">That folder looks as if it is copied to ' + h(hint) + '. The archive is plain files, so every paper in it would be uploaded there. A folder that stays on this Mac is safer.</p>' : '') +
        tools(button('archive-use', 'Use this folder', { kind: 'primary' }), button('archive-choose', 'Choose again…'), button('archive-home', 'Keep it in my home folder'))
        : '<p>Its usual place is your home folder: <b>~/' + ARCHIVE + '</b>. Not Documents, and not iCloud, so it stays on this Mac.</p>' + tools(button('archive-home', 'Keep it in my home folder', { kind: 'primary' }), button('archive-choose', 'Choose another folder to hold it…'))));
  }
  return panel('You are set up', '<p>Your vault is ' + (state === 'open' ? 'open' : 'locked') + ', and your archive is ' + h(shown(archivePath())) + '.</p>' + tools('<button type="button" class="primary" data-go="form">Fill a form</button>'));
}
// The archive's folder made if it is not there, and the folders every archive has. An archive already there is used.
async function makeArchive(kept) {
  const parent = holderFiles(kept);
  try { await parent.createFolder(ARCHIVE); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if ((await parent.stat(ARCHIVE))?.kind !== 'folder') throw new Error('Something that is not a folder is called “' + ARCHIVE + '” in ' + shown(holderPath(kept)) + '. Move it away, or choose another folder.');
  await openArchive(await archiveFiles(kept)).init();
}
const keepArchiveIn = kept => run('Making your archive…', async () => {
  await makeArchive(kept);
  await ctx.store.change({ archive: { ...settings().archive, holder: kept } });
  picked = null; shelf = null;
  said = 'Your archive is ' + h(shown(archivePath(kept))) + '.';
  if (screen === 'setup') screen = 'form';
});

// ---------- the locker ----------
const unlockForm = () => '<div class="details unlock"><label>Your passphrase, or your recovery key<input type="password" name="desk-secret" autocomplete="current-password" data-enter="unlock"></label></div>' + tools(button('unlock', 'Unlock', { kind: 'primary' }));
function lockerScreen() {
  const state = ctx.keeper.state;
  const what = '<p class="subtle">Documents you want kept locked away: an ID, a licence, last year’s return. Each is sealed with your vault’s key, and read back exactly as it went in.</p>';
  if (state === 'none') return panel('Locker', what + '<p>The locker is part of your vault. Make your vault first.</p>' + tools('<button type="button" class="primary" data-go="setup">Set up</button>'));
  if (state !== 'open') return panel('Locker', what + '<p>The locker is locked.</p>' + unlockForm());
  const rows = (locker || []).map(entry => '<li><b>' + h(entry.title) + '</b> <span class="subtle">' + h([entry.kind, entry.name, whenWords(entry.added), sizeWords(entry.bytes)].filter(Boolean).join(' · ')) + '</span> ' + button('doc-save', 'Save a copy…', { id: entry.id }) + '</li>').join('');
  const form = adding ? '<div class="adding"><h3>Put “' + h(adding.name) + '” in the locker</h3><div class="details"><label>What to call it<input name="doc-title" value="' + h(adding.name.replace(/\.[^.]+$/, '')) + '" data-enter="doc-add"></label>' +
    '<label>What kind of document<select name="doc-kind">' + KINDS.map(kind => '<option>' + kind + '</option>').join('') + '</select></label></div>' + tools(button('doc-add', 'Put it in the locker', { kind: 'primary' }), button('doc-cancel', 'Cancel')) + '</div>' : '';
  return panel('Locker', what + (locker === null ? '<p class="subtle">Reading the locker…</p>' : rows ? '<ul class="rows">' + rows + '</ul>' : '<p>Nothing is in the locker yet.</p>') + form +
    (adding ? '' : tools(button('doc-pick', 'Add a document…', { kind: 'primary' }))) + '<p class="subtle">Nothing is ever removed from the locker in this version.</p>');
}
async function readLocker() {
  const vault = ctx.keeper.vault();
  if (!vault) { locker = null; return draw(); }
  try { locker = await vault.listDocuments(); } catch (error) { locker = []; said = h(error.message); warned = true; }
  draw();
}

// ---------- the archive ----------
function archiveScreen() {
  const what = '<p class="subtle">Everything you have filed, kept as plain files in a folder you own. Nothing in it is ever deleted or written over by Form Filler.</p>';
  if (!holder()) return panel('Archive', what + '<p>Say where your archive lives first.</p>' + tools('<button type="button" class="primary" data-go="setup">Set up</button>'));
  const top = '<p>It is <b>' + h(shown(archivePath())) + '</b>.</p>';
  if (!shelf) return panel('Archive', what + top + '<p class="subtle">Reading the archive…</p>');
  if (shelf.problem) return panel('Archive', what + top + '<p class="warn">It could not be read: ' + h(shelf.problem) + '</p>' + tools(button('shelf-again', 'Look again'), button('archive-elsewhere', 'It is somewhere else…')));
  const { index, report } = shelf, matters = byMatter(index.items), names = [...new Set(index.items.map(item => item.matter))].sort();
  const item = entry => '<details class="item"><summary>' + h(itemWords(entry)) + ' <span class="subtle">· ' + entry.files.length + (entry.files.length === 1 ? ' file' : ' files') + '</span></summary>' +
    '<ul>' + entry.files.map(file => '<li>' + h(file.name) + ' <span class="subtle">' + sizeWords(file.bytes) + '</span></li>').join('') + '</ul>' +
    '<div class="tools">' + button('reveal', 'Show in Finder', { path: entry.path }) + '<label class="move">Move to another matter <input name="move:' + h(entry.path) + '" list="desk-matters" placeholder="Taxes/2026" data-enter="move" data-path="' + h(entry.path) + '"></label>' + button('move', 'Move', { path: entry.path }) + '</div></details>';
  const found = report ? (report.lines.length ? '<div class="note' + (report.ok ? '' : ' warn') + '">' + (report.ok ? '' : '<b>Not everything is as it was filed.</b> ') + report.lines.map(h).join(' ') + '</div>' : '') +
    (report.ok ? '<p><b>Every file is as it was filed:</b> ' + report.items + (report.items === 1 ? ' item, ' : ' items, ') + report.files + (report.files === 1 ? ' file' : ' files') + ', each read again and compared with its fingerprint.</p>' : '') : '';
  const loose = [...(index.notRecorded || []).map(path => path + ' (not recorded)'), ...(index.unfinished || []).map(entry => entry.path + ' (' + entry.what + ')'), ...(index.problems || []).map(entry => entry.path + ' (' + entry.problem + ')')];
  return panel('Archive', what + top + tools(button('reveal', 'Show it in Finder', { path: '' }), button('shelf-check', 'Check every file'), button('shelf-again', 'Look again')) + found +
    (matters.length ? matters.map(group => '<h3>' + h(group.matter) + '</h3>' + group.items.map(item).join('')).join('') : '<p>Nothing is filed yet. Fill a form, save its PDF, and press “File this PDF in the archive…”.</p>') +
    (loose.length ? '<p class="subtle">Also in the folder, left as they are: ' + h(loose.slice(0, 12).join('; ')) + (loose.length > 12 ? '; and ' + (loose.length - 12) + ' more' : '') + '.</p>' : '') +
    '<datalist id="desk-matters">' + names.map(name => '<option value="' + h(name) + '">').join('') + '</datalist>');
}
async function readShelf({ again = false } = {}) {
  if (!holder()) { shelf = null; return draw(); }
  try {
    const files = await archiveFiles(), book = openArchive(files);
    let index = null;
    if (!again) { try { const read = JSON.parse(decoder.decode(await files.read('.formfiller/index.json'))); if (read?.formFiller === 'archive-index' && Array.isArray(read.items)) index = read; } catch { /* made again, below */ } }
    index ??= await book.rebuildIndex();
    shelf = { index, book, report: again ? null : shelf?.report ?? null };
  } catch (error) { shelf = { problem: error.message || String(error) }; }
  draw();
}

// ---------- a filled form filed in the archive ----------
function filingScreen() {
  if (!filing) return panel('File in the archive', '<p>There is no PDF to file. Fill a form and save its PDF first.</p>' + tools('<button type="button" class="primary" data-go="form">Fill a form</button>'));
  if (filing.done) return panel('Filed', '<p>It is in your archive as <b>' + h(filing.done) + '</b>' + (filing.unsorted ? ', in “' + UNSORTED + '”, because no matter was named' : '') + '.</p>' +
    tools(button('reveal', 'Show in Finder', { path: filing.done }), '<button type="button" class="primary" data-go="form">Back to the form</button>', '<button type="button" class="secondary" data-go="archive">See the archive</button>'));
  if (!holder()) return panel('File in the archive', '<p>Say where your archive lives first; then press “File this PDF in the archive…” again.</p>' + tools('<button type="button" class="primary" data-go="setup">Set up</button>'));
  const names = [...new Set((shelf?.index?.items || []).map(item => item.matter))].sort();
  return panel('File in the archive', '<p>“' + h(filing.made.name) + '”' + (filing.original ? ' and the form it was made from, “' + h(filing.original.name) + '”,' : '') + ' go into one dated folder in your archive, with a record of what they are and a fingerprint of each.</p>' +
    '<div class="details"><label>What it is<input name="file-title" value="' + h(filing.title) + '"></label><label>Who it is with (an office, a company, a person)<input name="file-with" placeholder="IRS"></label>' +
    '<label>Sent or received<select name="file-direction"><option value="out">Sent, or to be sent</option><option value="in">Received</option></select></label>' +
    '<label>The matter it belongs to (a folder, like Taxes/2026)<input name="file-matter" list="desk-matters" placeholder="Taxes/2026" data-enter="file-it"></label></div>' +
    '<p class="subtle">With no matter named it goes to “' + UNSORTED + '”, to be moved later. Nothing is guessed.</p><datalist id="desk-matters">' + names.map(name => '<option value="' + h(name) + '">').join('') + '</datalist>' +
    tools(button('file-it', 'File it', { kind: 'primary' }), '<button type="button" class="secondary" data-go="form">Not now</button>'));
}

// ---------- backups ----------
function backupScreen() {
  const what = '<p class="subtle">A backup is one sealed copy of everything: your archive, your vault (details, signature and locker), the forms the app remembers and its settings. Only your passphrase or your recovery key opens it. Form Filler never deletes a backup.</p>';
  const elsewhere = tools(button('restore-pick', 'Restore from a backup somewhere else…'));
  // A backup needs a vault and an archive to copy. The backups already made can be looked at, checked and restored
  // without either: that is how a vault that was forgotten comes back.
  const need = ctx.keeper.state === 'none' ? '<p>A new backup is locked to your vault’s key, so the vault comes first.</p>' + tools('<button type="button" class="primary" data-go="setup">Set up</button>')
    : !holder() ? '<p>Say where your archive lives before a new backup is made.</p>' + tools('<button type="button" class="primary" data-go="setup">Set up</button>') : '';
  const to = settings().backup?.to, last = settings().backup?.last;
  if (!to) return panel('Backups', what + (need || '<p>Choose a drive or a folder for them: an external drive is best, since a backup on the same disk is lost with it.</p>' + tools(button('backup-choose', 'Choose where backups go…', { kind: 'primary' }))) + elsewhere);
  const row = entry => '<li><b>' + h(entry.name) + '</b> <span class="subtle">' + sizeWords(entry.bytes) + (entry.missing.length ? ' · missing: ' + h(entry.missing.join(', ')) : '') + '</span> ' +
    button('check', 'Check the copy', { path: entry.path, name: entry.name }) + button('check-fully', 'Check it fully…', { path: entry.path, name: entry.name }) + button('restore-this', 'Restore…', { path: entry.path, name: entry.name }) +
    (checking?.path === entry.path ? '<div class="details unlock"><label>The passphrase you had when it was made, or your recovery key<input type="password" name="check-secret" autocomplete="current-password" data-enter="check-go"></label></div>' + tools(button('check-go', 'Open it and check every file', { kind: 'primary' })) : '') + '</li>';
  return panel('Backups', what + '<p>They go to <b>' + h(shown(to)) + '</b>, in a folder named “' + BACKUPS + '”.' + (last ? ' The last one was made ' + h(whenWords(last)) + '.' : '') + '</p>' +
    (need || tools(button('backup-now', 'Back up now', { kind: 'primary' }), button('backup-choose', 'Choose another place…'))) + IN_VIEW +
    (backups === null ? '<p class="subtle">Looking for backups there…</p>' : backups.problem ? '<p class="warn">That place could not be read: ' + h(backups.problem) + '</p>'
      : (backups.backups.length ? '<h3>The backups there</h3><ul class="rows">' + [...backups.backups].reverse().map(row).join('') + '</ul>' : '<p>There is no backup there yet.</p>') +
        (backups.unfinished.length ? '<p class="subtle">A backup that was stopped left ' + backups.unfinished.length + ' unfinished folder' + (backups.unfinished.length === 1 ? '' : 's') + ' there (' + h(backups.unfinished.map(nameOf).join(', ')) + '). They can be deleted in Finder.</p>' : '')) + elsewhere);
}
async function readBackups() {
  const to = settings().backup?.to;
  if (!to) { backups = null; return draw(); }
  try { backups = await listBackups(tauriFiles(tauri, to)); } catch (error) { backups = { problem: error.message || String(error) }; }
  draw();
}
// The backups in a folder that was picked: the folder of one backup, a "Form Filler Backups" folder, or a drive or
// folder that holds one.
async function backupsIn(folder) {
  const files = tauriFiles(tauri, folder);
  if ((await files.stat(SNAPSHOT))?.kind === 'file') return [{ name: nameOf(folder), path: folder }];
  if ((await files.stat(BACKUPS))?.kind === 'folder') return (await listBackups(files)).backups.map(entry => ({ name: entry.name, path: folder + '/' + entry.path }));
  const found = [];
  for (const entry of await files.list('')) if (entry.kind === 'folder' && (await files.stat(entry.name + '/' + SNAPSHOT))?.kind === 'file') found.push({ name: entry.name, path: folder + '/' + entry.name });
  return found;
}

// ---------- restore ----------
function restoreScreen() {
  if (!restoring) return panel('Restore a backup', '<p>Choose the backup’s folder: it is named for the day and time it was made, inside “' + BACKUPS + '”.</p>' + tools(button('restore-pick', 'Choose a backup…', { kind: 'primary' })));
  if (restoring.result) return panel('Restored', '<ul class="rows">' + restoring.result.map(line => '<li>' + h(line) + '</li>').join('') + '</ul>' + tools(button('reload', 'Open what was restored', { kind: 'primary' })));
  if (restoring.choices) return panel('Restore a backup', '<p>Which one?</p><ul class="rows">' + [...restoring.choices].reverse().map(entry => '<li><b>' + h(entry.name) + '</b> ' + button('restore-this', 'Restore this one…', { path: entry.path, name: entry.name })).join('</li>') + '</li></ul>');
  const kept = restoring.holder || holder() || 'home';
  return panel('Restore the backup of ' + h(restoring.name),
    '<p>From <b>' + h(shown(restoring.path)) + '</b>. Every file is checked against the backup’s own list before anything is moved, and nothing here is overwritten: if a vault or an archive is here already, the restored one is put beside it.</p>' +
    '<p>Your archive goes to <b>' + h(shown(archivePath(kept))) + '</b>.' + (holder() ? '' : ' ' + button('restore-holder', 'Choose another folder to hold it…')) + '</p>' +
    '<div class="details unlock"><label>The passphrase you had when this backup was made, or your recovery key<input type="password" name="restore-secret" autocomplete="current-password" data-enter="restore-go"></label></div>' +
    tools(button('restore-go', 'Restore', { kind: 'primary' }), '<button type="button" class="secondary" data-go="backup">Cancel</button>') + IN_VIEW);
}

const SCREENS = { setup: setupScreen, locker: lockerScreen, archive: archiveScreen, filing: filingScreen, backup: backupScreen, restore: restoreScreen, form: () => '' };

const ACTIONS = {
  lock() { if (!ctx.keeper.lock()) { said = 'Keep your recovery key first, then lock.'; warned = true; draw(); } },   // locked, the screen is drawn again by changed()
  stop() { stopper?.abort(); progress('Stopping…'); },
  reload() { location.reload(); },
  'setup-later'() { screen = 'form'; draw(); },
  'make-vault'() {
    const passphrase = field('setup-passphrase'), again = field('setup-again');
    return run('Making your vault…', async () => {
      if (passphrase !== again) throw new Error('The two passphrases are not the same.');
      await ctx.keeper.create(passphrase);
    });
  },
  'key-print'() {
    // The key's box alone is printed (desk.css), and stays alone on the page until the next thing done on it: the app
    // does not say when printing is over.
    const page = document.documentElement, after = () => { page.classList.remove('print-desk-key'); for (const kind of ['pointerdown', 'keydown']) document.removeEventListener(kind, after, true); };
    page.classList.add('print-desk-key');
    for (const kind of ['pointerdown', 'keydown']) document.addEventListener(kind, after, true);
    return call(() => tauri.invoke('print_page')).catch(error => { after(); said = h('It could not be printed: ' + error.message + ' Write the key down instead.'); warned = true; draw(); });
  },
  'key-kept'() { ctx.keeper.keptKey(); },
  'archive-home': () => keepArchiveIn('home'),
  async 'archive-choose'() { const chosen = await pickFolder('Choose the folder that will hold “' + ARCHIVE + '”'); if (chosen) { picked = chosen; draw(); } },
  'archive-use': () => picked && keepArchiveIn(picked),
  async 'archive-elsewhere'() { const chosen = await pickFolder('Choose the folder that holds “' + ARCHIVE + '”'); if (chosen) await keepArchiveIn(chosen).then(() => readShelf({ again: true })); },
  unlock() {
    const secret = field('desk-secret');
    return run('Unlocking…', async () => {
    if (!secret) throw new Error('Type your passphrase, or your recovery key.');
    const unreadable = await ctx.keeper.unlock(secret);
    if (unreadable) { said = h('Unlocked, but your saved details could not be read (' + unreadable + ') Save them again under “Fill a form”.'); warned = true; }
    await readLocker();
    });
  },
  async 'doc-pick'() {
    const chosen = await tauri.dialog.open({ multiple: false, title: 'Choose a document for the locker' });
    if (typeof chosen !== 'string') return;
    await run('Reading the document…', async () => {
      const bytes = new Uint8Array(await call(() => tauri.fs.readFile(chosen)));
      if (bytes.length > LOCKER_LIMIT) throw new Error('That file is ' + sizeWords(bytes.length) + '. The locker takes documents up to ' + sizeWords(LOCKER_LIMIT) + '.');
      adding = { name: nameOf(chosen), bytes };
    });
  },
  'doc-cancel'() { adding = null; draw(); },
  'doc-add'() {
    const title = field('doc-title'), kind = field('doc-kind') || 'document';
    return adding && run('Sealing it into the locker…', async () => {
      const vault = ctx.keeper.vault();
      if (!vault) throw new Error('The vault locked while you were choosing. Unlock it and add the document again.');
      const entry = await vault.addDocument({ title, kind, name: adding.name, bytes: adding.bytes });
      adding = null;
      said = '“' + h(entry.title) + '” is in the locker.';
      await readLocker();
    });
  },
  'doc-save': target => run('Opening the document…', async () => {
    const vault = ctx.keeper.vault(), entry = (locker || []).find(item => item.id === target.dataset.id);
    if (!vault || !entry) throw new Error('The vault is locked. Unlock it first.');
    const bytes = await vault.readDocument(entry.id), path = await saveAs(bytes, entry.name || entry.title);
    if (path) said = 'A copy of “' + h(entry.title) + '” was saved as ' + h(shown(path)) + '. The one in the locker stays there.';
  }),
  'shelf-again': () => run('Reading every record in the archive…', () => readShelf({ again: true })),
  'shelf-check': () => run('Reading every file in the archive again…', async () => {
    if (!shelf?.book) await readShelf();
    const report = await shelf.book.verify();
    shelf.report = { ok: report.ok, items: report.items, files: report.files, lines: verifyWords(report) };
  }),
  reveal: target => call(() => tauri.invoke('reveal', { path: archivePath() + (target.dataset.path ? '/' + target.dataset.path : '') })).catch(error => { said = h(error.message); warned = true; draw(); }),
  move(target) {
    const path = target.dataset.path, matter = field('move:' + path).trim();
    return run('Moving it…', async () => {
    if (!matter) throw new Error('Name the matter to move it to, like Taxes/2026.');
    const moved = await shelf.book.moveItem(path, matter);
    said = 'Moved to ' + h(moved.path) + '.';
    drawn = ''; shelf.report = null;
    await readShelf();
    });
  },
  'file-it'() {
    const title = field('file-title').trim(), counterparty = field('file-with').trim(), matter = field('file-matter').trim(), direction = field('file-direction') === 'in' ? 'in' : 'out';
    return filing && !filing.done && run('Filing it…', async () => {
    if (!title || !counterparty) throw new Error('Say what it is, and who it is with.');
    const book = openArchive(await archiveFiles());
    const { path } = await book.createItem({ matter: matter || null, title, counterparty, direction, channel: 'export', reason: matter ? 'chosen when it was filed' : 'no matter was named',
      form: { sha256: filing.made.form, answersSha256: filing.made.answers }, files: [...(filing.original ? [{ role: 'original', name: filing.original.name, bytes: filing.original.bytes }] : []), { role: 'filled', name: filing.made.name, bytes: filing.made.bytes }] });
    filing = { ...filing, done: path, unsorted: !matter };
    shelf = null;
    });
  },
  async 'backup-choose'() {
    const chosen = await pickFolder('Choose the drive or folder for your backups');
    if (!chosen) return;
    await run('Looking at that place…', async () => {
      const real = path => call(() => tauri.invoke('real_path', { path }));
      const [to, archive, data] = [await real(chosen), await real(archivePath()).catch(() => archivePath()), await real(where.data)];
      if (within(to, archive) || within(to, data)) throw new Error('That folder is inside what a backup copies. A backup kept there would be lost with it: choose another drive or folder.');
      await ctx.store.change({ backup: { ...settings().backup, to: chosen } });
      await readBackups();
    });
  },
  'backup-now': () => run('Backing up…', async signal => {
    const to = settings().backup.to;
    const made = await makeBackup({ data: dataFiles(), archive: await archiveFiles(), destination: counted(tauriFiles(tauri, to), meter('Backing up…')), signal });
    await ctx.store.change({ backup: { ...settings().backup, last: made.made } });
    said = '<b>Backed up.</b> ' + made.files + ' files, ' + sizeWords(made.bytes) + ', in ' + h(shown(to + '/' + made.path)) + '. The copy was read back from the drive and matches. ' +
      (made.skipped.length ? 'Left out, because they are links: ' + h(made.skipped.map(item => item.path).slice(0, 6).join('; ')) + '. ' : '') + 'To prove it opens with your passphrase, press “Check it fully…”.';
    await readBackups();
  }, { stoppable: true }),
  check: target => run('Reading the copy and comparing it with its fingerprints…', async () => {
    const report = await verifyBackup(tauriFiles(tauri, settings().backup.to + '/' + target.dataset.path));
    said = report.ok ? 'The copy of ' + h(target.dataset.name) + ' matches its fingerprints. That it opens with your passphrase is what “Check it fully…” proves.' : '<b>' + h(target.dataset.name) + ' is not whole.</b> ' + h(report.problems.map(item => item.path + ': ' + item.problem).join('. ')) + '.';
    warned = !report.ok;
  }),
  'check-fully'(target) { checking = { path: target.dataset.path, name: target.dataset.name }; said = ''; draw(); root.querySelector('[name="check-secret"]')?.focus(); },
  'check-go'() {
    const secret = field('check-secret');
    return checking && run('Opening the backup and checking every file in it…', async () => {
    const { path, name } = checking;
    if (!secret) throw new Error('Type the passphrase you had when it was made, or your recovery key.');
    const report = await verifyBackup(tauriFiles(tauri, settings().backup.to + '/' + path), { secret });
    checking = null;
    said = report.ok ? '<b>' + h(name) + ' is whole and opens.</b> ' + report.files + ' files, ' + sizeWords(report.bytes) + ', each checked against the backup’s own list.' + (report.notes.length ? ' ' + h(report.notes.map(item => item.note).join('. ')) + '.' : '')
      : '<b>' + h(name) + ' is not whole.</b> ' + h(report.problems.map(item => item.path + ': ' + item.problem).join('. ')) + '.';
    warned = !report.ok;
    });
  },
  async 'restore-pick'() {
    const chosen = await pickFolder('Choose a backup: its own folder, “' + BACKUPS + '”, or the drive that holds it');
    if (!chosen) return;
    await run('Looking for backups there…', async () => {
      const found = await backupsIn(chosen);
      if (!found.length) throw new Error('There is no Form Filler backup in ' + shown(chosen) + '. A backup is a folder named for its day and time, holding ' + SNAPSHOT + '.');
      restoring = found.length === 1 ? found[0] : { choices: found };
      screen = 'restore';
    });
  },
  'restore-this'(target) {
    const path = target.dataset.path;
    restoring = { name: target.dataset.name, path: path.startsWith('/') ? path : settings().backup.to + '/' + path };
    screen = 'restore'; said = ''; draw(); root.querySelector('[name="restore-secret"]')?.focus();
  },
  async 'restore-holder'() { const chosen = await pickFolder('Choose the folder that will hold “' + ARCHIVE + '”'); if (chosen && restoring) { restoring.holder = chosen; draw(); } },
  'restore-go'() {
    const secret = field('restore-secret');
    return restoring?.path && run('Restoring…', async signal => {
    const kept = restoring.holder || holder() || 'home';
    if (!secret) throw new Error('Type the passphrase you had when this backup was made, or your recovery key.');
    const tell = meter('Restoring…');
    const result = await restoreBackup({ backup: tauriFiles(tauri, restoring.path), secret, data: counted(dataFiles(), tell), archive: { parent: counted(holderFiles(kept), tell), name: ARCHIVE }, signal });
    // The settings may have just been put back from the backup: they are read again before anything is written to
    // them, and then say where the archive now is, if it was put in place.
    await ctx.store.reload();
    if (result.placed.some(item => item.what === 'archive' && !item.beside) && settings().archive?.holder !== kept) await ctx.store.change({ archive: { ...settings().archive, holder: kept } });
    restoring = { ...restoring, result: restoredWords(result, shown(holderPath(kept))) };
    }, { stoppable: true });
  },
};

root.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target || working && target.dataset.act !== 'stop') return;
  if (target.dataset.go) void go(target.dataset.go);
  else if (ACTIONS[target.dataset.act]) void ACTIONS[target.dataset.act](target);
});
root.addEventListener('keydown', event => {
  const act = event.key === 'Enter' && event.target.dataset?.enter;
  if (act && ACTIONS[act] && !working) { event.preventDefault(); void ACTIONS[act](event.target); }
});

// A file saved where you say, through the app's own save dialog: for the page's PDFs, templates and CSV files, and
// for a copy of a locker document. Gives the path it was saved at, or null if you closed the dialog.
export async function saveAs(data, name) {
  const path = await tauri.dialog.save({ defaultPath: name, title: 'Save “' + name + '”' });
  if (typeof path !== 'string') return null;
  await call(() => tauri.fs.writeFile(path, typeof data === 'string' ? encoder.encode(data) : data));
  return path;
}

// The PDF the page just made, and the form it was made from, taken to the filing screen.
export async function fileInArchive({ made, original, title }) {
  filing = { made, original, title };
  screen = 'filing'; said = ''; warned = false;
  draw();
  if (holder() && !shelf?.index) await readShelf();
}

// Started by the page once it is drawn. Gives back `changed`, which the page calls when the vault is made, opened,
// locked or forgotten.
export function start(context) {
  ctx = context;
  context.app.before(root);
  let last = '';
  const decide = () => { if (!decided && where && context.keeper.state !== 'checking') { decided = true; if (context.keeper.state === 'none' && !holder()) screen = 'setup'; } };
  draw();
  void places().then(async found => { await context.store.ready.catch(() => {}); where = found; decide(); draw(); }, error => { said = h('The app could not say where its folders are: ' + (error.message || error)); warned = true; draw(); });
  return {
    changed() {
      const now = context.keeper.state + (context.keeper.recoveryKey ? ' key' : '');
      if (now === last) return;
      last = now;
      decide();
      // Locked: what was read from the vault leaves the screen, and so does a note that may name what was in it.
      if (context.keeper.state !== 'open') { locker = null; adding = null; if (screen === 'locker') { said = ''; warned = false; } }
      draw();
      if (screen === 'locker' && context.keeper.state === 'open' && locker === null) void readLocker();
    },
  };
}
