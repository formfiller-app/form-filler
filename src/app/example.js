// The example's screen, and the three choices the page now opens with. The invented packet, the words and the small
// sums are in src/lib/example.js, where they are tested without a window; this file only draws them and says what
// each button is called. Nothing here opens a file, sends anything or keeps anything: the example lives for as long
// as the page is open and leaves nothing behind.
import { EMPLOYER, MOVED, OFFICES, PERSON, addressLine, carrying, changed, packet, share, shownValue } from './example-words.js';

// The example as it stands: the invented details, with the address as the person has changed it, and whether the two
// previews have been asked for yet.
export const freshExample = () => ({ details: { ...PERSON }, shown: false });

const row = (field, h, marked) => '<div class="field' + (marked.includes(field.from) ? ' changed' : '') + '" data-field="' + h(field.from) + '">' +
  '<dt>' + h(field.label) + '</dt><dd>' + (field.value ? h(shownValue(field)) : '<i>empty</i>') + '</dd></div>';
const fieldsOf = (form, h, marked = []) => '<dl class="fields">' + form.fields.map(field => row(field, h, marked)).join('') + '</dl>';

// One form drawn as a sheet of paper: its title, who issued it and where it applies, then every blank with what is
// in it. A blank just changed is marked, so one change can be seen on two sheets at once.
const sheet = (form, h, marked = []) => '<section class="example-sheet" data-form="' + h(form.id) + '"><h4>' + h(form.title) + '</h4>' +
  '<p class="from">From ' + h(form.issuer) + ' · applies to ' + h(form.applies) + '</p>' + fieldsOf(form, h, marked) +
  '<p class="signature">Signed ……………………… · Date ' + h(PERSON.startDate) + '</p></section>';

// What one office receives, listed in full: the forms it is sent and every blank in them, with bank numbers shown by
// their last characters as they are everywhere else in Form Filler.
function preview(officeId, details, h) {
  const { office, forms, bank } = share(officeId, details);
  return '<section class="example-share" id="share-' + h(office.id) + '"><h4>' + h(office.name) + '</h4><p class="from">' + h(office.why) + '</p>' +
    '<p class="' + (bank ? 'bank-yes' : 'bank-no') + '">' + (bank ? 'Carries your bank details.' : 'No bank details.') + ' ' + h(office.not) + '</p>' +
    forms.map(form => '<h5>' + h(form.title) + '</h5>' + fieldsOf(form, h)).join('') + '</section>';
}

// The parts of the example that follow the address, each drawn on its own so that typing in a box changes them
// without the page being drawn again (which would take the caret out of the box).
const packetHtml = (state, h) => packet(state.details).map(form => sheet(form, h, changed(state.details))).join('');
const sheetsHtml = (state, h) => carrying('address', state.details).map(form => sheet(form, h, changed(state.details))).join('');
const nowHtml = (state, h) => (changed(state.details).length ? 'Now on both forms below: ' : 'On both forms below: ') + h(addressLine(state.details));
const sharesHtml = (state, h) => OFFICES.map(office => preview(office.id, state.details, h)).join('');

// The three ways in, before any form is open. "Use my own form" is the file picker itself, so a form chosen, dropped
// or pasted here opens exactly as it did before. "Find a form" is not built: it says so and offers nothing.
export const startMarkup = h => '<section class="panel start"><h2>Start here</h2>' +
  '<div class="choices">' +

  '<div class="choice"><h3>Try an example</h3><p>Starting a new job in Indiana: an invented packet of three forms, already filled in. ' +
  'About half a minute, with no form to find and nothing of your own typed in.</p>' +
  '<div class="tools"><button type="button" id="example-start" class="primary">Try an example</button></div></div>' +

  '<div class="choice"><h3>Use my own form</h3><p>A photo, a scan, a screenshot or a PDF of the form you have. It stays on this device.</p>' +
  '<div class="tools"><label class="pick">Choose the form<input id="form-file" type="file" accept="image/*,application/pdf,.pdf"></label>' +
  '<label class="pick small">Open a template<input id="template-file" type="file" accept=".json,application/json"></label></div>' +
  '<p class="hint desk">Or drop a form anywhere on this page, or paste a screenshot of one (⌘V / Ctrl+V).</p></div>' +

  '<div class="choice"><h3>Find a form</h3><p>Ask in plain words — “I’m starting a job in Indiana” — and get the forms that fit, ' +
  'each saying who issued it, where it applies and when it was last checked. The forms in it are invented so far.</p>' +
  '<div class="tools"><button type="button" id="find-start" class="secondary">Find a form</button></div></div>' +
  '</div></section>';

// The example itself, as one screen that grows in three steps: the packet as it arrives, the address changed in one
// place and seen on both forms that carry it, and then what each office receives.
export function exampleMarkup(state, h) {
  const marked = changed(state.details);
  const filled = packet(state.details).reduce((count, form) => count + form.fields.filter(field => field.value).length, 0);
  const box = (id, title, key) => '<label>' + h(title) + '<input id="example-' + id + '" value="' + h(state.details[key] || '') + '" autocomplete="off"></label>';
  return '<section class="panel example-head"><h2>An example: starting a new job in Indiana</h2>' +
    '<p>Everything here is invented: the person, the employer, the credit union, both addresses, the account numbers and the three forms. ' +
    'Nothing is sent, nothing is saved, no vault is made, and none of your own details are asked for.</p>' +
    '<div class="tools"><button type="button" id="example-leave" class="secondary">Leave the example</button></div></section>' +

    '<section class="panel example-step" id="example-packet"><h3>1. The packet, open and filled in</h3>' +
    '<p class="subtle">' + h(EMPLOYER.name) + ' (' + h(EMPLOYER.kind) + ', ' + h(EMPLOYER.where) + ') sent ' + h(PERSON.fullName) + ' three forms. ' +
    'What Form Filler already knew is in them: <b id="example-filled">' + filled + ' blanks</b> across the three.</p>' +
    '<div class="example-forms three">' + packetHtml(state, h) + '</div></section>' +

    '<section class="panel example-step" id="example-address"><h3>2. ' + h(PERSON.fullName) + ' has moved: change the address once</h3>' +
    '<p class="subtle">Type a new address here, or press the button to use the invented one, and watch both forms that carry it. ' +
    'The information sheet does not ask for an address, so it does not change.</p>' +
    '<div class="details example-boxes">' + box('street', 'Street address', 'address') + box('city', 'City', 'city') + box('zip', 'ZIP code', 'zip') + '</div>' +
    '<div class="tools"><button type="button" id="example-move" class="primary">Use the invented new address</button>' +
    '<button type="button" id="example-back" class="secondary"' + (marked.length ? '' : ' disabled') + '>Put the old one back</button></div>' +
    '<p class="now' + (marked.length ? ' changed-now' : '') + '" id="example-now">' + nowHtml(state, h) + '</p>' +
    '<div class="example-forms two" id="example-carrying">' + sheetsHtml(state, h) + '</div></section>' +

    '<section class="panel example-step" id="example-send"><h3>3. What each office receives</h3>' +
    (state.shown
      ? '<p class="subtle">The same packet, split as each office needs it. Both are sent the withholding form; only payroll is sent the one with the bank details on it. ' +
        'Bank numbers are shown by their last characters, as they are everywhere in Form Filler.</p>' +
        '<div class="example-shares" id="example-shares">' + sharesHtml(state, h) + '</div>' +
        '<p class="ends">This is where the example ends. Nothing was sent, nothing was saved, and no vault was made. ' +
        'Sending a packet like this, as one link to the people it is for, is not built yet (docs/PAPERWORK_PROPOSAL.md).</p>'
      : '<p class="subtle">Two previews, side by side: what the people office would receive, and what payroll would receive.</p>' +
        '<div class="tools"><button type="button" id="example-share" class="primary">Show what each office receives</button></div>') +
    '</section>';
}

// Typing in one of the address boxes: only what follows the address is drawn again, so the box keeps its caret and
// what is in it.
export function exampleRefresh(state, root, h) {
  const marked = changed(state.details);
  const put = (selector, html) => { const slot = root.querySelector(selector); if (slot) slot.innerHTML = html; };
  put('#example-packet .example-forms', packetHtml(state, h));
  put('#example-carrying', sheetsHtml(state, h));
  put('#example-now', nowHtml(state, h));
  root.querySelector('#example-now')?.classList.toggle('changed-now', marked.length > 0);
  const back = root.querySelector('#example-back');
  if (back) back.disabled = marked.length === 0;
  if (state.shown) put('#example-shares', sharesHtml(state, h));
}

// The example's own buttons. Returns true when it has dealt with the one pressed, so the page draws itself again.
export function examplePressed(state, id) {
  if (id === 'example-move') { Object.assign(state.details, MOVED); return true; }
  if (id === 'example-back') { Object.assign(state.details, { address: PERSON.address, city: PERSON.city, zip: PERSON.zip }); return true; }
  if (id === 'example-share') { state.shown = true; return true; }
  return false;
}
// Typing in one of the address boxes. Returns true when the box belongs to the example.
export function exampleTyped(state, id, value) {
  const key = { 'example-street': 'address', 'example-city': 'city', 'example-zip': 'zip' }[id];
  if (!key) return false;
  state.details[key] = value;
  return true;
}
