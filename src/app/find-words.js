// The finder: a bank of forms, and the plain matching that finds one from the words a person actually uses. No
// browser is needed here, so it is tested on its own (tests/find.test.js).
//
// Two things this module is careful about, both asked for by the owner on 2026-11-22 and written into
// docs/PAPERWORK_PROPOSAL.md:
//
//   1. No model. A query is cut into words and matched against each form's own words. That can be read, argued with
//      and checked by a test, which a model's answer cannot. Nothing of the person's is sent anywhere to do it,
//      because nothing is sent anywhere at all.
//   2. No invented results. A query that matches nothing returns nothing. A finder that produces a plausible form
//      for every question is worse than one that admits it has no answer.
//
// The forms here are invented, as rule 5 requires: invented issuers, invented numbers, invented addresses on the
// web. Every title says so. A real list replaces FORMS without touching the matching below.

// How fresh the bank promises to be: a form checked longer ago than this says so, on its own card.
export const PROMISE_DAYS = 180;

export const FORMS = [
  {
    id: 'new-job-withholding',
    title: 'State Withholding Declaration — Form SW-1 (invented form)',
    issuer: 'Indiana Revenue Office (invented)',
    where: 'Indiana',
    summary: 'How much tax your employer holds back from each paycheck.',
    checked: '2026-11-18',
    official: 'https://forms.example.org/in-revenue/sw-1',
    fills: true,
    words: ['starting a job', 'new job', 'hired', 'withholding', 'paycheck', 'tax taken out', 'allowances', 'employer'],
  },
  {
    id: 'new-job-eligibility',
    title: 'Work Eligibility Record — Form WE-9 (invented form)',
    issuer: 'Federal Invented Labour Bureau',
    where: 'the whole country',
    summary: 'Proof you may take the job, with the identification the employer must see.',
    checked: '2026-11-14',
    official: 'https://forms.example.org/labour/we-9',
    fills: true,
    words: ['starting a job', 'new job', 'hired', 'right to work', 'eligibility', 'identification', 'employer'],
  },
  {
    id: 'direct-deposit',
    title: 'Direct Deposit Authorization (invented form)',
    issuer: 'Wabash Mutual Credit Union (invented)',
    where: 'anywhere its members live',
    summary: 'Where your wages are paid in: the account, and the branch that holds it.',
    checked: '2026-11-09',
    official: 'https://forms.example.org/wabash-mutual/direct-deposit',
    fills: true,
    words: ['paycheck', 'wages paid in', 'direct deposit', 'bank', 'routing', 'account', 'payroll'],
  },
  {
    id: 'address-post',
    title: 'Change of Address Notice — Form CA-2 (invented form)',
    issuer: 'Invented Postal Service',
    where: 'the whole country',
    summary: 'Post sent to the old address follows you to the new one.',
    checked: '2026-11-02',
    official: 'https://forms.example.org/post/ca-2',
    fills: true,
    words: ['moved', 'moving', 'new address', 'change of address', 'forward my post', 'mail'],
  },
  {
    id: 'address-driving',
    title: 'Driver Record Address Change — Form DR-14 (invented form)',
    issuer: 'Indiana Driver Records Office (invented)',
    where: 'Indiana',
    summary: 'The address on your driving licence and on anything registered to you.',
    checked: '2026-10-27',
    official: 'https://forms.example.org/in-driver/dr-14',
    fills: true,
    words: ['moved', 'new address', 'driving licence', 'drivers license', 'car', 'vehicle', 'registration'],
  },
  {
    id: 'income-statement',
    title: 'Annual Income Statement — Form IT-100 (invented form)',
    issuer: 'Federal Invented Revenue Service',
    where: 'the whole country',
    summary: 'The once-a-year reckoning of what you earned and what was already paid.',
    checked: '2026-06-03',
    official: 'https://forms.example.org/revenue/it-100',
    fills: false,
    words: ['tax return', 'taxes', 'filing', 'annual', 'income', 'refund', 'owed'],
  },
  {
    id: 'small-claim',
    title: 'Small Claim Petition — Form SC-3 (invented form)',
    issuer: 'Marion County Invented Court',
    where: 'Indiana',
    summary: 'Asking a court for a small sum somebody will not pay you.',
    checked: '2026-10-19',
    official: 'https://forms.example.org/marion-court/sc-3',
    fills: true,
    words: ['court', 'sue', 'small claim', 'money owed', 'dispute', 'landlord', 'deposit back'],
  },
  {
    id: 'name-change',
    title: 'Petition to Change a Name — Form NC-7 (invented form)',
    issuer: 'Marion County Invented Court',
    where: 'Indiana',
    summary: 'Changing the name you are known by, on the record.',
    checked: '2026-04-11',
    official: 'https://forms.example.org/marion-court/nc-7',
    fills: false,
    words: ['change my name', 'name change', 'married name', 'maiden name', 'court'],
  },
  {
    id: 'patient-intake',
    title: 'New Patient Intake Sheet (invented form)',
    issuer: 'Dunmore Creek Veterinary Clinic (invented)',
    where: 'the clinic itself',
    summary: 'What a clinic asks before it sees you for the first time.',
    checked: '2026-11-16',
    official: 'https://forms.example.org/dunmore-creek/intake',
    fills: true,
    words: ['doctor', 'clinic', 'new patient', 'intake', 'first appointment', 'medical history'],
  },
  {
    id: 'records-release',
    title: 'Release of Medical Records — Form MR-5 (invented form)',
    issuer: 'Invented Health Records Board',
    where: 'the whole country',
    summary: 'Telling one clinic it may send your records to another, or to you.',
    checked: '2026-11-06',
    official: 'https://forms.example.org/health-records/mr-5',
    fills: true,
    words: ['medical records', 'release', 'request my records', 'doctor', 'hospital', 'notes'],
  },
  {
    id: 'account-opening',
    title: 'Account Opening Application (invented form)',
    issuer: 'Wabash Mutual Credit Union (invented)',
    where: 'anywhere its members live',
    summary: 'Opening an account, and who may reach it besides you.',
    checked: '2026-10-30',
    official: 'https://forms.example.org/wabash-mutual/open-account',
    fills: true,
    words: ['open an account', 'bank account', 'savings', 'checking', 'new account', 'bank'],
  },
  {
    id: 'benefit-claim',
    title: 'Unemployment Benefit Claim — Form UB-4 (invented form)',
    issuer: 'Indiana Workforce Office (invented)',
    where: 'Indiana',
    summary: 'A claim for support between one job and the next.',
    checked: '2026-05-21',
    official: 'https://forms.example.org/in-workforce/ub-4',
    fills: false,
    words: ['lost my job', 'laid off', 'unemployment', 'benefit', 'claim', 'out of work', 'fired'],
  },
];

// Queries offered on the screen, so the finder can be tried without thinking of something to type.
export const TRY_THESE = ['I’m starting a job in Indiana', 'I moved house', 'a doctor wants my records', 'somebody owes me money'];

// The words of a piece of text, lowercased, with everything that is not a letter or digit treated as a gap.
export const wordsOf = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Words too common to tell two forms apart. Whole words only, so "in" is dropped and "Indiana" is not.
const COMMON = new Set(['a', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from', 'get', 'has', 'have',
  'how', 'i', 'if', 'im', 'in', 'is', 'it', 'me', 'my', 'need', 'of', 'on', 'or', 'out', 'so', 'the', 'their', 'them', 'they', 'this',
  'to', 'up', 'want', 'was', 'what', 'when', 'where', 'which', 'who', 'will', 'with', 'you', 'your']);
export const asked = query => [...new Set(wordsOf(query).filter(word => word.length > 1 && !COMMON.has(word)))];

// Everything a form can be found by: its own title and issuer, where it applies, what it is for, and the words
// people use for it.
const hayOf = form => [...new Set(wordsOf([form.title, form.issuer, form.where, form.summary, ...form.words].join(' ')))];

// One word matches another when either is the start of the other, and both are long enough for that to mean
// something: "start" finds "starting", "licence" finds "licences", "a" finds nothing.
const near = (one, other) => one === other || (one.length >= 3 && other.length >= 3 && (one.startsWith(other) || other.startsWith(one)));

// The more a person says, the more of it a form has to answer. One word in common is enough when one word was
// asked ("court"), and not enough when ten were: "how do I register a hot air balloon on Mars" shares "register"
// with the driving-records form, and offering it would be the kind of nearly-right answer this finder refuses.
export const enough = want => (want.length >= 4 ? 2 : 1);

// How well a form answers a query. 0 means it does not, and 0 is returned rather than a weak guess.
export function score(form, query) {
  const want = asked(query);
  if (!want.length) return 0;
  const hay = hayOf(form);
  const hit = want.filter(word => hay.some(have => near(have, word)));
  if (hit.length < enough(want)) return 0;
  const flat = ' ' + wordsOf(query).join(' ') + ' ';
  // A whole phrase the form is known by, said in the query, is worth more than the same words scattered about.
  const phrases = form.words.filter(phrase => wordsOf(phrase).length > 1 && flat.includes(' ' + wordsOf(phrase).join(' ') + ' ')).length;
  // So is naming the place it applies, which is how two otherwise identical forms are told apart.
  const place = wordsOf(form.where).some(word => want.some(asking => near(word, asking))) ? 1 : 0;
  return hit.length + phrases * 2 + place;
}

// Days since a form was last checked, and whether that is longer than the bank promises.
export function staleness(form, today = new Date()) {
  const then = Date.parse(form.checked + 'T00:00:00Z'), now = Date.parse(new Date(today).toISOString().slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(then) || Number.isNaN(now)) return { days: null, overdue: false };
  const days = Math.round((now - then) / 86400000);
  return { days, overdue: days > PROMISE_DAYS };
}

// The forms that answer a query, best first, each with how stale it is. An empty query returns the whole bank, so a
// person can see what is in it; a query nothing matches returns nothing at all.
export function search(query, { today = new Date(), forms = FORMS } = {}) {
  const dress = form => ({ form, ...staleness(form, today) });
  if (!asked(query).length) return forms.map(form => ({ ...dress(form), score: 0 }));
  return forms
    .map(form => ({ ...dress(form), score: score(form, query) }))
    .filter(found => found.score > 0)
    .sort((one, other) => other.score - one.score || one.form.title.localeCompare(other.form.title));
}

// What the card says happens if you pick this one.
export const whatHappens = form => form.fills
  ? 'Form Filler fills this one: its blanks are understood.'
  : 'Opened at the official site: its blanks are not understood here, so Form Filler will not pretend to fill it.';
