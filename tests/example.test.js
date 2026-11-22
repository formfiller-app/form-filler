import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPLOYER, FORMS, HIDDEN_KINDS, MOVED, OFFICES, PERSON, addressLine, carrying, changed, fill, packet, share, shownValue } from '../src/app/example-words.js';

// The worked example the page opens with: an invented new-hire packet, the address changed in one place, and what
// each of the two offices receives. These checks are about the words and the sums (src/app/example-words.js); the
// screen that shows them is walked by scripts/walk.cjs. Everything here is invented, and nothing in it is sent or
// saved anywhere.

test('the packet is three invented forms, each saying so in its own title', () => {
  assert.equal(FORMS.length, 3);
  assert.deepEqual(FORMS.map(form => form.id), ['info', 'withholding', 'deposit']);
  for (const form of FORMS) {
    assert.match(form.title, /\(invented form\)$/, form.id + ' says it is invented');
    assert.ok(form.issuer && form.applies, form.id + ' says who issued it and where it applies');
    assert.ok(form.fields.length >= 5, form.id + ' asks for something worth filling');
    for (const field of form.fields) assert.ok(field.label && field.from, form.id + ': every blank has a label and a detail behind it');
  }
  assert.match(EMPLOYER.kind, /invented/);
});

test('the packet arrives filled in: every blank of every form has the invented person’s answer in it', () => {
  const filled = packet(PERSON);
  assert.equal(filled.length, 3);
  for (const form of filled) for (const field of form.fields) assert.ok(field.value, form.id + ' · ' + field.label + ' is filled in');
  assert.equal(filled[0].fields.find(field => field.label === 'Full name').value, 'Avery Nolan');
  assert.equal(filled[1].fields.find(field => field.label === 'ZIP code').value, '47401');
});

test('nothing is invented on the person’s behalf: with no details, the blanks are empty rather than guessed', () => {
  for (const form of packet({})) for (const field of form.fields) assert.equal(field.value, '', form.id + ' · ' + field.label);
  assert.equal(fill(FORMS[0], { fullName: '  Avery Nolan  ' }).fields[0].value, 'Avery Nolan', 'spaces around an answer are not part of it');
});

test('the address is on exactly two of the three forms, and changing it once changes both', () => {
  const carried = carrying('address');
  assert.deepEqual(carried.map(form => form.id), ['withholding', 'deposit']);
  assert.ok(!packet(PERSON).find(form => form.id === 'info').fields.some(field => field.kind === 'address'), 'the information sheet does not ask for an address');
  const moved = { ...PERSON, ...MOVED };
  for (const form of carrying('address', moved)) {
    assert.equal(form.fields.find(field => field.from === 'address').value, MOVED.address, form.id + ' carries the new street');
    assert.equal(form.fields.find(field => field.from === 'zip').value, MOVED.zip, form.id + ' carries the new ZIP code');
  }
  // What did not change stays as it was: the move is an address, not a new person.
  for (const form of packet(moved)) for (const field of form.fields.filter(field => field.kind !== 'address')) {
    assert.equal(field.value, packet(PERSON).find(item => item.id === form.id).fields.find(item => item.label === field.label).value, form.id + ' · ' + field.label);
  }
});

test('the invented move is a different place in all three parts, so the change can be seen', () => {
  assert.deepEqual(Object.keys(MOVED).sort(), ['address', 'city', 'zip']);
  for (const [key, value] of Object.entries(MOVED)) assert.notEqual(value, PERSON[key], key + ' is somewhere else');
  assert.deepEqual(changed(PERSON), []);
  assert.deepEqual(changed({ ...PERSON, ...MOVED }), ['address', 'city', 'zip']);
  assert.deepEqual(changed({ ...PERSON, city: 'Terre Haute' }), ['city']);
  assert.equal(addressLine(PERSON), '418 Larkspur Lane, Apt 3, Bloomington, IN 47401');
  assert.equal(addressLine({ ...PERSON, ...MOVED }), '1620 Mulberry Court, Terre Haute, IN 47803');
  assert.equal(addressLine({}), '');
});

test('what each office receives: both are sent the withholding form, only payroll the bank details', () => {
  assert.deepEqual(OFFICES.map(office => office.id), ['hr', 'payroll']);
  const hr = share('hr', PERSON), payroll = share('payroll', PERSON);
  assert.deepEqual(hr.forms.map(form => form.id), ['info', 'withholding']);
  assert.deepEqual(payroll.forms.map(form => form.id), ['withholding', 'deposit']);
  assert.equal(hr.bank, false);
  assert.equal(payroll.bank, true);
  assert.ok(!hr.fields.some(field => field.kind === 'bank'), 'the people office is sent no bank field');
  assert.ok(!hr.fields.some(field => /rout|account|bank/i.test(field.label)), 'and nothing that even names one');
  assert.deepEqual(payroll.fields.filter(field => field.kind === 'bank').map(field => field.label), ['Routing number', 'Account number']);
  // Payroll is not sent the information sheet, so what is only on it stays where it is.
  assert.ok(!payroll.fields.some(field => field.kind === 'birthDate'), 'payroll is sent no date of birth');
  assert.ok(!payroll.fields.some(field => /emergency/i.test(field.label)), 'and no emergency contact');
  // Every office is sent whole forms of this packet, filled from the same details, and nothing made up.
  for (const { forms } of [hr, payroll]) for (const form of forms) {
    assert.ok(FORMS.some(item => item.id === form.id), form.id + ' is one of the packet’s forms');
    assert.deepEqual(form.fields.map(field => field.label), FORMS.find(item => item.id === form.id).fields.map(field => field.label));
  }
  assert.equal(share('payroll', { ...PERSON, ...MOVED }).fields.find(field => field.from === 'address').value, MOVED.address, 'the address the person changed is the one payroll receives');
});

test('an office nobody has heard of is an error, not an empty packet', () => {
  assert.throws(() => share('legal', PERSON), /No such office: legal/);
});

test('bank numbers are shown by their last characters, as everywhere else in Form Filler', () => {
  assert.deepEqual(HIDDEN_KINDS, ['bank']);
  const payroll = share('payroll', PERSON);
  for (const field of payroll.fields.filter(field => field.kind === 'bank')) {
    const shown = shownValue(field);
    assert.notEqual(shown, field.value, field.label + ' is not shown whole');
    assert.match(shown, /^•+\d{4}$/, field.label + ' shows its last four characters only');
    assert.equal(shown.length, field.value.length);
  }
  // Everything else is shown as it is: a name on a form is the point of the form.
  for (const field of payroll.fields.filter(field => field.kind !== 'bank')) assert.equal(shownValue(field), field.value, field.label);
});

test('the example is words alone: it opens nothing, sends nothing and keeps nothing', () => {
  const source = readFileSync(new URL('../src/app/example-words.js', import.meta.url), 'utf8');
  for (const word of ['fetch(', 'XMLHttpRequest', 'localStorage', 'indexedDB', 'navigator.', 'import(']) assert.ok(!source.includes(word), 'the example never reaches for ' + word);
  assert.equal(source.match(/^import /gm).length, 1, 'it imports one thing: how a hidden value is shown');
});
