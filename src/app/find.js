// The third way in: finding a form by saying what you are doing. The bank of forms and the matching are in
// find-words.js, which needs no browser; this file is the screen over them.
//
// The screen is written so that typing redraws only the results (findRefresh), not the whole page, so the search box
// keeps its caret and its selection while the results change under it.

import { FORMS, PROMISE_DAYS, TRY_THESE, search, whatHappens } from './find-words.js';

export const freshFind = () => ({ query: '' });

const countLine = found => {
  const all = FORMS.length;
  if (!found.length) return 'None of the ' + all + ' forms here match those words.';
  if (found.length === all) return 'All ' + all + ' invented forms, in the order they were written down.';
  return found.length + ' of ' + all + ' forms match' + (found.length === 1 ? 'es' : '') + ', closest first.';
};

const cardHtml = ({ form, days, overdue }, h) =>
  '<li class="found' + (overdue ? ' stale' : '') + (form.fills ? '' : ' elsewhere') + '" data-form="' + h(form.id) + '">' +
  '<h4>' + h(form.title) + '</h4>' +
  '<p class="summary">' + h(form.summary) + '</p>' +
  '<dl class="about">' +
  '<dt>Issued by</dt><dd>' + h(form.issuer) + '</dd>' +
  '<dt>Applies in</dt><dd>' + h(form.where) + '</dd>' +
  '<dt>Last checked</dt><dd class="checked">' + h(form.checked) +
  (days === null ? '' : ' <span class="ago">(' + days + ' day' + (days === 1 ? '' : 's') + ' ago' +
    (overdue ? ', longer than the ' + PROMISE_DAYS + ' days this bank promises' : '') + ')</span>') + '</dd>' +
  '</dl>' +
  '<p class="happens">' + h(whatHappens(form)) + '</p>' +
  '<p class="official">The official copy lives at <code>' + h(form.official) + '</code> — an invented address, like the form, so it goes nowhere.</p>' +
  '</li>';

const resultsHtml = (state, h) => {
  const found = search(state.query);
  if (!found.length) return '<p class="note" id="find-nothing">Nothing here matches those words, so you get no results rather than made-up ones. ' +
    'Try fewer words, or use your own form instead.</p>';
  return '<ul class="found-list">' + found.map(one => cardHtml(one, h)).join('') + '</ul>';
};

export function findMarkup(state, h) {
  return '<section class="panel find-head"><h2>Find a form</h2>' +
    '<p>Say what you are doing, in your own words. The words you type are matched against the words each form is ' +
    'known by — there is no model in this, and nothing you type leaves this device.</p>' +
    '<p class="subtle">The ' + FORMS.length + ' forms here are invented, every one, and so are their issuers and their ' +
    'addresses on the web. What is real is the shape: each says who issued it, where it applies, and when it was last checked.</p>' +
    '<div class="tools"><button type="button" id="find-leave" class="secondary">Back to the three ways in</button></div></section>' +

    '<section class="panel find-box">' +
    '<label class="wide">What are you doing?' +
    '<input id="find-query" value="' + h(state.query) + '" autocomplete="off" spellcheck="false" placeholder="starting a job in Indiana"></label>' +
    '<div class="tools find-tries"><span class="subtle">Or try:</span>' +
    TRY_THESE.map((query, index) => '<button type="button" class="chip" id="find-try-' + index + '">' + h(query) + '</button>').join('') +
    '<button type="button" id="find-clear" class="secondary small"' + (state.query ? '' : ' disabled') + '>Clear</button></div>' +
    '<p class="count" id="find-count">' + h(countLine(search(state.query))) + '</p>' +
    '<div id="find-results">' + resultsHtml(state, h) + '</div></section>';
}

// Typing redraws the results alone, so the box keeps its caret.
export function findRefresh(state, root, h) {
  const put = (selector, html) => { const slot = root.querySelector(selector); if (slot) slot.innerHTML = html; };
  put('#find-results', resultsHtml(state, h));
  put('#find-count', h(countLine(search(state.query))));
  const clear = root.querySelector('#find-clear');
  if (clear) clear.disabled = !state.query;
}

// The finder's own buttons. Returns true when it has dealt with the one pressed, so the page draws itself again
// (the search box's own value has to change, which a redraw of the results alone would not do).
export function findPressed(state, id) {
  if (id === 'find-clear') { state.query = ''; return true; }
  const match = /^find-try-(\d+)$/.exec(id);
  if (match && TRY_THESE[Number(match[1])] !== undefined) { state.query = TRY_THESE[Number(match[1])]; return true; }
  return false;
}

// Typing in the search box. Returns true when the box belongs to the finder.
export function findTyped(state, id, value) {
  if (id !== 'find-query') return false;
  state.query = value;
  return true;
}
