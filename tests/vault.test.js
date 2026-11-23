import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Decrypter, Encrypter } from 'age-encryption';
import { createVault, unlockVault, unlockKey, forgetVault, vaultInfo, checkPassphrase, cleanDetails, MIN_PASSPHRASE } from '../src/lib/vault.js';
import { memoryStore } from '../src/lib/stores/memory.js';
import { nodeStore } from '../src/lib/stores/node.js';
import { tauriStore } from '../src/app/store-tauri.js';
import { tauriStandIn } from './tauri-stand-in.js';
import { MIN_PASSPHRASE as PAGE_MIN } from '../src/app/keep.js';

// The vault, with invented details and documents only. scrypt runs at a low work factor here so the tests are quick;
// the page and the app use age's own.
const FAST = { workFactor: 10 };
const scratch = mkdtempSync(join(tmpdir(), 'ff-vault-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const bytes = text => new TextEncoder().encode(text);
const text = data => new TextDecoder().decode(data);
const AGE = 'age-encryption.org/v1';
const STORES = {
  'in memory': () => memoryStore(),
  'in a folder': () => nodeStore(join(mkdtempSync(join(scratch, 'store-')), 'vault')),
  // The Mac app's own store (src/app/store-tauri.js), over a stand-in for the app (tests/tauri-stand-in.js).
  'in the Mac app\'s folder': () => { const folder = mkdtempSync(join(scratch, 'store-')); return tauriStore(tauriStandIn({ granted: [folder] }), join(folder, 'vault')); },
};
const DETAILS = { fullName: 'Jane Roe', email: 'jane@example.org', phone: '555-0100' };
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';
const passphrase = 'invented horse battery staple';
const sealTo = async (recipient, data) => { const encrypter = new Encrypter(); encrypter.addRecipient(recipient); return encrypter.encrypt(data); };

test('the app\'s lazy vault store forwards every call a store has', () => {
  // platform.js wraps the real store and forwards its calls one by one, by name. When remove() joined the store
  // interface the wrapper was not grown with it, so taking a record out failed inside the Mac app with "remove is
  // not a function" while every test here passed: these drive the stores directly and never go through it
  // (2026-11-23). This keeps the two in step, so the next call added to the interface cannot be forgotten there.
  const calls = Object.keys(memoryStore()).filter(name => name !== 'dump');   // dump() is the tests' own
  assert.ok(calls.length >= 5, 'a store has at least get, put, remove, list and clear: ' + calls.join(', '));
  const source = readFileSync(new URL('../src/app/platform.js', import.meta.url), 'utf8');
  const from = source.indexOf('export function vaultStore');
  assert.ok(from >= 0, 'vaultStore() is still in platform.js');
  const body = source.slice(from, source.indexOf('\n}', from));
  for (const name of calls) assert.match(body, new RegExp(name + ":\\s*through\\('" + name + "'\\)"), 'vaultStore() forwards ' + name + '()');
});

for (const [where, make] of Object.entries(STORES)) {
  test('every store takes a file away, with the copy kept of it, and says nothing of one that was never there (' + where + ')', async () => {
    // remove() is what lets a record be taken out of the vault (src/lib/vault.js, removeRecord). Every store has to
    // have it, and each has its own way of deleting, so each is asked here rather than only the one in memory.
    const store = make();
    await store.put('one.age', new Uint8Array([1, 2, 3]));
    await store.put('one.age', new Uint8Array([4, 5, 6]));          // now there is a kept copy beside it
    await store.put('under/two.age', new Uint8Array([7]));
    assert.deepEqual((await store.list()).filter(name => name.endsWith('.age')).sort(), ['one.age', 'under/two.age']);
    assert.ok(await store.get('one.age.prev'), 'the copy before is there to begin with');
    await store.remove('one.age');
    assert.equal(await store.get('one.age'), null, 'the file is gone');
    assert.equal(await store.get('one.age.prev'), null, 'and so is the copy kept of it');
    assert.deepEqual((await store.list()).filter(name => name.endsWith('.age')), ['under/two.age'], 'and nothing else went with it');
    await store.remove('never-there.age');                           // says nothing, as removing nothing should
    await store.remove('under/two.age');
    assert.equal(await store.get('under/two.age'), null, 'one inside a folder goes too');
    // A name the vault would never write is refused rather than acted on, as it is for get and put.
    if (where !== 'in memory') await assert.rejects(store.remove('not a name.age'), /Not a name in the vault/);
  });

  test('a new vault: its key locked with the passphrase, its recovery key given once, your details locked to the key (' + where + ')', async () => {
    const store = make();
    const { vault, recoveryKey } = await createVault(store, passphrase, FAST);
    assert.match(recoveryKey, /^AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}$/);
    const info = await vaultInfo(store);
    assert.deepEqual(Object.keys(info), ['formFiller', 'version', 'made', 'recipient']);
    assert.match(info.recipient, /^age1[0-9a-z]{58}$/);
    await vault.writeProfile({ details: { ...DETAILS, odd: ['not', 'text'] }, signature: SIGNATURE });
    const profile = await vault.readProfile();
    assert.deepEqual(profile.details, DETAILS, 'only words are kept as details');
    assert.equal(profile.signature, SIGNATURE);
    assert.deepEqual(await store.list(), ['identity.age', 'profile.age', 'vault.json']);
    for (const name of ['identity.age', 'profile.age']) {
      const data = text(await store.get(name));
      assert.ok(data.startsWith(AGE), name + ' is an age file');
      assert.ok(!data.includes('Jane') && !data.includes('example.org') && !data.includes('AGE-SECRET-KEY'), name + ' holds nothing in plain text');
    }
    assert.ok(!text(await store.get('vault.json')).includes('Jane'), 'vault.json holds nothing secret');
  });

  test('unlocking: the passphrase, or the recovery key however it is typed; a wrong one is refused (' + where + ')', async () => {
    const store = make();
    const { vault, recoveryKey } = await createVault(store, passphrase, FAST);
    await vault.writeProfile({ details: DETAILS });
    vault.lock();
    await assert.rejects(vault.readProfile(), /The vault is locked/);
    await assert.rejects(unlockVault(store, 'not the passphrase'), { code: 'EPASSPHRASE', message: 'That passphrase does not open this vault.' });
    assert.deepEqual((await (await unlockVault(store, passphrase)).readProfile()).details, DETAILS);
    const typed = recoveryKey.toLowerCase().replace(/(.{6})/g, '$1 ').replace(/ (.{12})/, '\n$1');
    assert.deepEqual((await (await unlockVault(store, typed)).readProfile()).details, DETAILS, 'lower case, spaces and a line break are all fine');
    const other = (await createVault(memoryStore(), passphrase, FAST)).recoveryKey;
    await assert.rejects(unlockVault(store, other), { code: 'EPASSPHRASE', message: /That recovery key does not open this vault/ });
    await assert.rejects(unlockVault(store, recoveryKey.slice(0, -1) + (recoveryKey.endsWith('Q') ? 'P' : 'Q')), { code: 'EPASSPHRASE', message: /recovery key/ }, 'a mistyped letter is caught');
    await assert.rejects(unlockVault(store, recoveryKey.slice(0, 40)), { code: 'EPASSPHRASE', message: /not whole/ });
  });

  test('a new passphrase rewrites only the key, keeps no copy of it, and the recovery key still works (' + where + ')', async () => {
    const store = make();
    const { vault, recoveryKey } = await createVault(store, passphrase, FAST);
    await vault.writeProfile({ details: DETAILS });
    const profileBefore = await store.get('profile.age');
    await vault.changePassphrase('a different invented passphrase', FAST);
    await assert.rejects(unlockVault(store, passphrase), { code: 'EPASSPHRASE' });
    assert.deepEqual((await (await unlockVault(store, 'a different invented passphrase')).readProfile()).details, DETAILS);
    assert.deepEqual((await (await unlockVault(store, recoveryKey)).readProfile()).details, DETAILS);
    assert.deepEqual(await store.get('profile.age'), profileBefore, 'nothing else was rewritten');
    assert.equal(await store.get('identity.age.prev'), null, 'no earlier key file kept');
    await assert.rejects(vault.changePassphrase('short'), { code: 'EWEAK' });
  });

  test('saving one part of your details leaves the other as the vault has it, and keeps no earlier copy (' + where + ')', async () => {
    const store = make();
    const { vault } = await createVault(store, passphrase, FAST);
    await vault.writeProfile({ details: DETAILS, signature: SIGNATURE });
    assert.deepEqual((await vault.writeProfile({ details: { fullName: 'Jane Q. Roe' } })).signature, SIGNATURE, 'details saved: the signature stays');
    assert.deepEqual((await vault.writeProfile({ signature: null })).details, { fullName: 'Jane Q. Roe' }, 'the signature forgotten: the details stay');
    assert.equal(await store.get('profile.age.prev'), null, 'no earlier copy, so a forgotten signature is gone from the store');
    await assert.rejects(vault.writeProfile({ signature: 'data:text/html,<script>' }), /A saved signature is a PNG picture/);
    await forgetVault(store);
    assert.equal(await vaultInfo(store), null);
    assert.deepEqual(await store.list(), []);
  });

  test('the locker: each document\'s exact bytes in a file of its own, checked against the list when read (' + where + ')', async () => {
    const store = make();
    const { vault } = await createVault(store, passphrase, FAST);
    const card = await vault.addDocument({ title: 'Invented ID card', kind: 'id', name: 'card.pdf', bytes: bytes('%PDF- not a real card') });
    const letter = await vault.addDocument({ title: 'Invented letter', name: 'letter.txt', bytes: bytes('not a real letter') });
    assert.deepEqual((await vault.listDocuments()).map(entry => [entry.title, entry.kind, entry.name, entry.bytes]), [['Invented ID card', 'id', 'card.pdf', 21], ['Invented letter', 'document', 'letter.txt', 17]]);
    assert.equal(text(await vault.readDocument(card.id)), '%PDF- not a real card');
    assert.deepEqual(await store.list('locker/'), ['locker/' + card.id + '.age', 'locker/' + letter.id + '.age', 'locker/index.age'].sort());
    await assert.rejects(vault.readDocument('no-such-id'), /There is no document/);
    await assert.rejects(vault.addDocument({ title: ' ', bytes: bytes('x') }), /needs a title/);
  });

  test('a damaged, swapped or forged file is refused, not used (' + where + ')', async () => {
    const store = make();
    const { vault, recoveryKey } = await createVault(store, passphrase, FAST);
    await vault.writeProfile({ details: DETAILS });
    const card = await vault.addDocument({ title: 'Invented ID card', bytes: bytes('card one') });
    const other = await vault.addDocument({ title: 'Invented other card', bytes: bytes('card two') });
    // One document's file put in another's place, of the same size: it opens, but it is not the one listed.
    await store.put('locker/' + card.id + '.age', await store.get('locker/' + other.id + '.age'));
    await assert.rejects(vault.readDocument(card.id), { code: 'EFOREIGN', message: /is not the one put in the locker/ });
    // A damaged file does not open.
    const damaged = await store.get('locker/' + other.id + '.age'); damaged[damaged.length - 5] ^= 1;
    await store.put('locker/' + other.id + '.age', damaged);
    await assert.rejects(vault.readDocument(other.id), /does not open with this vault's key: it is damaged, or from another vault/);
    // One record put in another's place: the locker's list where the details should be.
    await store.put('profile.age', await store.get('locker/index.age'));
    await assert.rejects(vault.readProfile(), { code: 'EFOREIGN', message: /Your details \(profile.age\) is not what this vault wrote there/ });
    // A record forged by someone who can write the store: sealed to the vault's public half, as vault.json shows it,
    // saying all the right things, but without the tag only the vault key can make.
    const forged = { formFiller: 'vault-record', version: 1, kind: 'profile', id: 'profile', details: { fullName: 'Jane Roe', email: 'someone.else@example.net' }, signature: null, saved: '2026-11-20T10:00:00-05:00' };
    await store.put('profile.age', await sealTo((await vaultInfo(store)).recipient, bytes(JSON.stringify(forged))));
    await assert.rejects(vault.readProfile(), { code: 'EFOREIGN', message: /is not what this vault wrote there/ });
    await store.put('profile.age', await sealTo((await vaultInfo(store)).recipient, bytes(JSON.stringify({ ...forged, tag: 'a'.repeat(64) }))));
    await assert.rejects(vault.readProfile(), { code: 'EFOREIGN' }, 'nor with a tag made up');
    // A file from another vault.
    const strange = memoryStore(), elsewhere = (await createVault(strange, passphrase, FAST)).vault;
    await elsewhere.writeProfile({ details: { fullName: 'Someone Else' } });
    await store.put('profile.age', await strange.get('profile.age'));
    await assert.rejects(vault.readProfile(), /from another vault/);
    // And the key file from another vault.
    await store.put('identity.age', await strange.get('identity.age'), { prev: false });
    await assert.rejects(unlockVault(store, passphrase), /identity.age does not match vault.json/);
    assert.ok(await unlockVault(store, recoveryKey), 'the recovery key still opens it');
  });

  test('a vault forgotten and made again under an open copy: the copy is refused the moment it writes (' + where + ')', async () => {
    const store = make();
    const { vault: old } = await createVault(store, passphrase, FAST);
    await forgetVault(store);
    const { vault: fresh } = await createVault(store, 'a new invented passphrase', FAST);
    await fresh.writeProfile({ details: { fullName: 'New' } });
    await assert.rejects(old.writeProfile({ details: { fullName: 'Old' } }), { code: 'ECHANGED' });
    await assert.rejects(old.readProfile(), { code: 'ELOCKED' }, 'and is locked');
    assert.deepEqual((await (await unlockVault(store, 'a new invented passphrase')).readProfile()).details, { fullName: 'New' });
  });
}

test('the files are plain age: the age library alone opens the key with the passphrase, and the rest with the key', async () => {
  const store = memoryStore();
  const { vault } = await createVault(store, passphrase, FAST);
  await vault.writeProfile({ details: DETAILS });
  const card = await vault.addDocument({ title: 'Invented ID card', bytes: bytes('%PDF- not a real card') });
  const withPassphrase = new Decrypter(); withPassphrase.addPassphrase(passphrase);
  const keyFile = await withPassphrase.decrypt(await store.get('identity.age'), 'text');
  assert.match(keyFile, /^# Form Filler vault key, made \d{4}-\d{2}-\d{2}T[\d:]+[+-]\d{2}:\d{2}\n# public key: age1[0-9a-z]{58}\nAGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}\n$/, 'as age-keygen writes a key file');
  const withKey = new Decrypter(); withKey.addIdentity(keyFile.trim().split('\n').pop());
  const profile = JSON.parse(await withKey.decrypt(await store.get('profile.age'), 'text'));
  assert.deepEqual([profile.formFiller, profile.kind, profile.id, profile.details], ['vault-record', 'profile', 'profile', DETAILS]);
  assert.match(profile.tag, /^[0-9a-f]{64}$/);
  assert.equal(text(await withKey.decrypt(await store.get('locker/' + card.id + '.age'))), '%PDF- not a real card', 'a document opens to its exact bytes');
});

test('a planted file cannot keep unlock busy: a key file asking for a huge work factor, or not one this vault writes, is refused at once', async () => {
  const store = memoryStore();
  await createVault(store, passphrase, FAST);
  const slow = new Encrypter(); slow.setPassphrase(passphrase); slow.setScryptWorkFactor(22);
  const header = encrypter => encrypter;
  header(slow);
  // Only the header matters; the body need not be the key (the work factor is refused before anything is tried).
  const sealed = text(await (() => { const quick = new Encrypter(); quick.setPassphrase(passphrase); quick.setScryptWorkFactor(10); return quick.encrypt(bytes('x')); })());
  const planted = sealed.replace(/^(-> scrypt \S+) 10$/m, '$1 30');
  await store.put('identity.age', bytes(planted), { prev: false });
  const started = Date.now();
  await assert.rejects(unlockVault(store, passphrase), { code: 'EFOREIGN', message: /not a file this vault wrote/ });
  assert.ok(Date.now() - started < 1000, 'refused before any scrypt runs');
  const twoStanzas = sealed.replace(/^(-> scrypt .*)$/m, '$1\n-> X25519 AAAA\nAAAA');
  await store.put('identity.age', bytes(twoStanzas), { prev: false });
  await assert.rejects(unlockVault(store, passphrase), { code: 'EFOREIGN' });
});

test('unlockKey: the vault key on its own, from a copy of identity.age and the passphrase, or from the recovery key typed any way', async () => {
  const store = memoryStore();
  const { recoveryKey } = await createVault(store, passphrase, FAST);
  const info = await vaultInfo(store), sealed = await store.get('identity.age');
  const message = bytes('an invented snapshot, sealed to the vault\'s public half');
  const streamOf = data => new ReadableStream({ start(controller) { controller.enqueue(data); controller.close(); } });
  const opened = async (key, data) => new Uint8Array(await new Response(await key.decrypt(streamOf(data))).arrayBuffer());
  const snapshot = await sealTo(info.recipient, message);
  const grouped = recoveryKey.slice(0, 16) + ' ' + recoveryKey.slice(16).match(/.{1,6}/g).join(' ');
  for (const [secret, file, by] of [[passphrase, sealed, 'passphrase'], [recoveryKey, null, 'recovery key'], [grouped.toLowerCase(), sealed, 'recovery key']]) {
    const key = await unlockKey(file, secret);
    assert.equal(key.recipient, info.recipient);
    assert.equal(key.by, by);
    assert.deepEqual(await opened(key, snapshot), message, 'its decrypt opens a stream sealed to the vault\'s public half');
    assert.deepEqual(Object.keys(key).sort(), ['by', 'decrypt', 'recipient'], 'the key itself is not handed out');
  }
  await assert.rejects(unlockKey(sealed, 'not the passphrase'), { code: 'EPASSPHRASE', message: 'That passphrase does not open this key file.' });
  await assert.rejects(unlockKey(sealed, recoveryKey.slice(0, 40)), { code: 'EPASSPHRASE', message: 'That recovery key is not whole: check it letter by letter.' });
  await assert.rejects(unlockKey(null, recoveryKey.slice(0, -1) + (recoveryKey.endsWith('Q') ? 'P' : 'Q')), { code: 'EPASSPHRASE', message: /not whole/ }, 'a mistyped letter is caught');
  await assert.rejects(unlockKey(null, passphrase), { code: 'ENOKEY', message: 'There is no key file (identity.age) here; only the recovery key opens this.' });
  // A well-formed key from another vault opens nothing sealed to this one.
  const other = await unlockKey(null, (await createVault(memoryStore(), passphrase, FAST)).recoveryKey);
  await assert.rejects(opened(other, snapshot), /no identity matched any of the file's recipients/);
  // A key file sealed with the right passphrase but holding two keys, or none, is not one this vault wrote.
  const two = new Encrypter(); two.setPassphrase(passphrase); two.setScryptWorkFactor(10);
  await assert.rejects(unlockKey(await two.encrypt('# public key: ' + info.recipient + '\n' + recoveryKey + '\n' + recoveryKey + '\n'), passphrase), { code: 'EFOREIGN', message: /does not hold one key/ });
  await assert.rejects(unlockKey(await two.encrypt('# no key in here\n'), passphrase), { code: 'EFOREIGN' });
  // And a planted one asking for a huge work factor is refused before any scrypt runs.
  const planted = text(sealed).replace(/^(-> scrypt \S+) 10$/m, '$1 30');
  const started = Date.now();
  await assert.rejects(unlockKey(bytes(planted), passphrase), { code: 'EFOREIGN', message: /not a file this vault wrote/ });
  assert.ok(Date.now() - started < 1000, 'refused before any scrypt runs');
});

test('vault.json is read strictly: a "made" that is not a time is refused, and nothing but its four fields is kept', async () => {
  const store = memoryStore();
  await createVault(store, passphrase, FAST);
  const info = JSON.parse(text(await store.get('vault.json')));
  await store.put('vault.json', bytes(JSON.stringify({ ...info, extra: 'planted' })), { prev: false });
  assert.deepEqual(Object.keys(await vaultInfo(store)), ['formFiller', 'version', 'made', 'recipient']);
  await store.put('vault.json', bytes(JSON.stringify({ ...info, made: info.made + '\nAGE-SECRET-KEY-1' + 'Q'.repeat(58) })), { prev: false });
  await assert.rejects(vaultInfo(store), /vault.json is not readable/);
});

test('a passphrase is refused if it is too short, and the page says the same length the vault does', async () => {
  assert.equal(PAGE_MIN, MIN_PASSPHRASE);
  for (const weak of ['', 'short', '        ', null, 12345678]) assert.throws(() => checkPassphrase(weak), { code: 'EWEAK' }, String(weak));
  assert.equal(checkPassphrase('eight ch'), 'eight ch');
  await assert.rejects(createVault(memoryStore(), 'short', FAST), { code: 'EWEAK' });
  const store = memoryStore();
  await createVault(store, passphrase, FAST);
  await assert.rejects(createVault(store, passphrase, FAST), /There is already a vault here/);
  await assert.rejects(unlockVault(memoryStore(), passphrase), /There is no vault here/);
  assert.deepEqual(cleanDetails(['a']), {});
});

test('a vault made where a half-made one left files clears them first', async () => {
  const store = memoryStore();
  await store.put('profile.age', bytes('left by a stop'));
  await store.put('locker/old.age', bytes('left too'));
  const { vault } = await createVault(store, passphrase, FAST);
  assert.deepEqual(await store.list(), ['identity.age', 'vault.json']);
  assert.deepEqual((await vault.readProfile()).details, {});
});

test('the folder store writes each file whole, keeps the copy before when asked, and clears only the vault\'s own files', async () => {
  const folder = join(mkdtempSync(join(scratch, 'node-')), 'vault'), store = nodeStore(folder);
  await store.put('locker/a.age', bytes('one'));
  await store.put('locker/a.age', bytes('two'));
  await store.put('vault.json', bytes('{}'), { prev: false });
  assert.equal(text(await store.get('locker/a.age')), 'two');
  assert.equal(text(await store.get('locker/a.age.prev')), 'one');
  assert.deepEqual(await store.list(), ['locker/a.age', 'vault.json']);
  assert.deepEqual(readdirSync(join(folder, 'locker')).sort(), ['a.age', 'a.age.prev'], 'no half-written file left beside them');
  assert.equal(await store.get('missing.age'), null);
  for (const bad of ['../outside', '/etc/hosts', '.hidden', 'a//b', '']) await assert.rejects(store.put(bad, bytes('x')), /Not a name in the vault/, bad);
  mkdirSync(join(folder, 'in the way.age'));
  await assert.rejects(store.put('in the way.age', bytes('x')).catch(error => { throw error; }), /Not a name in the vault/);
  mkdirSync(join(folder, 'profile.age'));
  await assert.rejects(store.put('profile.age', bytes('x'), { prev: false }));
  assert.deepEqual(readdirSync(folder).filter(name => name.endsWith('.tmp')), [], 'a write that failed leaves no half-written file');
  writeFileSync(join(folder, 'my notes.txt'), 'not the vault\'s');
  await store.clear();
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(readdirSync(folder).sort(), ['in the way.age', 'my notes.txt'], 'what the vault could not have written is left where it was');
});
