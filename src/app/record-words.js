// The words of the records screen (desk.js): how a record reads in a list, how its fields read on the screen with
// the hidden ones hidden, and what a share says it is about to give. No window is needed here, so it is tested on
// its own (tests/record-words.test.js).
//
// The shape these words describe is docs/VAULT_RECORDS.md. Two of its rules show up here rather than in the vault:
// a field this build cannot name is still shown, under its own name and hidden; and a record nobody has confirmed
// says so, instead of showing a date that only means somebody typed.

import { RECORD_KINDS, fieldsOf, labelOf, sensitivity, shownValue } from '../lib/record-kinds.js';
import { whenWords } from './desk-words.js';

export const kindTitle = kind => RECORD_KINDS[kind]?.title || kind;

// What a record is called in a list: what you called it, then what kind it is.
export const recordLine = entry => [entry.title, kindTitle(entry.kind)].filter(Boolean).join(' · ');

// Whether anybody has looked at it lately, said plainly. A record that has only been edited is not confirmed.
export const confirmedWords = record =>
  record?.confirmed ? 'Confirmed ' + whenWords(record.confirmed) : 'Never confirmed';

export const documentWords = record => {
  const many = (record?.documents || []).length;
  return many === 0 ? 'Nothing proves it yet' : many === 1 ? '1 document proves it' : many + ' documents prove it';
};

// Every field of a record, in the order its kind declares them, and then any the kind does not know about: a record
// written by a later build keeps its fields here, under their own names, hidden because nothing declared otherwise.
export function rowsOf(record, { shown = false } = {}) {
  if (!record) return [];
  const held = record.fields || {};
  const declared = fieldsOf(record.kind).map(([name]) => name);
  const rest = Object.keys(held).filter(name => !declared.includes(name));
  return [...declared, ...rest]
    .filter(name => name in held && held[name] !== '')
    .map(name => {
      const hidden = sensitivity(record.kind, name) === 'hidden';
      return {
        name,
        label: labelOf(record.kind, name),
        value: shown || !hidden ? String(held[name]) : shownValue(record.kind, name, held[name]),
        hidden,
        unknown: !declared.includes(name),
      };
    });
}

// Said above a record whose hidden fields are hidden, and when they are not.
export const hidingWords = (record, shown) => {
  const hiding = rowsOf(record).filter(row => row.hidden);
  if (!hiding.length) return '';
  const one = hiding.length === 1;
  const what = one ? 'One field of this record is' : hiding.length + ' fields of this record are';
  return shown ? what + ' shown in full.' : what + ' shown by ' + (one ? 'its' : 'their') + ' last characters only.';
};

// What a share would hand over, in a sentence, so it can be read before anything goes anywhere. It names the parts:
// a share never says "everything".
export function shareWords(share) {
  if (!share) return '';
  const fields = (share.fields || []).map(one => one.label);
  const many = (share.documents || []).length;
  const papers = many === 0 ? '' : many === 1 ? '1 document' : many + ' documents';
  if (!fields.length && !papers) return 'Nothing is chosen yet, so nothing would go.';
  const both = [fields.length ? list(fields) : '', papers].filter(Boolean);
  return 'This would give ' + list(both) + ', and nothing else.';
}

// "a", "a and b", "a, b and c" — the way a person would say it.
function list(items) {
  if (items.length <= 1) return items[0] || '';
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

// Whether a share would hand over something the screen normally hides, which is worth saying out loud.
export const sharingHidden = share => (share?.fields || []).filter(one => one.hidden).map(one => one.label);
export const hiddenWarning = share => {
  const names = sharingHidden(share);
  if (!names.length) return '';
  return names.length === 1
    ? list(names) + ' is normally shown by its last characters only. It would go in full.'
    : list(names) + ' are normally shown by their last characters only. They would go in full.';
};
