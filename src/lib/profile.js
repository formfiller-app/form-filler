// Your own details, filled into the blanks that ask for them, by the words of each blank's label. Plain rules, no model:
// "E-mail" gets your email, "Phone" your phone, "City, State, ZIP" all three. A label about someone else ("Emergency
// contact phone", "Patient name", "Supervisor") is left alone. "Date" gets today's date, unless it asks for some
// other date (of birth, a start or end date, a due date).
//
// The details live on the device that holds them; this file only matches them.
export const DETAILS = [
  ['fullName', 'Full name'], ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'],
  ['address', 'Street address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP code'], ['birthDate', 'Date of birth'],
];
const SOMEONE_ELSE = /emergency|supervisor|manager|employer|physician|doctor|provider|reference|spouse|parent|guardian|patient|child|witness|company|business|organi[sz]ation|department|facility|school|agency|insurer|insurance|landlord|owner|beneficiar|vendor|item|product|file|user ?name|web/;

const words = label => ' ' + String(label || '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim() + ' ';

// The detail a label asks for, or null.
export function detailFor(label) {
  const text = words(label);
  if (!text.trim() || SOMEONE_ELSE.test(text)) return null;
  if (/ (e ?mail) /.test(text)) return 'email';
  if (/ (date of birth|dob|birth ?date|birthday) /.test(text)) return 'birthDate';
  if (/ city /.test(text) && / (state|st) /.test(text) && / (zip|postal)/.test(text)) return 'cityStateZip';
  if (/ (phone|telephone|tel|cell|mobile)( |#|no )/.test(text)) return 'phone';
  if (/ (first|given) name /.test(text)) return 'firstName';
  if (/ (last|family) name | surname /.test(text)) return 'lastName';
  if (/ (middle|maiden|nick)/.test(text)) return null;
  if (/ (full )?name /.test(text) || / print(ed)? name /.test(text)) return 'fullName';
  if (/ (street|mailing|home)? ?address /.test(text) && !/ ip /.test(text)) return 'address';
  if (/ (city|town) /.test(text)) return 'city';
  if (/ (state|province) /.test(text)) return 'state';
  if (/ (zip|postal)( code)? /.test(text)) return 'zip';
  return null;
}
export const isDate = label => { const text = words(label); return /\bdate\b/.test(text) && !/\b(birth|dob|start|end|expir\w*|due|admi\w*|discharg\w*|hire|from|to|of service|effective|issue\w*|incident|event|injury|onset|last|surgery|death)\b/.test(text); };
export const isSignatureLabel = label => /signature|sign here|\bsigned\b/i.test(String(label || ''));

export function detailValue(profile, key) {
  const value = key => String(profile?.[key] ?? '').trim();
  if (key === 'fullName') return value('fullName') || [value('firstName'), value('lastName')].filter(Boolean).join(' ');
  if (key === 'cityStateZip') return [value('city'), [value('state'), value('zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return value(key);
}

// Today in the person's chosen way of writing dates: 'us' 11/13/2026, 'iso' 2026-11-13, 'day' 13/11/2026.
export function formatDate(date, style = 'us') {
  const dd = String(date.getDate()).padStart(2, '0'), mm = String(date.getMonth() + 1).padStart(2, '0'), yyyy = date.getFullYear();
  return style === 'iso' ? yyyy + '-' + mm + '-' + dd : style === 'day' ? dd + '/' + mm + '/' + yyyy : mm + '/' + dd + '/' + yyyy;
}

// Which blanks your details fill, and with what: Map of blank index to value. Only text blanks; nothing is filled
// with an empty detail. `today` is a Date, or null to leave dates alone.
export function autofill(blanks, profile, { today = new Date(), dateStyle = profile?.dateStyle || 'us' } = {}) {
  const out = new Map();
  blanks.forEach((blank, index) => {
    // A table's cell labelled by its column's header ("Name", "Date") is one of many rows, not yours: never filled.
    if (blank.kind === 'check' || blank.kind === 'sign' || blank.kind === 'choice' || blank.column || isSignatureLabel(blank.label)) return;
    const key = detailFor(blank.label), value = key ? detailValue(profile, key) : '';
    if (value) out.set(index, value);
    else if (today && isDate(blank.label)) out.set(index, formatDate(today, dateStyle));
  });
  return out;
}

// The privacy wall's fifth part: the details kept off the screen until you ask to see them. A name, a date of birth
// and a street address are on the never-list; an e-mail address, a phone number, a city, a state and a ZIP code are
// not.
export const MASKED = ['fullName', 'firstName', 'lastName', 'address', 'birthDate'];
// A value as it is shown while it is hidden: its last four characters, behind a dot for each of the rest. A short
// value shows less, so that it is never mostly given away: its last two characters up to eight long, none up to four.
export function masked(value) {
  const letters = [...String(value ?? '')], shown = letters.length > 8 ? 4 : letters.length > 4 ? 2 : 0;
  return '\u2022'.repeat(letters.length - shown) + letters.slice(letters.length - shown).join('');
}
