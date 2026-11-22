// The worked example the page offers before anything else: an invented person's new-hire packet, opened with its
// answers already in place, changed in one spot, and then shown as the two offices would receive it. It is here to
// show what Form Filler is for in about half a minute, with no form to find, nobody to sign up with and nothing of
// your own typed in.
//
// Everything in this file is invented: the person, the employer, the credit union, both addresses, the account
// numbers and the forms themselves. No real form is copied. These are made-up forms that ask what such forms ask,
// each one marked as invented in its own title, so nobody can mistake the example for paperwork that counts.
//
// Only the words and the small sums live here, so they can be checked without a browser (tests/example.test.js). The
// screen that shows them is src/app/example.js. Nothing here sends or saves anything.
import { masked } from '../lib/profile.js';

// The invented person, as the packet arrives: the employer has filled in what it knows, and the rest comes from what
// the person already told Form Filler once.
export const PERSON = {
  fullName: 'Avery Nolan',
  birthDate: '02/30/1991',
  phone: '555-0147',
  email: 'avery.nolan@example.org',
  address: '418 Larkspur Lane, Apt 3',
  city: 'Bloomington',
  state: 'IN',
  zip: '47401',
  startDate: '12/07/2026',
  allowances: '2',
  bankName: 'Wabash Mutual Credit Union (invented)',
  routing: '999000999',
  account: '4455000122337',
  contactName: 'Priya Raman',
  contactPhone: '555-0163',
};

// The invented move: one new address, used by the example's "they have just moved" button so that nothing of the
// person's own is ever typed in. Typing in the boxes by hand does the same thing.
export const MOVED = { address: '1620 Mulberry Court', city: 'Terre Haute', zip: '47803' };

export const EMPLOYER = { name: 'Dunmore Creek Veterinary Clinic', where: '900 Shelby Row, Indianapolis, IN 46201', kind: 'an invented employer' };

// Which details are of a kind the privacy wall keeps off the screen until you ask (profile.js, part 5). In the
// example the bank numbers are always shown by their last characters: it is invented money, but it is the habit the
// rest of Form Filler keeps.
export const HIDDEN_KINDS = ['bank'];

// The packet's three forms. `from` names the detail each blank is filled from; `kind` says what sort of thing it is,
// which is how the example knows which forms carry the address and which carry bank details.
export const FORMS = [
  {
    id: 'info',
    title: 'New Hire Information Sheet (invented form)',
    issuer: 'Dunmore Creek Veterinary Clinic',
    applies: 'this employer only',
    fields: [
      { label: 'Full name', from: 'fullName', kind: 'name' },
      { label: 'Date of birth', from: 'birthDate', kind: 'birthDate' },
      { label: 'Phone', from: 'phone' },
      { label: 'Email', from: 'email' },
      { label: 'First day', from: 'startDate' },
      { label: 'Emergency contact', from: 'contactName' },
      { label: 'Emergency contact phone', from: 'contactPhone' },
    ],
  },
  {
    id: 'withholding',
    title: 'Indiana State Withholding — Form SW-1 (invented form)',
    issuer: 'an invented state revenue office',
    applies: 'Indiana',
    fields: [
      { label: 'Full name', from: 'fullName', kind: 'name' },
      { label: 'Street address', from: 'address', kind: 'address' },
      { label: 'City', from: 'city', kind: 'address' },
      { label: 'State', from: 'state', kind: 'address' },
      { label: 'ZIP code', from: 'zip', kind: 'address' },
      { label: 'Allowances claimed', from: 'allowances' },
    ],
  },
  {
    id: 'deposit',
    title: 'Direct Deposit Authorization (invented form)',
    issuer: 'an invented credit union',
    applies: 'this employer and this credit union',
    fields: [
      { label: 'Full name', from: 'fullName', kind: 'name' },
      { label: 'Street address', from: 'address', kind: 'address' },
      { label: 'City', from: 'city', kind: 'address' },
      { label: 'ZIP code', from: 'zip', kind: 'address' },
      { label: 'Bank', from: 'bankName' },
      { label: 'Routing number', from: 'routing', kind: 'bank' },
      { label: 'Account number', from: 'account', kind: 'bank' },
    ],
  },
];

// The two offices the finished packet goes to, and the forms each one is sent. They overlap: both are sent the
// withholding form, and only payroll is sent the one with the bank details on it.
export const OFFICES = [
  {
    id: 'hr',
    name: 'The people office',
    gets: ['info', 'withholding'],
    why: 'It sets you up as an employee and keeps your withholding on file.',
    not: 'It is not sent the direct deposit form, so it never sees where you bank.',
  },
  {
    id: 'payroll',
    name: 'The payroll office',
    gets: ['withholding', 'deposit'],
    why: 'It works out the tax to hold back, and where to pay you.',
    not: 'It is not sent the information sheet, so it never sees your date of birth or your emergency contact.',
  },
];

// A field's value as the example shows it: a bank number by its last characters, everything else whole.
export const shownValue = field => (HIDDEN_KINDS.includes(field.kind) ? masked(field.value) : field.value);

const valueOf = (details, from) => String(details?.[from] ?? '').trim();

// One form with every blank filled from the details given. A blank with nothing behind it is still listed, empty: the
// example never pretends to know something it was not given.
export const fill = (form, details) => ({ ...form, fields: form.fields.map(field => ({ ...field, value: valueOf(details, field.from) })) });

// The whole packet, filled in.
export const packet = details => FORMS.map(form => fill(form, details));

// The forms that carry a kind of thing: `carrying('address')` is the two forms the address is written on, which is
// what the example shows side by side when the address changes.
export const carrying = (kind, details = PERSON) => packet(details).filter(form => form.fields.some(field => field.kind === kind));

// What one office receives: the forms it is sent, each with the fields it is given and nothing else, and whether any
// of them carry bank details. Asking for an office that is not there is an error, not an empty packet, so a typo in
// the screen cannot quietly send nothing.
export function share(officeId, details) {
  const office = OFFICES.find(item => item.id === officeId);
  if (!office) throw new Error('No such office: ' + officeId);
  const forms = office.gets.map(id => {
    const form = FORMS.find(item => item.id === id);
    if (!form) throw new Error('No such form: ' + id);
    return fill(form, details);
  });
  const fields = forms.flatMap(form => form.fields);
  return { office, forms, fields, bank: fields.some(field => field.kind === 'bank') };
}

// The address as one line, for the sentence that says what changed.
export const addressLine = details => [valueOf(details, 'address'), valueOf(details, 'city'), [valueOf(details, 'state'), valueOf(details, 'zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');

// Which of the address boxes hold something other than what the packet arrived with.
export const changed = details => ['address', 'city', 'zip'].filter(key => valueOf(details, key) !== valueOf(PERSON, key));
