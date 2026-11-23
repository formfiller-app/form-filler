// The kinds of record a vault can hold, and what each of their fields gives away. The shape was written down and
// reviewed first: docs/VAULT_RECORDS.md. Nothing here touches a store, a browser or a network, so it is tested on
// its own (tests/records.test.js).
//
// The rule this module exists to keep: **a field that declares nothing is hidden**. A field nobody thought about
// must fail towards privacy, not away from it, so `sensitivity` answers 'hidden' for anything it does not know.

import { masked } from './profile.js';

// Each field: [name, label, 'shown' | 'hidden']. "shown" means it is printed as it is; "hidden" means it is shown
// by its last characters, the way a name or a date of birth already is on the page.
export const RECORD_KINDS = {
  identity: {
    title: 'Identification',
    about: 'A passport, a driving licence, a birth certificate.',
    fields: [
      ['number', 'Number', 'hidden'],
      ['nameOnIt', 'Name on it', 'hidden'],
      ['issuer', 'Issued by', 'shown'],
      ['where', 'Valid in', 'shown'],
      ['issued', 'Issued', 'shown'],
      ['expires', 'Expires', 'shown'],
    ],
  },
  bank: {
    title: 'Bank account',
    about: 'One account: where money is paid in, or out.',
    fields: [
      ['institution', 'Bank', 'shown'],
      ['sort', 'Kind of account', 'shown'],
      ['accountName', 'Name on the account', 'hidden'],
      ['account', 'Account number', 'hidden'],
      ['routing', 'Routing number', 'hidden'],
      ['opened', 'Opened', 'shown'],
    ],
  },
  employment: {
    title: 'Job',
    about: 'One position. A history is a set of these, newest first.',
    fields: [
      ['employer', 'Employer', 'shown'],
      ['title', 'Job title', 'shown'],
      ['from', 'From', 'shown'],
      ['to', 'To', 'shown'],
      ['address', 'Employer\'s address', 'shown'],
      ['supervisor', 'Supervisor', 'hidden'],
      ['pay', 'Pay', 'hidden'],
    ],
  },
  credential: {
    title: 'Licence or certification',
    about: 'What a body awarded you, and when it runs out.',
    fields: [
      ['number', 'Number', 'hidden'],
      ['body', 'Awarded by', 'shown'],
      ['kind', 'What it is', 'shown'],
      ['issued', 'Issued', 'shown'],
      ['expires', 'Expires', 'shown'],
      ['status', 'Status', 'shown'],
    ],
  },
};

export const KIND_NAMES = Object.keys(RECORD_KINDS);
export const isKnownKind = kind => Object.prototype.hasOwnProperty.call(RECORD_KINDS, kind);
export const fieldsOf = kind => (isKnownKind(kind) ? RECORD_KINDS[kind].fields : []);
export const labelOf = (kind, field) => (fieldsOf(kind).find(([name]) => name === field) || [, field])[1];

// What a field gives away. Anything this build does not know about is hidden: see the note at the top.
export const sensitivity = (kind, field) => {
  const known = fieldsOf(kind).find(([name]) => name === field);
  return known && known[2] === 'shown' ? 'shown' : 'hidden';
};

// A field's value as it is shown on a screen: whole, or by its last characters.
export const shownValue = (kind, field, value) =>
  sensitivity(kind, field) === 'hidden' ? masked(value ?? '') : String(value ?? '');

// A record's fields, kept to strings, as the profile's details already are. A name this build does not know is kept
// rather than dropped — it belongs to somebody, and dropping it on a write is how a newer vault loses things in an
// older build — but it is hidden, by the rule above.
export const cleanRecordFields = fields =>
  (fields && typeof fields === 'object' && !Array.isArray(fields)
    ? Object.fromEntries(Object.entries(fields).filter(([, value]) => typeof value === 'string'))
    : {});

// What a share would hand over: named fields and named documents, never "all". Values come back as they would be
// shown, so a hidden field going out whole is visibly a decision rather than an accident.
export function shareOf(record, { fields = [], documents = [] } = {}) {
  if (!record || typeof record !== 'object') throw new Error('A share needs a record.');
  const held = cleanRecordFields(record.fields);
  const has = record.documents || [];
  for (const name of fields) if (!(name in held)) throw new Error('This record has no field "' + name + '" to share.');
  for (const id of documents) if (!has.includes(id)) throw new Error('This record does not carry the document ' + id + '.');
  return {
    recordId: record.id,
    kind: record.kind,
    title: record.title,
    fields: fields.map(name => ({
      name,
      label: labelOf(record.kind, name),
      value: held[name],
      shownAs: shownValue(record.kind, name, held[name]),
      hidden: sensitivity(record.kind, name) === 'hidden',
    })),
    documents: [...documents],
  };
}
