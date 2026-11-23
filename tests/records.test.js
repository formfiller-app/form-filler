import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from '../src/lib/vault.js';
import { memoryStore } from '../src/lib/stores/memory.js';
import { KIND_NAMES, RECORD_KINDS, cleanRecordFields, fieldsOf, isKnownKind, labelOf, sensitivity, shareOf, shownValue } from '../src/lib/record-kinds.js';

// The vault's records: what each field gives away, and the rules in docs/VAULT_RECORDS.md. Everything here is
// invented, nothing is sent anywhere, and scrypt runs at a low work factor so the tests are quick.

const FAST = { workFactor: 10 };
const PASSPHRASE = 'invented horse battery staple';
const bytes = text => new TextEncoder().encode(text);
const LICENCE = {
  kind: 'credential', title: 'Invented nursing licence',
  fields: { number: 'INV-44821', body: 'Invented Board of Nursing', kind: 'Registered nurse', issued: '02/30/2021', expires: '02/30/2029', status: 'Active' },
};
const opened = async () => {
  const { vault } = await createVault(memoryStore(), PASSPHRASE, FAST);
  const scan = await vault.addDocument({ title: 'A scan of the invented licence', kind: 'scan', name: 'licence.png', bytes: bytes('not a real scan') });
  return { vault, scan };
};

test('every kind declares what each of its fields gives away', () => {
  assert.deepEqual(KIND_NAMES, ['identity', 'bank', 'employment', 'credential']);
  for (const [kind, shape] of Object.entries(RECORD_KINDS)) {
    assert.ok(shape.title && shape.about, kind + ' says what it is');
    assert.ok(shape.fields.length >= 5, kind + ' asks for something worth keeping');
    for (const [name, label, gives] of shape.fields) {
      assert.ok(name && label, kind + '.' + name + ' has a name and a label');
      assert.ok(gives === 'shown' || gives === 'hidden', kind + '.' + name + ' declares shown or hidden, not ' + gives);
    }
  }
  // The ones worth being sure of by hand, rather than by the loop above.
  assert.equal(sensitivity('credential', 'number'), 'hidden');
  assert.equal(sensitivity('credential', 'expires'), 'shown');
  assert.equal(sensitivity('bank', 'account'), 'hidden');
  assert.equal(sensitivity('bank', 'institution'), 'shown');
  assert.equal(sensitivity('employment', 'supervisor'), 'hidden', 'somebody else\'s name is still somebody\'s');
  assert.equal(sensitivity('employment', 'employer'), 'shown');
});

test('a field nobody declared is hidden, not shown', () => {
  // The whole reason the default is what it is: a field added in haste must fail towards privacy.
  assert.equal(sensitivity('credential', 'somethingNobodyThoughtOf'), 'hidden');
  assert.equal(sensitivity('credential', ''), 'hidden');
  assert.equal(sensitivity('a kind that does not exist', 'number'), 'hidden');
  // masked() shows the last four only above eight characters, and two at eight: a short value is never mostly given away.
  assert.match(shownValue('credential', 'somethingNobodyThoughtOf', 'ABC123456'), /^•+3456$/);
  assert.match(shownValue('credential', 'somethingNobodyThoughtOf', 'ABC12345'), /^•+45$/);
  assert.equal(shownValue('credential', 'body', 'Invented Board of Nursing'), 'Invented Board of Nursing');
  assert.equal(labelOf('credential', 'somethingNobodyThoughtOf'), 'somethingNobodyThoughtOf', 'with no label of its own, it goes by its name');
  assert.deepEqual(fieldsOf('a kind that does not exist'), []);
});

test('a record keeps only strings, and keeps a name this build does not know', () => {
  const kept = cleanRecordFields({ number: 'INV-1', count: 7, nested: { a: 1 }, nothing: null, newish: 'from a later build' });
  assert.deepEqual(kept, { number: 'INV-1', newish: 'from a later build' });
});

test('a licence goes in whole: its fields, the scan that proves it, and nothing confirmed yet', async () => {
  const { vault, scan } = await opened();
  const put = await vault.putRecord({ ...LICENCE, documents: [scan.id] });
  assert.ok(put.id, 'it is given an id');
  assert.equal(put.confirmed, null, 'nobody has said it is still right');
  assert.ok(put.added && put.changed, 'when it arrived and when it last changed');
  assert.deepEqual(put.documents, [scan.id]);
  assert.deepEqual(await vault.listRecords(), [{ id: put.id, kind: 'credential', title: 'Invented nursing licence' }]);
  assert.deepEqual(await vault.readRecord(put.id), put);
  assert.equal(await vault.readRecord('no such record'), null);
});

test('confirming means somebody looked; editing does not', async () => {
  const { vault, scan } = await opened();
  const put = await vault.putRecord({ ...LICENCE, documents: [scan.id] });
  const edited = await vault.putRecord({ id: put.id, ...LICENCE, title: 'Invented nursing licence (renewed)', documents: [scan.id] });
  assert.equal(edited.confirmed, null, 'editing it did not confirm it');
  assert.equal(edited.added, put.added, 'and it is still the record that arrived then');
  const said = await vault.confirmRecord(put.id);
  assert.ok(said.confirmed, 'saying it is still right does confirm it');
  assert.equal(said.changed, edited.changed, 'and confirming is not a change');
  assert.equal((await vault.readRecord(put.id)).confirmed, said.confirmed);
});

test('writing needs a kind this build knows, a title, and documents that are really in the locker', async () => {
  const { vault, scan } = await opened();
  await assert.rejects(vault.putRecord({ kind: 'pet', title: 'Invented cat' }), /no record kind "pet"/);
  await assert.rejects(vault.putRecord({ kind: 'credential', title: '   ' }), /needs a title/);
  await assert.rejects(vault.putRecord({ ...LICENCE, documents: ['not a document'] }), /no document not a document in the locker/);
  await assert.rejects(vault.putRecord({ id: 'not a record', ...LICENCE }), /no record not a record/);
  assert.equal((await vault.listRecords()).length, 0, 'and none of those refusals left anything behind');
  await vault.putRecord({ ...LICENCE, documents: [scan.id] });
  assert.equal((await vault.listRecords()).length, 1);
});

test('a record whose kind this build does not know is carried through, never dropped', async () => {
  // The check the model says to write first, because its absence is silent: a newer build writes a kind, an older
  // build opens the same vault, changes something else, and the record it could not use must still be there.
  const { vault, scan } = await opened();
  RECORD_KINDS.pet = { title: 'A pet', about: 'From a later build', fields: [['name', 'Name', 'shown'], ['chip', 'Microchip', 'hidden'], ['vet', 'Vet', 'shown'], ['born', 'Born', 'shown'], ['breed', 'Breed', 'shown']] };
  let newer;
  try {
    newer = await vault.putRecord({ kind: 'pet', title: 'Invented cat', fields: { name: 'Mittens', chip: '900000000111222' } });
  } finally {
    delete RECORD_KINDS.pet;          // from here on this build has never heard of a pet
  }
  assert.equal(isKnownKind('pet'), false, 'this build no longer knows the kind');

  const listed = await vault.listRecords();
  assert.equal(listed.length, 1, 'it is still listed');
  assert.equal(listed[0].kind, 'pet', 'as what it is, not as something this build understands');

  // An older build now puts in, changes and takes out records of its own. The one it cannot use survives all of it.
  const mine = await vault.putRecord({ ...LICENCE, documents: [scan.id] });
  await vault.putRecord({ id: mine.id, ...LICENCE, title: 'Changed', documents: [] });
  const other = await vault.putRecord({ ...LICENCE, title: 'Another' });
  await vault.removeRecord(other.id);
  const after = await vault.listRecords();
  assert.deepEqual(after.map(entry => entry.title).sort(), ['Changed', 'Invented cat']);
  const read = await vault.readRecord(newer.id);
  assert.equal(read.kind, 'pet');
  assert.deepEqual(read.fields, { name: 'Mittens', chip: '900000000111222' }, 'with its fields exactly as the newer build left them');
  // And what this build cannot name, it hides rather than shows.
  assert.match(shownValue('pet', 'name', 'Mittens'), /^•+ns$/, 'a kind this build cannot name is hidden, field by field');
});

test('a record taken out leaves its documents in the locker, and its own file is gone', async () => {
  const { vault, scan } = await opened();
  const put = await vault.putRecord({ ...LICENCE, documents: [scan.id] });
  await vault.removeRecord(put.id);
  assert.deepEqual(await vault.listRecords(), []);
  assert.equal(await vault.readRecord(put.id), null);
  const documents = await vault.listDocuments();
  assert.deepEqual(documents.map(entry => entry.title), ['A scan of the invented licence'], 'the scan is still yours');
  assert.equal((await vault.readDocument(scan.id)).length, bytes('not a real scan').length, 'and still readable');
  await assert.rejects(vault.removeRecord(put.id), /no record/);
});

test('which records would lose their proof if a document went', async () => {
  const { vault, scan } = await opened();
  const other = await vault.addDocument({ title: 'An invented payslip', bytes: bytes('not a real payslip') });
  const licence = await vault.putRecord({ ...LICENCE, documents: [scan.id] });
  const job = await vault.putRecord({ kind: 'employment', title: 'An invented job', documents: [scan.id, other.id], fields: { employer: 'Dunmore Creek Veterinary Clinic', title: 'Nurse' } });
  assert.deepEqual((await vault.recordsUsing(scan.id)).map(one => one.title).sort(), ['An invented job', 'Invented nursing licence'],
    'one document can prove two things, and both are named');
  assert.deepEqual((await vault.recordsUsing(other.id)).map(one => one.id), [job.id]);
  assert.deepEqual(await vault.recordsUsing('no such document'), []);
  assert.ok(licence.id && job.id);
});

test('a licence shared three ways, each saying exactly what it gives', async () => {
  const { vault, scan } = await opened();
  const put = await vault.putRecord({ ...LICENCE, documents: [scan.id] });
  const record = await vault.readRecord(put.id);

  const number = shareOf(record, { fields: ['number'] });
  assert.deepEqual(number.fields.map(one => [one.label, one.value, one.hidden]), [['Number', 'INV-44821', true]]);
  assert.deepEqual(number.documents, [], 'the scan is not in it');
  assert.match(number.fields[0].shownAs, /^•+4821$/, 'and it is plain that this one is normally hidden');

  const withExpiry = shareOf(record, { fields: ['number', 'expires'] });
  assert.deepEqual(withExpiry.fields.map(one => one.name), ['number', 'expires']);
  assert.deepEqual(withExpiry.fields.map(one => one.hidden), [true, false]);
  assert.equal(withExpiry.fields[1].shownAs, '02/30/2029', 'a date about the licence is shown as it is');

  const withScan = shareOf(record, { fields: ['number', 'expires'], documents: [scan.id] });
  assert.deepEqual(withScan.documents, [scan.id]);
  assert.equal(withScan.title, 'Invented nursing licence');

  // A share names its parts. It cannot ask for what the record has not got, or a document it does not carry.
  assert.throws(() => shareOf(record, { fields: ['pay'] }), /no field "pay"/);
  assert.throws(() => shareOf(record, { documents: ['another document'] }), /does not carry the document/);
  assert.deepEqual(shareOf(record).fields, [], 'and with nothing named, nothing goes');
});

test('no kind has anywhere to put a password: those belong to the password manager', () => {
  for (const [kind, shape] of Object.entries(RECORD_KINDS)) {
    for (const [name] of shape.fields) {
      assert.ok(!/pass(word|phrase)|secret|\bpin\b|login/i.test(name), kind + '.' + name + ' looks like a password field');
    }
  }
});
