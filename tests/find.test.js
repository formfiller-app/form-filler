import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FORMS, PROMISE_DAYS, TRY_THESE, asked, enough, score, search, staleness, whatHappens, wordsOf } from '../src/app/find-words.js';

// The finder: a bank of invented forms, found by the words a person actually uses. These checks are about the words
// and the matching (src/app/find-words.js); the screen over them is walked by scripts/walk.cjs. Two promises are
// what these tests exist for, both set by the owner on 2026-11-22: the matching uses no model, and a query that
// matches nothing returns nothing rather than something plausible.

const TODAY = new Date('2026-11-22T12:00:00Z');

test('every form in the bank says it is invented, and says who, where and when', () => {
  assert.ok(FORMS.length >= 10, 'a bank, not a token handful: ' + FORMS.length + ' forms');
  assert.equal(new Set(FORMS.map(form => form.id)).size, FORMS.length, 'no two forms share an id');
  for (const form of FORMS) {
    assert.match(form.title, /\(invented form\)$/, form.id + ' says in its title that it is invented');
    assert.match(form.issuer, /invented|Invented/, form.id + ' names an invented issuer');
    assert.ok(form.where, form.id + ' says where it applies');
    assert.match(form.checked, /^\d{4}-\d{2}-\d{2}$/, form.id + ' says when it was last checked');
    assert.ok(form.summary, form.id + ' says in one line what it is for');
    assert.equal(typeof form.fills, 'boolean', form.id + ' is either filled here or opened at the official site');
    assert.ok(form.words.length >= 4, form.id + ' carries the words people would use for it');
    assert.match(form.official, /^https:\/\/forms\.example\.org\//, form.id + ' points at an invented address, not a real one');
  }
});

test('a form is found by the words a person would actually type', () => {
  const asking = {
    'I’m starting a job in Indiana': 'new-job-withholding',
    'I moved house': 'address-post',
    'somebody owes me money': 'small-claim',
    'a doctor wants my records': 'records-release',
    'I want to open a bank account': 'account-opening',
    'I lost my job': 'benefit-claim',
    'changing my name after getting married': 'name-change',
  };
  for (const [query, wanted] of Object.entries(asking)) {
    const found = search(query, { today: TODAY });
    assert.ok(found.length, query + ' finds something');
    assert.ok(found.slice(0, 3).some(one => one.form.id === wanted),
      query + ' puts ' + wanted + ' among the first three, got: ' + found.slice(0, 3).map(one => one.form.id).join(', '));
  }
});

test('nothing is invented: a query the bank cannot answer returns nothing at all', () => {
  for (const query of ['zygomorphic quibbleplex', 'how do I register a hot air balloon on Mars', 'qqqq']) {
    assert.deepEqual(search(query, { today: TODAY }), [], query + ' returns nothing rather than a plausible form');
  }
});

test('the more a person says, the more of it a form has to answer', () => {
  assert.equal(enough(['court']), 1, 'one word asked, one word answered is enough');
  assert.equal(enough(['register', 'hot', 'air', 'balloon', 'mars']), 2, 'five words asked, one in common is not');
  // "court" alone is a fair question and finds the court's forms.
  assert.ok(search('court', { today: TODAY }).length >= 2, 'a single fair word still finds its forms');
  // The same single word buried in a question about something else does not.
  assert.deepEqual(search('how do I register a hot air balloon on Mars', { today: TODAY }), [],
    'one word in common out of a long question is a nearly-right answer, which is refused');
});

test('the place a form applies in tells two otherwise similar forms apart', () => {
  // Both of these are about moving; naming the driving licence should bring the driving one up.
  const moving = search('I moved and need to change my driving licence', { today: TODAY });
  assert.equal(moving[0].form.id, 'address-driving', 'got ' + moving[0].form.id);
  // Indiana is in "where", so naming it counts towards the forms that apply there.
  const indiana = search('Indiana', { today: TODAY });
  assert.ok(indiana.length >= 4, 'naming the state finds the forms that apply there');
  for (const one of indiana) assert.equal(one.form.where, 'Indiana', one.form.id + ' applies in Indiana');
});

test('an empty query shows the whole bank, so what is in it can be seen', () => {
  for (const query of ['', '   ', 'the and of my']) {
    const found = search(query, { today: TODAY });
    assert.equal(found.length, FORMS.length, JSON.stringify(query) + ' shows all of them');
    assert.deepEqual(found.map(one => one.form.id), FORMS.map(form => form.id), 'in the order they were written down');
  }
});

test('words too common to tell forms apart are dropped, whole words only', () => {
  assert.deepEqual(asked('I am in Indiana'), ['indiana'], 'in is dropped and Indiana is not');
  assert.deepEqual(wordsOf('I’m starting — a job!'), ['i', 'm', 'starting', 'a', 'job']);
  assert.equal(score(FORMS[0], 'the and of my'), 0, 'common words alone score nothing');
});

test('how stale a form is, told honestly against the period the bank promises', () => {
  const fresh = { checked: '2026-11-18' }, old = { checked: '2026-01-12' };
  assert.deepEqual(staleness(fresh, TODAY), { days: 4, overdue: false });
  const long = staleness(old, TODAY);
  assert.equal(long.days, 314);
  assert.equal(long.overdue, true, 'longer ago than the ' + PROMISE_DAYS + ' days promised');
  assert.deepEqual(staleness({ checked: 'not a date' }, TODAY), { days: null, overdue: false }, 'a date it cannot read is not called fresh');
  const overdue = search('', { today: TODAY }).filter(one => one.overdue);
  assert.ok(overdue.length, 'the bank holds at least one form it is behind on, and says so');
});

test('each form is either filled here or opened at the official site, never half', () => {
  for (const form of FORMS) {
    const said = whatHappens(form);
    if (form.fills) assert.match(said, /Form Filler fills this one/);
    else assert.match(said, /will not pretend to fill it/);
  }
  assert.ok(FORMS.some(form => form.fills) && FORMS.some(form => !form.fills), 'the bank shows both kinds');
});

test('the queries offered on the screen all find something', () => {
  assert.ok(TRY_THESE.length >= 3);
  for (const query of TRY_THESE) assert.ok(search(query, { today: TODAY }).length, 'the offered query "' + query + '" finds something');
});

test('the finder reaches for nothing outside itself: no model, no network, no storage', () => {
  const source = readFileSync(new URL('../src/app/find-words.js', import.meta.url), 'utf8');
  for (const word of ['fetch(', 'XMLHttpRequest', 'localStorage', 'indexedDB', 'navigator.', 'import(', 'anthropic', 'openai', 'apiKey', 'api_key']) {
    assert.ok(!source.toLowerCase().includes(word.toLowerCase()), 'the finder never reaches for ' + word);
  }
  assert.ok(!/^import /m.test(source), 'it imports nothing at all, so there is nothing it could reach through');
  // The only addresses in it are the invented ones on each form's card, which the page prints rather than opens.
  const addresses = source.match(/https?:\/\/[^\s'"]+/g) || [];
  for (const address of addresses) assert.match(address, /^https:\/\/forms\.example\.org\//, address + ' is one of the invented ones');
});
