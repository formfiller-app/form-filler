import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_KINDS } from '../src/lib/record-kinds.js';
import { shareOf } from '../src/lib/record-kinds.js';
import { confirmedWords, documentWords, hiddenWarning, hidingWords, kindTitle, recordLine, rowsOf, shareWords } from '../src/app/record-words.js';

// The words of the records screen (src/app/record-words.js). The screen itself is walked by scripts/walk-mac.cjs;
// these are the sentences it says, which need no window. Everything here is invented.

const LICENCE = {
  id: 'r1', kind: 'credential', title: 'Invented nursing licence',
  fields: { number: 'INV-44821', body: 'Invented Board of Nursing', kind: 'Registered nurse', expires: '02/30/2029', status: 'Active' },
  documents: ['d1'], confirmed: null, added: '2026-11-23T09:10:55+00:00', changed: '2026-11-23T09:10:55+00:00',
};

test('a record reads as what you called it, then what it is', () => {
  assert.equal(recordLine({ title: 'Invented nursing licence', kind: 'credential' }), 'Invented nursing licence · Licence or certification');
  assert.equal(kindTitle('employment'), 'Job');
  assert.equal(kindTitle('a kind from a later version'), 'a kind from a later version', 'and an unknown kind goes by its own name');
});

test('a record nobody has confirmed says so, rather than showing a date', () => {
  assert.equal(confirmedWords(LICENCE), 'Never confirmed');
  assert.equal(confirmedWords({ ...LICENCE, confirmed: '2026-11-23T09:14:02+00:00' }), 'Confirmed 2026-11-23 09:14');
  assert.equal(confirmedWords(null), 'Never confirmed');
});

test('what proves a record is counted in words, singular and plural', () => {
  assert.equal(documentWords({ documents: [] }), 'Nothing proves it yet');
  assert.equal(documentWords(LICENCE), '1 document proves it');
  assert.equal(documentWords({ documents: ['a', 'b'] }), '2 documents prove it');
});

test('the hidden fields are hidden on the screen, and shown only when asked', () => {
  const rows = rowsOf(LICENCE);
  assert.deepEqual(rows.map(row => row.label), ['Number', 'Awarded by', 'What it is', 'Expires', 'Status'], 'in the order the kind declares');
  const number = rows.find(row => row.name === 'number');
  assert.equal(number.hidden, true);
  assert.match(number.value, /^•+4821$/, 'the licence number is shown by its last characters');
  assert.equal(rows.find(row => row.name === 'body').value, 'Invented Board of Nursing', 'who awarded it is not hidden');
  const whole = rowsOf(LICENCE, { shown: true });
  assert.equal(whole.find(row => row.name === 'number').value, 'INV-44821', 'asked for, it is shown in full');
  assert.equal(whole.find(row => row.name === 'number').hidden, true, 'and it still says it is one of the hidden ones');
});

test('a field from a later version is shown, under its own name, and hidden', () => {
  const later = { ...LICENCE, fields: { ...LICENCE.fields, endorsement: 'Invented paediatrics endorsement' } };
  const row = rowsOf(later).find(one => one.name === 'endorsement');
  assert.equal(row.unknown, true, 'the screen says where it came from');
  assert.equal(row.hidden, true, 'and hides it, because nothing declared otherwise');
  assert.match(row.value, /^•+ment$/);
  assert.equal(rowsOf(later).length, rowsOf(LICENCE).length + 1, 'it is not dropped from the screen');
});

test('a field left empty is not shown at all', () => {
  const rows = rowsOf({ ...LICENCE, fields: { number: 'INV-44821', body: '', status: 'Active' } });
  assert.deepEqual(rows.map(row => row.name), ['number', 'status']);
});

test('the screen says how many of a record\'s fields it is hiding', () => {
  assert.equal(hidingWords(LICENCE, false), 'One field of this record is shown by its last characters only.');
  assert.equal(hidingWords(LICENCE, true), 'One field of this record is shown in full.');
  const job = { kind: 'employment', fields: { employer: 'Dunmore Creek Veterinary Clinic', supervisor: 'Priya Raman', pay: '48000' }, documents: [] };
  assert.equal(hidingWords(job, false), '2 fields of this record are shown by their last characters only.');
  assert.equal(hidingWords({ kind: 'credential', fields: { body: 'Invented Board of Nursing' }, documents: [] }, false), '', 'with nothing hidden it says nothing');
});

test('a share says what it would give, and never says "everything"', () => {
  assert.equal(shareWords(shareOf(LICENCE, {})), 'Nothing is chosen yet, so nothing would go.');
  assert.equal(shareWords(shareOf(LICENCE, { fields: ['number'] })), 'This would give Number, and nothing else.');
  assert.equal(shareWords(shareOf(LICENCE, { fields: ['number', 'expires'] })), 'This would give Number and Expires, and nothing else.');
  assert.equal(shareWords(shareOf(LICENCE, { fields: ['number', 'expires'], documents: ['d1'] })), 'This would give Number and Expires and 1 document, and nothing else.');
  assert.equal(shareWords(shareOf(LICENCE, { fields: ['number', 'expires', 'status'] })), 'This would give Number, Expires and Status, and nothing else.');
  assert.equal(shareWords(shareOf(LICENCE, { documents: ['d1'] })), 'This would give 1 document, and nothing else.');
});

test('a share that would hand over something normally hidden says so in as many words', () => {
  assert.equal(hiddenWarning(shareOf(LICENCE, { fields: ['expires'] })), '', 'nothing hidden, nothing to warn about');
  assert.equal(hiddenWarning(shareOf(LICENCE, { fields: ['number'] })),
    'Number is normally shown by its last characters only. It would go in full.');
  const job = { id: 'r2', kind: 'employment', title: 'An invented job', documents: [],
    fields: { employer: 'Dunmore Creek Veterinary Clinic', supervisor: 'Priya Raman', pay: '48000' } };
  assert.equal(hiddenWarning(shareOf(job, { fields: ['supervisor', 'pay'] })),
    'Supervisor and Pay are normally shown by their last characters only. They would go in full.');
});

test('every kind\'s title is a plain noun, so the screen can say "Add a …"', () => {
  for (const [kind, shape] of Object.entries(RECORD_KINDS)) {
    assert.ok(!/^(a|an) /i.test(shape.title), kind + '\'s title "' + shape.title + '" already starts with an article');
  }
});
