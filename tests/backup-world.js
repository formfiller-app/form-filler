// The small world the backup tests and the stock-tool tests back up, wipe and restore, all of it invented: a vault in
// a data folder, with your details, a saved signature and two locker documents, beside two templates and a settings
// file; and an archive holding every awkward name the plan asks for (accents written both ways, 200-character names,
// spaces, a file filed twice, hidden files and empty folders), with one file large enough that the snapshot spans
// several of age's 64 KiB chunks. scrypt runs at FAST, so the tests are quick.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createVault, makeTemplate, openArchive } from '../src/lib/index.js';
import { nodeFiles } from '../src/lib/files/node.js';
import { nodeStore } from '../src/lib/stores/node.js';

export const FAST = { workFactor: 10 };
export const clock = () => new Date(2026, 10, 17, 15, 30, 0);
export const DETAILS = { fullName: 'Jane Roe', email: 'jane@example.org', phone: '555-0100' };
export const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';
export const PASSPHRASE = 'invented horse battery staple';
export const STAMP = '2026-11-17 1530';
const IRS = { matter: 'Taxes/2026', title: 'Form 1040', direction: 'out', counterparty: 'IRS', channel: 'export' };
const bytes = text => new TextEncoder().encode(text);

export const hashOf = data => createHash('sha256').update(data).digest('hex');
// Every file on a real disk by path with its SHA-256; with `folders`, every folder too (as "path/").
export const walk = (dir, { folders = false } = {}, at = '') => {
  const out = new Map();
  for (const entry of readdirSync(join(dir, at), { withFileTypes: true })) {
    const path = at ? at + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { if (folders) out.set(path + '/', 'folder'); for (const [inner, hash] of walk(dir, { folders }, path)) out.set(inner, hash); }
    else if (entry.isFile()) out.set(path, hashOf(readFileSync(join(dir, path))));
  }
  return out;
};

// <scratch>/world-*/Test Data (vault/, templates/, settings.json) and <scratch>/world-*/Test Archive. Returns the
// folders, the vault's recovery key and the archive's index as rebuildIndex made it.
export async function makeWorld(scratch) {
  const root = mkdtempSync(join(scratch, 'world-')), data = join(root, 'Test Data'), archive = join(root, 'Test Archive');
  mkdirSync(data);
  const { vault, recoveryKey } = await createVault(nodeStore(join(data, 'vault')), PASSPHRASE, { ...FAST, now: clock });
  await vault.writeProfile({ details: DETAILS, signature: SIGNATURE });
  const card = await vault.addDocument({ title: 'Invented ID card', kind: 'id', name: 'card.pdf', bytes: bytes('%PDF- not a real card') });
  await vault.addDocument({ title: 'Invented letter', name: 'letter.txt', bytes: bytes('not a real letter') });
  // A record, so that every backup and restore here proves records ride along with the rest (docs/VAULT_RECORDS.md).
  await vault.putRecord({ kind: 'credential', title: 'Invented nursing licence', documents: [card.id],
    fields: { number: 'INV-44821', body: 'Invented Board of Nursing', kind: 'Registered nurse', expires: '02/30/2029', status: 'Active' } });
  vault.lock();
  mkdirSync(join(data, 'templates'));
  for (const name of ['visitor pass.pdf', 'parking permit.pdf']) {
    const form = hashOf('an invented form: ' + name);
    const template = makeTemplate({ form: { sha256: form, name, type: 'pdf' }, pages: [{ width: 612, height: 792, pdfPage: 0 }], blanks: [{ page: 0, kind: 'line', x0: 72, y0: 100, x1: 300, y1: 120, label: 'Full name' }] });
    writeFileSync(join(data, 'templates', form + '.json'), JSON.stringify(template, null, 1) + '\n');
  }
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ dateStyle: 'iso', note: 'invented settings' }, null, 2) + '\n');
  mkdirSync(archive);
  const book = openArchive(nodeFiles(archive), { now: clock });
  await book.init();
  const { path } = await book.createItem({ ...IRS, files: [{ role: 'original', name: 'f1040.pdf', bytes: bytes('%PDF- the invented blank form') }, { role: 'filled', name: 'f1040.pdf', bytes: bytes('%PDF- the invented form, filled') }] });
  await book.addFile(path, { role: 'confirmation', name: 'e-file receipt.pdf', bytes: bytes('%PDF- an invented receipt') });
  const scan = Uint8Array.from({ length: 300 * 1024 }, (_, i) => (i * 7919) % 251);
  await book.createItem({ matter: 'Housing/Rue de l’Été', title: 'Lease renewal', direction: 'in', counterparty: '..Ville de Montréal ',
    files: [{ role: 'original', name: 'é'.repeat(200) + '.pdf', bytes: bytes('%PDF- an invented lease') }, { role: 'scan', name: 'survey scan.tif', bytes: scan }] });
  await book.createItem({ matter: 'Housing', title: 'é'.repeat(200), direction: 'out', counterparty: 'Landlord', files: [{ role: 'filled', name: 'notice.pdf', bytes: bytes('%PDF- an invented notice') }] });
  await book.createItem({ matter: null, title: 'Letter', direction: 'in', counterparty: 'City Hall',
    files: [{ role: 'original', name: 'letter page.pdf', bytes: bytes('an invented page') }, { role: 'original', name: 'letter page.pdf', bytes: bytes('an invented page') }] });
  // What other programs leave: Finder's own file, and a folder whose accent is written apart (e, then U+0301).
  writeFileSync(join(archive, '.DS_Store'), 'Finder\'s own');
  mkdirSync(join(archive, 'Café'));
  writeFileSync(join(archive, 'Café', '.DS_Store'), 'Finder\'s own, in a folder another program made');
  const index = await book.rebuildIndex();
  return { root, data, archive, recoveryKey, index };
}
