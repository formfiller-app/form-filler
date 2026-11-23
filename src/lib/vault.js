// The vault: what is yours and secret (your details, your saved signature, the documents in your locker), encrypted
// with age (age-encryption.org), a published format with a stock command-line tool, so every vault file is meant to
// open with `age -d` even if Form Filler is gone. tests/interop.test.js opens them with the stock tool where it is
// installed: identity.age with the passphrase, typed at a terminal, which the test can give the tool on Linux only;
// every other one with the recovery key.
//
//   vault.json          not secret: the format, when the vault was made, and the vault key's public half
//   identity.age        the vault key itself, locked with your passphrase (the only file the passphrase touches)
//   profile.age         your details and saved signature, locked to the vault key
//   locker/index.age    the locker's list: each document's id, title, kind, name, date, size and SHA-256
//   locker/<id>.age     one document's exact bytes
//   records/index.age   the records' list: each record's id, kind and title
//   records/<id>.age    one record: its fields, the locker documents that prove it, and when it was last confirmed
//
// Your passphrase unlocks the key (scrypt, at age's own work factor); the key unlocks everything else. So changing the
// passphrase rewrites one small file, a backup can be made while the vault is locked (it needs only the public half),
// and the key itself is the recovery key, shown once when the vault is made, to print or write down. The passphrase
// is never kept. Changing it locks the same key again: an earlier copy of identity.age (a backup's, say) still opens
// with the old one, so after a passphrase may have been seen, the way out is a new vault.
//
// Anyone who can write the vault's store could seal a file to its public half, which vault.json shows. So each record
// also carries a tag only the vault key can make (HMAC-SHA-256 keyed from the key), and each document is checked
// against the size and SHA-256 in the tagged list: a damaged file, one put in another's place, or one sealed by
// someone else is refused, not used. What a tag cannot catch is an older genuine record put back in place of a newer.
//
// A vault lives in a store (stores/memory.js, stores/node.js, stores/browser.js): a few named files, each written whole.
// The key and your details keep no earlier copy, so a forgotten signature or an old passphrase is gone from the store.
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { cleanRecordFields, isKnownKind } from './record-kinds.js';
import { hex, sha256 } from './hash.js';

export const VAULT = 'vault.json', KEY = 'identity.age', PROFILE = 'profile.age', LOCKER = 'locker/index.age';
export const RECORDS = 'records/index.age';
// The shortest passphrase taken. Longer is much better: a few unrelated words are easy to remember and hard to guess.
export const MIN_PASSPHRASE = 8;
// The highest scrypt work factor (log2) a key file may ask for: age's own is 18, and anything far above is refused
// before it is tried, so a planted key file cannot keep the page busy for minutes.
const MAX_WORK = 20;
const RECORD_LIMIT = 8 * 1024 * 1024;   // bytes in a sealed record: your details and a signature are a few kilobytes

const encoder = new TextEncoder(), decoder = new TextDecoder();
const json = value => encoder.encode(JSON.stringify(value, null, 2) + '\n');
const RECIPIENT = /^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/, SECRET = /^AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}$/, HEX64 = /^[0-9a-f]{64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const pad = (value, width = 2) => String(value).padStart(width, '0');
// A moment in local time with its offset: 2026-11-17T15:30:00-05:00.
const localTime = date => {
  const offset = -date.getTimezoneOffset(), size = Math.abs(offset);
  return pad(date.getFullYear(), 4) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':'
    + pad(date.getSeconds()) + (offset < 0 ? '-' : '+') + pad(Math.floor(size / 60)) + ':' + pad(size % 60);
};
const newId = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const digits = hex(bytes);
  return [digits.slice(0, 8), digits.slice(8, 12), digits.slice(12, 16), digits.slice(16, 20), digits.slice(20)].join('-');
};
const fault = (code, message) => Object.assign(new Error(message), { code });

// Your details are words, and a saved signature is a PNG picture and nothing else; anything else read back is dropped.
export const cleanDetails = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string')) : {};
export const cleanSignature = value => typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;

export function checkPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE || !passphrase.trim())
    throw fault('EWEAK', 'A passphrase needs at least ' + MIN_PASSPHRASE + ' characters; a few unrelated words are best.');
  return passphrase;
}

// The key file inside identity.age, written as age-keygen writes one, so `age -d -o key.txt identity.age` gives a key
// the stock tool takes with -i. It must hold exactly one key.
const keyFile = (identity, recipient, made) => {
  if (!TIME.test(made) || !RECIPIENT.test(recipient) || !SECRET.test(identity)) throw new Error('Not a key file this vault would write.');
  return encoder.encode('# Form Filler vault key, made ' + made + '\n# public key: ' + recipient + '\n' + identity + '\n');
};
const keyIn = text => { const keys = String(text).match(/^AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}$/gm) || []; return keys.length === 1 ? keys[0] : null; };
// A secret as it was typed: the recovery key (spaces and line breaks taken out, in capitals) when it is one, and
// otherwise the passphrase, exactly as typed.
const secretOf = secret => { const typed = String(secret ?? ''), key = typed.replace(/\s+/g, '').toUpperCase(); return key.startsWith('AGE-SECRET-KEY-1') ? { key } : { passphrase: typed }; };
// The key in a key file (identity.age), opened with the passphrase: checked first to be a file this vault writes, so a
// planted one is refused before scrypt runs. `wrong` is what to say when the passphrase does not open it. Gives the
// one key the file holds, or null.
async function openKeyFile(sealed, passphrase, what, wrong) {
  checkHeader(sealed, 'key', what);
  let text;
  try { const decrypter = new Decrypter(); decrypter.addPassphrase(passphrase); text = await decrypter.decrypt(sealed, 'text'); }
  catch { throw fault('EPASSPHRASE', wrong); }
  return keyIn(text);
}

// An age file's header, read before anything in it is decrypted, must be what this vault writes: one stanza, X25519 for
// a record or a document, scrypt at a work factor this vault would use for the key file.
function checkHeader(bytes, kind, what) {
  const head = decoder.decode(bytes.subarray(0, 1200)), lines = head.split('\n'), stanzas = [];
  const refuse = () => { throw fault('EFOREIGN', what + ' is not a file this vault wrote.'); };
  if (lines[0] !== 'age-encryption.org/v1') refuse();
  let end = 1;
  for (; end < lines.length && !lines[end].startsWith('--- '); end++) if (lines[end].startsWith('-> ')) stanzas.push(lines[end].slice(3).split(' '));
  if (end >= lines.length || stanzas.length !== 1) refuse();
  const [type, ...args] = stanzas[0];
  if (kind === 'key' ? type !== 'scrypt' || args.length !== 2 || !/^\d{1,2}$/.test(args[1]) || Number(args[1]) > MAX_WORK : type !== 'X25519' || args.length !== 1) refuse();
}

const sealTo = async (recipient, bytes) => { const encrypter = new Encrypter(); encrypter.addRecipient(recipient); return encrypter.encrypt(bytes); };
const sealWith = async (passphrase, bytes, workFactor) => {
  const encrypter = new Encrypter();
  encrypter.setPassphrase(passphrase);
  if (workFactor) encrypter.setScryptWorkFactor(workFactor);
  return encrypter.encrypt(bytes);
};

function readInfo(bytes) {
  let data;
  try { data = JSON.parse(decoder.decode(bytes)); } catch { data = null; }
  if (!data || data.formFiller !== 'vault' || data.version !== 1 || !RECIPIENT.test(data.recipient || '') || !TIME.test(data.made || '')) throw fault('EINFO', 'This vault\'s vault.json is not readable.');
  return { formFiller: 'vault', version: 1, made: data.made, recipient: data.recipient };
}

// What the store says about its vault, from vault.json (nothing secret), or null when there is none.
export async function vaultInfo(store) {
  const bytes = await store.get(VAULT);
  return bytes ? readInfo(bytes) : null;
}

// A new vault, unlocked: a new key, locked with the passphrase. Returns { vault, recoveryKey }. The recovery key is the
// vault key itself ("AGE-SECRET-KEY-1…"): shown once, to be kept on paper; Form Filler keeps it nowhere but locked.
// What a half-made vault left (files but no vault.json) is cleared first. `workFactor` is scrypt's (log2), for tests.
export async function createVault(store, passphrase, { now = () => new Date(), workFactor } = {}) {
  checkPassphrase(passphrase);
  if (await store.get(VAULT)) throw new Error('There is already a vault here: unlock it, or forget it first.');
  if ((await store.list()).length) await store.clear();
  const identity = await generateX25519Identity(), recipient = await identityToRecipient(identity), made = localTime(now());
  await store.put(KEY, await sealWith(passphrase, keyFile(identity, recipient, made), workFactor), { prev: false });
  await store.put(VAULT, json({ formFiller: 'vault', version: 1, made, recipient }), { prev: false });
  return { vault: unlocked(store, { formFiller: 'vault', version: 1, made, recipient }, identity, now), recoveryKey: identity };
}

// The vault unlocked, with its passphrase or with the recovery key. A wrong one is refused, saying so.
export async function unlockVault(store, secret, { now = () => new Date() } = {}) {
  const info = await vaultInfo(store);
  if (!info) throw new Error('There is no vault here.');
  const { key, passphrase } = secretOf(secret);
  let identity;
  if (key) {
    if (!SECRET.test(key)) throw fault('EPASSPHRASE', 'That recovery key is not whole: check it letter by letter.');
    let recipient = null;
    try { recipient = await identityToRecipient(key); } catch { /* a typing mistake the key's own check caught */ }
    if (recipient !== info.recipient) throw fault('EPASSPHRASE', 'That recovery key does not open this vault: check it letter by letter.');
    identity = key;
  } else {
    const sealed = await store.get(KEY);
    if (!sealed) throw new Error('This vault\'s key (identity.age) is missing; only the recovery key can open it now.');
    identity = await openKeyFile(sealed, passphrase, 'The vault\'s key file (identity.age)', 'That passphrase does not open this vault.');
    if (!identity || await identityToRecipient(identity) !== info.recipient) throw new Error('This vault\'s key file is not its own (identity.age does not match vault.json).');
  }
  return unlocked(store, info, identity, now);
}

// A vault key on its own, with no vault beside it: a backup's copy of identity.age (`sealed`, its bytes, or null when
// there is none), opened with the passphrase, or the recovery key itself, typed any way. Gives { recipient, by,
// decrypt(stream) }: the key's public half, "passphrase" or "recovery key" for which one opened it, and a way to open
// an age stream sealed to the key. The key itself stays in here, as an unlocked vault's does. A passphrase with no key
// file is refused with ENOKEY.
export async function unlockKey(sealed, secret) {
  const { key, passphrase } = secretOf(secret);
  let identity, recipient = null;
  if (key) {
    if (SECRET.test(key)) { try { recipient = await identityToRecipient(key); } catch { /* a typing mistake the key's own check caught */ } }
    if (!recipient) throw fault('EPASSPHRASE', 'That recovery key is not whole: check it letter by letter.');
    identity = key;
  } else {
    if (!sealed) throw fault('ENOKEY', 'There is no key file (identity.age) here; only the recovery key opens this.');
    identity = await openKeyFile(sealed, passphrase, 'This key file (identity.age)', 'That passphrase does not open this key file.');
    try { recipient = identity && await identityToRecipient(identity); } catch { recipient = null; }
    if (!recipient) throw fault('EFOREIGN', 'This key file (identity.age) is not a file this vault wrote: it does not hold one key.');
  }
  return {
    recipient, by: key ? 'recovery key' : 'passphrase',
    decrypt(stream) { const decrypter = new Decrypter(); decrypter.addIdentity(identity); return decrypter.decrypt(stream); },
  };
}

// The whole vault forgotten: every file in its store, and every earlier copy. It cannot be brought back.
export async function forgetVault(store) { await store.clear(); }

function unlocked(store, info, identity, now) {
  let key = identity, tagKey = null, queue = Promise.resolve();
  const inTurn = work => (...args) => { const run = queue.then(() => work(...args)); queue = run.catch(() => {}); return run; };
  const held = () => { if (!key) throw fault('ELOCKED', 'The vault is locked.'); return key; };
  const stamp = () => localTime(now());
  const subtle = globalThis.crypto.subtle;
  // The tag key, made from the vault key (HKDF), never kept anywhere: only the unlocked vault can tag a record.
  const tagging = async () => {
    if (tagKey) return tagKey;
    const base = await subtle.importKey('raw', encoder.encode(held()), 'HKDF', false, ['deriveKey']);
    tagKey = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoder.encode('form-filler vault record v1') }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
    return tagKey;
  };
  const signed = (name, record) => encoder.encode(name + '\n' + JSON.stringify(record));
  // Before anything is written: the store must still hold this vault (not one forgotten, or made again in another tab).
  const guard = async () => {
    let now = null;
    try { now = await vaultInfo(store); } catch { now = null; }
    if (!now || now.recipient !== info.recipient) { key = null; tagKey = null; throw fault('ECHANGED', 'The vault was forgotten or made again elsewhere (another tab or window): unlock it again.'); }
  };
  const write = async (name, fields, options) => {
    const record = { formFiller: 'vault-record', version: 1, ...fields, saved: stamp() };
    const tag = hex(await subtle.sign('HMAC', await tagging(), signed(name, record)));
    await store.put(name, await sealTo(info.recipient, json({ ...record, tag })), options);
    return record;
  };
  const open = async (name, what, kind) => {
    const sealed = await store.get(name);
    if (!sealed) return null;
    held();
    if (kind === 'record' && sealed.length > RECORD_LIMIT) throw fault('EFOREIGN', what + ' (' + name + ') is too large to be a file this vault wrote.');
    checkHeader(sealed, kind, what + ' (' + name + ')');
    try { const decrypter = new Decrypter(); decrypter.addIdentity(held()); return await decrypter.decrypt(sealed); }
    catch { throw fault('EFOREIGN', what + ' (' + name + ') does not open with this vault\'s key: it is damaged, or from another vault.'); }
  };
  // A record read back must be tagged by this vault, for this name, and say it is the one asked for.
  const read = async (name, kind, id, what) => {
    const bytes = await open(name, what, 'record');
    if (!bytes) return null;
    let data;
    try { data = JSON.parse(decoder.decode(bytes)); } catch { data = null; }
    const { tag, ...record } = data || {};
    const tagged = typeof tag === 'string' && HEX64.test(tag) && await subtle.verify('HMAC', await tagging(), Uint8Array.from(tag.match(/../g), pair => parseInt(pair, 16)), signed(name, record));
    if (!tagged || record.formFiller !== 'vault-record' || record.version !== 1 || record.kind !== kind || record.id !== id)
      throw fault('EFOREIGN', what + ' (' + name + ') is not what this vault wrote there: it was put there by something else, or in another file\'s place.');
    return record;
  };
  const documents = async () => {
    const index = await read(LOCKER, 'locker-index', 'locker', 'The locker\'s list');
    if (!index) return [];
    if (!Array.isArray(index.documents) || index.documents.some(entry => !entry || typeof entry.id !== 'string' || !HEX64.test(entry.sha256 || '') || !Number.isInteger(entry.bytes))) throw fault('EFOREIGN', 'The locker\'s list is not readable.');
    return index.documents;
  };
  // The records' list. Every entry is carried through, including one whose kind this build does not know: a newer
  // vault opened in an older build must not lose a record because the older build could not use it. That is why
  // nothing here filters by kind — see docs/VAULT_RECORDS.md.
  const recordList = async () => {
    const index = await read(RECORDS, 'records-index', 'records', 'The records\' list');
    if (!index) return [];
    if (!Array.isArray(index.records) || index.records.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.kind !== 'string'))
      throw fault('EFOREIGN', 'The records\' list is not readable.');
    return index.records;
  };
  const oneRecord = async id => {
    const entry = (await recordList()).find(item => item.id === id);
    if (!entry) return null;
    const data = await read('records/' + id + '.age', 'record', id, 'The record "' + entry.title + '"');
    if (!data) throw new Error('The record "' + entry.title + '" is missing from the vault.');
    return { id, kind: data.recordKind || entry.kind, title: data.title, fields: cleanRecordFields(data.fields), documents: [...(data.documents || [])], confirmed: data.confirmed || null, added: data.added || null, changed: data.changed || null, saved: data.saved };
  };

  const profile = async () => {
    const data = await read(PROFILE, 'profile', 'profile', 'Your details');
    return data ? { details: cleanDetails(data.details), signature: cleanSignature(data.signature), saved: data.saved || null } : { details: {}, signature: null, saved: null };
  };
  return {
    info, recipient: info.recipient,
    get open() { return Boolean(key); },
    // Your details and saved signature: { details, signature, saved }; empty until something is saved.
    readProfile: inTurn(profile),
    // A change to your details or your signature, or both: what is not given stays as the vault has it now (another
    // tab may have saved since), and no earlier copy is kept. Returns what is now kept.
    writeProfile: inTurn(async (change = {}) => {
      held();
      await guard();
      if ('signature' in change && change.signature !== null && !cleanSignature(change.signature)) throw new Error('A saved signature is a PNG picture.');
      const current = await profile().catch(error => { if (error.code === 'EFOREIGN') return { details: {}, signature: null }; throw error; });
      const next = { details: 'details' in change ? cleanDetails(change.details) : current.details, signature: 'signature' in change ? change.signature : current.signature };
      const record = await write(PROFILE, { kind: 'profile', id: 'profile', ...next }, { prev: false });
      return { ...next, saved: record.saved };
    }),
    listDocuments: inTurn(documents),
    // A document into the locker: its exact bytes in a file of its own, and its title, kind, name, size and SHA-256 in
    // the locker's list.
    addDocument: inTurn(async ({ title, kind = 'document', name = '', bytes } = {}) => {
      held();
      if (typeof title !== 'string' || !title.trim()) throw new Error('A locker document needs a title.');
      if (!(bytes instanceof Uint8Array)) throw new Error('A locker document needs its bytes.');
      await guard();
      const entry = { id: newId(), title: title.trim(), kind: String(kind), name: String(name), added: stamp(), bytes: bytes.length, sha256: await sha256(bytes) };
      const listed = await documents();
      await store.put('locker/' + entry.id + '.age', await sealTo(info.recipient, bytes));
      await write(LOCKER, { kind: 'locker-index', id: 'locker', documents: [...listed, entry] });
      return entry;
    }),
    // A document's exact bytes, checked against its size and SHA-256 in the locker's list.
    readDocument: inTurn(async id => {
      const entry = (await documents()).find(item => item.id === id);
      if (!entry) throw new Error('There is no document ' + id + ' in the locker.');
      const bytes = await open('locker/' + id + '.age', 'The document "' + entry.title + '"', 'document');
      if (!bytes) throw new Error('The document "' + entry.title + '" is missing from the locker.');
      if (bytes.length !== entry.bytes || await sha256(bytes) !== entry.sha256) throw fault('EFOREIGN', 'The document "' + entry.title + '" is not the one put in the locker: it is damaged, or another was put in its place.');
      return bytes;
    }),
    // Every record's id, kind and title, in the order they were put in. A kind this build does not know is listed
    // like any other: it belongs to somebody.
    listRecords: inTurn(recordList),
    // One record, whole: its fields, the documents that prove it, and when it was last confirmed. null if there is
    // no such record.
    readRecord: inTurn(oneRecord),
    // A record put in, or one already there written again. Writing needs a kind this build knows, though reading and
    // listing do not: a build should not invent a kind it has no fields for. `added` and `confirmed` survive a
    // rewrite, because editing a record is not the same as confirming it.
    putRecord: inTurn(async ({ id = null, kind, title, fields = {}, documents: proof = [] } = {}) => {
      held();
      if (!isKnownKind(kind)) throw new Error('There is no record kind "' + kind + '" in this build.');
      if (typeof title !== 'string' || !title.trim()) throw new Error('A record needs a title.');
      if (!Array.isArray(proof) || proof.some(item => typeof item !== 'string')) throw new Error('A record\'s documents are a list of locker ids.');
      await guard();
      const inLocker = new Set((await documents()).map(item => item.id));
      for (const one of proof) if (!inLocker.has(one)) throw new Error('There is no document ' + one + ' in the locker.');
      const listed = await recordList();
      const was = id ? listed.find(item => item.id === id) : null;
      if (id && !was) throw new Error('There is no record ' + id + ' in this vault.');
      const older = was ? await oneRecord(id) : null;
      const now = { id: id || newId(), kind, title: title.trim(), fields: cleanRecordFields(fields), documents: [...proof],
        confirmed: older ? older.confirmed : null, added: older ? older.added : stamp(), changed: stamp() };
      const written = await write('records/' + now.id + '.age', { kind: 'record', id: now.id, recordKind: kind, title: now.title, fields: now.fields, documents: now.documents, confirmed: now.confirmed, added: now.added, changed: now.changed });
      const entry = { id: now.id, kind, title: now.title };
      await write(RECORDS, { kind: 'records-index', id: 'records', records: was ? listed.map(item => (item.id === id ? entry : item)) : [...listed, entry] });
      // The same shape readRecord gives back, `saved` and all, so that what a write returns and what a read returns
      // can be compared without knowing which made it.
      return { ...now, saved: written.saved };
    }),
    // Somebody looked and said this is still right. Only this sets `confirmed`; editing a record does not.
    confirmRecord: inTurn(async id => {
      held();
      await guard();
      const record = await oneRecord(id);
      if (!record) throw new Error('There is no record ' + id + ' in this vault.');
      const now = { ...record, confirmed: stamp() };
      const written = await write('records/' + id + '.age', { kind: 'record', id, recordKind: record.kind, title: record.title, fields: record.fields, documents: record.documents, confirmed: now.confirmed, added: record.added, changed: record.changed });
      return { ...now, saved: written.saved };
    }),
    // A record taken out. Its documents stay in the locker: a record is a set of fields, a document is a thing you
    // were given, and throwing away the first should not throw away the second.
    removeRecord: inTurn(async id => {
      held();
      await guard();
      const listed = await recordList();
      if (!listed.some(item => item.id === id)) throw new Error('There is no record ' + id + ' in this vault.');
      await write(RECORDS, { kind: 'records-index', id: 'records', records: listed.filter(item => item.id !== id) });
      await store.remove('records/' + id + '.age');
      return true;
    }),
    // Which records point at a locker document: what would lose its proof if that document were taken out.
    recordsUsing: inTurn(async documentId => {
      const out = [];
      for (const entry of await recordList()) {
        const record = await oneRecord(entry.id);
        if (record && record.documents.includes(documentId)) out.push({ id: record.id, kind: record.kind, title: record.title });
      }
      return out;
    }),
    // A new passphrase: the key locked again with it, and no copy of the key file kept that the old one opens. (A copy
    // kept elsewhere, such as in a backup, still does: see the note at the top.)
    changePassphrase: inTurn(async (passphrase, { workFactor } = {}) => {
      checkPassphrase(passphrase);
      held();
      await guard();
      await store.put(KEY, await sealWith(passphrase, keyFile(held(), info.recipient, info.made), workFactor), { prev: false });
    }),
    // The key forgotten: nothing more is read or written until the vault is unlocked again.
    lock() { key = null; tagKey = null; },
  };
}
