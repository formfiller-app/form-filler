// The words and small sums of the Mac app's own screens (desk.js), kept apart from the screens so they can be tested
// without a window.
export const ARCHIVE = 'Form Filler Archive';

// A size as a person reads it: 181234 bytes is "181 KB".
export function sizeWords(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return bytes + (bytes === 1 ? ' byte' : ' bytes');
  for (const [unit, size] of [['KB', 1e3], ['MB', 1e6], ['GB', 1e9]]) if (bytes < size * 1000 || unit === 'GB') return (bytes / size >= 100 ? Math.round(bytes / size) : Math.round(bytes / size * 10) / 10) + ' ' + unit;
  return '';
}

// A moment as records write it (2026-11-17T15:30:00-05:00), as a day and a time of day: "2026-11-17 15:30".
export const whenWords = moment => typeof moment === 'string' && moment.length >= 16 ? moment.slice(0, 10) + ' ' + moment.slice(11, 16) : String(moment || '');

// One folder inside another, or the same one: a backup must not be written into what it is a backup of.
export const within = (path, folder) => { const top = String(folder).replace(/\/+$/, ''); return path === top || String(path).startsWith(top + '/'); };

// What is likely to copy a folder to its own servers, by where the folder is, or null. The archive is plain files, so
// a folder that syncs would upload every paper in it.
export function cloudHint(path, home) {
  const at = String(path || '');
  if (/\/Library\/Mobile Documents(\/|$)/.test(at) || /\/iCloud Drive(\/|$)/i.test(at)) return 'iCloud Drive';
  if (/\/Library\/CloudStorage(\/|$)/.test(at)) return 'a syncing service (its folder is in Library/CloudStorage)';
  for (const [pattern, name] of [[/\/Dropbox[^/]*(\/|$)/i, 'Dropbox'], [/\/(Google ?Drive|My Drive)[^/]*(\/|$)/i, 'Google Drive'], [/\/OneDrive[^/]*(\/|$)/i, 'OneDrive'], [/\/Box( Sync)?(\/|$)/, 'Box']])
    if (pattern.test(at)) return name;
  if (home && (within(at, home + '/Documents') || within(at, home + '/Desktop'))) return 'iCloud, if “Desktop & Documents Folders” is switched on in its settings';
  return null;
}

// An index's items by matter: [{ matter, items }], matters in name order, each matter's items newest first.
export function byMatter(items) {
  const matters = new Map();
  for (const item of items || []) { if (!matters.has(item.matter)) matters.set(item.matter, []); matters.get(item.matter).push(item); }
  const day = item => String((item.direction === 'in' ? item.dates?.received : item.dates?.sent) || item.dates?.created || '');
  return [...matters].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([matter, list]) => ({ matter, items: list.sort((a, b) => day(a) < day(b) ? 1 : day(a) > day(b) ? -1 : a.path < b.path ? -1 : 1) }));
}

// One item as a line: "2026-11-17 · sent · IRS · Form 1040".
export const itemWords = item => [String((item.direction === 'in' ? item.dates?.received : item.dates?.sent) || item.dates?.created || '').slice(0, 10), item.direction === 'in' ? 'received' : 'sent', item.counterparty, item.title].join(' · ');

// What a check of the archive found, as lines a person can act on; none when everything is as it was filed.
export function verifyWords(report) {
  const lines = [], list = (paths, most = 8) => paths.slice(0, most).join('; ') + (paths.length > most ? '; and ' + (paths.length - most) + ' more' : '');
  if (report.missing.length) lines.push('Missing: ' + list(report.missing) + '.');
  if (report.changed.length) lines.push('Changed since it was filed: ' + list(report.changed) + '.');
  if (report.gone.length) lines.push('No longer in the archive: ' + list(report.gone.map(item => item.path)) + '.');
  if (report.unfinished.length) lines.push('Left unfinished when the app stopped: ' + list(report.unfinished.map(item => item.path)) + '.');
  if (report.problems.length) lines.push('Could not be read: ' + list(report.problems.map(item => item.path + ' (' + item.problem + ')'), 4) + '.');
  if (report.unrecorded.length) lines.push('In the archive but not recorded (left as they are): ' + list(report.unrecorded) + '.');
  return lines;
}

// What a restore did, as lines: each thing back in its place, or put beside what was there already.
export function restoredWords(result, folder) {
  const names = { vault: 'Your vault (your details, signature and locker)', templates: 'The forms the app remembers', 'settings.json': 'The app’s settings', archive: 'Your archive' };
  const lines = result.placed.map(item => item.beside
    ? names[item.what] + ': something was there already, so this copy is beside it, as “' + item.path + '”' + (item.what === 'archive' ? ' in ' + folder : ' in the app’s data folder') + '. Nothing was overwritten.'
    : names[item.what] + ': back in place' + (item.what === 'archive' ? ', as “' + item.path + '” in ' + folder : '') + '.');
  lines.push(result.files + ' files, ' + sizeWords(result.bytes) + ', each checked against the backup’s own list before anything was moved.');
  if (result.vault && !result.vault.details && !result.vault.documents) lines.push('The vault in this backup held no details and no locker documents. If yours held some, this is not a backup you made.');
  if (result.skipped?.length) lines.push('Not in the backup, because they were links: ' + result.skipped.map(item => item.path).slice(0, 6).join('; ') + '.');
  if (result.unfinished?.length) lines.push('An earlier restore that was stopped left ' + result.unfinished.length + ' hidden folder' + (result.unfinished.length === 1 ? '' : 's') + ' behind (' + result.unfinished.map(item => item.path).join(', ') + '). They can be deleted in Finder.');
  return lines;
}
