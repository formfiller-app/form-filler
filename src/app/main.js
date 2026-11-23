import './style.css';
import { findBlanks, skewOf, order, labelBlanks } from '../lib/blanks.js';
import { headerLabels } from '../lib/headers.js';
import { placeAnswers, numberedLines } from '../lib/answers.js';
import { buildPdf, joinPdfs, isSignature } from '../lib/output.js';
import { readFields, withFound, pickOption } from '../lib/fields.js';
import { makeTemplate, readTemplate } from '../lib/templates.js';
import { DETAILS, MASKED, masked, detailFor, autofill, isSignatureLabel } from '../lib/profile.js';
import { parseCsv, matchColumns, columnIds, columnsNow, rowValues } from '../lib/merge.js';
import { segmentLines } from '../lib/handwriting.js';
import { HANDWRITING_MODELS } from '../lib/models.js';
import { sha256 } from '../lib/hash.js';
import { browserStore } from '../lib/stores/browser.js';
import { makeKeeper, MIN_PASSPHRASE } from './keep.js';
import { exampleMarkup, examplePressed, exampleRefresh, exampleTyped, freshExample, startMarkup } from './example.js';
import { findMarkup, findPressed, findRefresh, findTyped, freshFind } from './find.js';
import { shell, tauri, pageStore, vaultStore } from './platform.js';

const app = document.getElementById('app');
const asset = path => new URL(import.meta.env.BASE_URL + path, window.location.href).href;
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// Form Filler runs only as itself. Inside another page's frame, or in a window that another page at this same web
// address opened and still holds, that page could read whatever is typed here, so it says so and goes no further.
const held = (() => {
  try { if (window.top !== window) return true; } catch { return true; }
  try { if (window.opener && window.opener.location.href) return true; } catch { /* opened from another site, which cannot reach in */ }
  return false;
})();
if (held) {
  app.innerHTML = '<main><section class="panel"><h1>Form Filler</h1><p>Form Filler does not run inside another page, or in a window that another page opened, because that page could read what you type here.</p>' +
    '<p><a href="' + h(location.href) + '" target="_blank" rel="noopener">Open Form Filler on its own</a></p></section></main>';
  throw new Error('Form Filler will not run inside another page.');
}
try { window.opener = null; } catch { /* nothing to let go of */ }
const MAX_PAGES = 10, WIDTH = 1700;

// What this browser keeps on this device: your details, a signature if you ask, and each form's blanks (by the form's
// fingerprint). Storage can be missing or refused (a private window); then nothing is kept and everything still works.
// In the Mac app the same three calls keep them in the app's data folder instead (platform.js), where a backup finds them.
const store = shell ? pageStore({ onProblem: message => { note = 'That could not be kept on this Mac: ' + message; render(); } }) : {
  get(key, fallback) { try { const value = localStorage.getItem('ff:' + key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('ff:' + key, JSON.stringify(value)); return true; } catch { return false; } },
  drop(key) { try { localStorage.removeItem('ff:' + key); } catch { /* nothing kept */ } },
};

let form = null;          // { name, bytes, hash, pdf, locked, pages: [{ canvas, width, height, pdfPage, angle, scale }] }
let blanks = [];          // [{ id, page, kind, x0, y0, x1, y1, label, field?, options? }]
let answers = '', overrides = {}, busy = '', note = '', adding = false, prints = {}, remembered = false, problems = [];
// Before any form is open the page offers three ways in (example.js): the worked example, your own form, and a form
// found by saying what you are doing (find.js). `example` holds the example while it is being clicked through and
// `finder` the search while it is open; neither keeps anything, and leaving either throws it away.
let example = null, finder = null;
// A saved signature is a PNG picture and nothing else. The browser's storage is shared with every other page at the
// same site address, so what comes back from it is checked before it is used, and escaped where it is written.
const asSignature = value => typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
const asDetails = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string')) : {};
let useDetails = store.get('useDetails', true) !== false, profile = {}, savedSignature = null, confirmForget = false;
// The Mac app's own screens (desk.js: the locker, the archive, backups) are loaded there only; `desk` is what they
// gave back once started. In the app the page's settings arrive from the data folder a moment after the page opens.
const deskLoaded = shell ? import('./desk.js') : null;
let desk = null, lastMade = null;
if (shell) void store.ready.then(() => { useDetails = store.get('useDetails', true) !== false; render(); }, () => {});
// The Mac app keeps your name, date of birth and street address off the screen until you ask to see them (the privacy
// wall's fifth part): in Your details and on the filled form they show by their last characters only.
let revealed = false, shownToPrint = false;
const hides = key => shell && !revealed && MASKED.includes(key);
// Shown only to be printed, they are hidden again at the next thing pressed on the page (unless that is the button
// that hides them, which does it itself).
if (shell) document.addEventListener('click', event => {
  if (!shownToPrint) return;
  shownToPrint = false;
  if (!event.target.closest?.('[data-reveal]')) { revealed = false; setTimeout(render, 0); }
}, true);
// A blank's value as the page shows it: one your details filled, of a hidden kind, by its last characters.
const seen = (blank, index, value, fixed) => typeof value === 'string' && value && fixed.has(index) && !(blank.id in overrides) && value === fixed.get(index) && hides(detailFor(blank.label)) ? masked(value) : value;
// Your details and a saved signature are kept locked in this browser with your passphrase, never in plain text
// (keep.js). Plain copies an earlier version made are read once, checked as above, and gone once locked away.
const keeper = makeKeeper({
  store: shell ? vaultStore() : browserStore(),
  legacy: { read: () => ({ details: asDetails(store.get('profile', {})), signature: asSignature(store.get('signature', null)) }),
    drop: which => { if (which !== 'signature') store.drop('profile'); if (which !== 'details') store.drop('signature'); } },
  onChange: () => { profile = keeper.details; savedSignature = keeper.signature; render(); desk?.changed(); },
  // Locked: your details have left the form, and so does any signature on it, with the PDFs made from them.
  onLock: () => {
    let taken = 0;
    for (const id of Object.keys(overrides)) if (isSignature(overrides[id])) { delete overrides[id]; taken++; }
    readyToSend = null; prints = {}; revealed = false; lastMade = null;
    if (pad.open) pad.close('cancel');
    clearPad();
    note = 'Your details are locked' + (taken ? ', and the signature was taken off the form' : '') + '.';
  },
});
let merge = null;         // { name, headers, rows, columns, unmatched, shared, ids }: columns as matched when opened; ids keep them to their blanks
let hand = null;          // { lines: [{ img, text, done }], model }
let pendingTemplate = null, pendingMark = null;
// 2 when the open form's blanks were named this version's way (a checkbox by its own caption, on either side): set
// by a fresh find, carried by remembered forms and template files as `labels`, so an older one can be told apart.
let labelsMark = null;
// Blanks named by an earlier version (no mark of 2), with checkboxes it found on the page: it named a checkbox by the
// words on its left, so the box beside "Day" could be called "Shift" and the next one "Day". Checkboxes added by hand
// and a PDF's own checkbox fields were not named by it, so they do not count. Said wherever such blanks are put in place.
const earlierLabels = mark => mark !== 2 && blanks.some(blank => !blank.field && blank.kind === 'check' && blank.label !== 'added by hand');
const EARLIER = 'by an earlier version, which could give a checkbox the words of the box before it.';
const AGAIN = ' Tap “Find the blanks again” to name the checkboxes again; a blank you added or removed by hand would need doing again.';
let nextId = 1;

// The value in each blank, in order of who has the last word: what you typed on the form itself, then your answers
// (in order, passing over blanks your details filled; a numbered answer still lands where it says), then your details
// and today's date.
function current() {
  const fixed = useDetails ? autofill(blanks, profile, { today: new Date() }) : new Map();
  const { values, extra } = placeAnswers(blanks, answers, { skip: new Set(fixed.keys()) });
  const finals = blanks.map((blank, index) => blank.id in overrides ? overrides[blank.id] : values[index] !== '' && values[index] !== false ? values[index] : fixed.get(index) ?? values[index]);
  return { finals, extra, fixed };
}

async function reader() {
  const { createWorker } = await import('tesseract.js');
  return createWorker('eng', 1, { workerPath: asset('ocr/worker.min.js'), corePath: asset('ocr'), langPath: asset('ocr'), workerBlobURL: false, cacheMethod: 'none' });
}
const grayOf = canvas => { const { width, height } = canvas, data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data, gray = new Uint8Array(width * height);
  for (let at = 0; at < gray.length; at++) gray[at] = (data[at * 4] * 299 + data[at * 4 + 1] * 587 + data[at * 4 + 2] * 114) / 1000; return gray; };
const canvasOf = (width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); return canvas; };
// Gray pixels (one byte each) as a canvas the reader can read.
const pictureOf = (pixels, width, height) => { const canvas = canvasOf(width, height), context = canvas.getContext('2d'), image = context.createImageData(width, height);
  for (let at = 0; at < pixels.length; at++) { image.data[at * 4] = image.data[at * 4 + 1] = image.data[at * 4 + 2] = pixels[at]; image.data[at * 4 + 3] = 255; }
  context.putImageData(image, 0, 0); return canvas; };
const imageCanvas = async source => { const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' }); return bitmap; };

// The form, as pictures of its pages: a PDF page drawn, or a photo turned upright, shrunk to a working size and
// straightened if it was taken a little crooked.
const isPdf = file => /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
// `withoutFields`: draw a PDF page without its own fill-in fields, when those fields are the blanks (otherwise what a
// field already holds, such as a default choice, shows through under the answer that will replace it).
async function pagesOf(file, bytes, withoutFields = false) {
  if (isPdf(file)) {
    // pdf.js's "legacy" build: the same reader, carrying its own copies of the newest JavaScript features, so a PDF
    // also opens in a browser a year or two old (there the ordinary build stops with "getOrInsertComputed is not a function").
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise, pages = [];
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number++) {
      const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 }), scale = WIDTH / base.width, viewport = page.getViewport({ scale });
      const canvas = canvasOf(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode: withoutFields ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.ENABLE }).promise;
      pages.push({ canvas, width: canvas.width, height: canvas.height, pdfPage: number - 1, angle: 0, scale });
    }
    return { pdf: true, pages, more: Math.max(0, pdf.numPages - MAX_PAGES) };
  }
  const bitmap = await imageCanvas(file).catch(() => { throw new Error('That picture could not be opened here. Save it as a JPEG, PNG or PDF and try again.'); });
  const scale = Math.min(1, WIDTH / bitmap.width, 2800 / bitmap.height);
  let canvas = canvasOf(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const angle = skewOf(grayOf(canvas), canvas.width, canvas.height);
  if (Math.abs(angle) >= 0.2) {
    const turned = canvasOf(canvas.width, canvas.height), context = turned.getContext('2d');
    context.translate(turned.width / 2, turned.height / 2); context.rotate(-angle * Math.PI / 180); context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    canvas = turned;
  }
  return { pdf: false, pages: [{ canvas, width: canvas.width, height: canvas.height, pdfPage: null, angle }], more: 0 };
}

// A form's blanks, remembered by its fingerprint, without the page pictures (the form itself is open).
const templateNow = withImages => makeTemplate({ form: { sha256: form.hash, name: form.name, type: form.pdf ? 'pdf' : 'image' },
  pages: form.pages.map(page => ({ ...page, image: withImages && !form.pdf ? page.canvas.toDataURL('image/jpeg', 0.85) : undefined })), blanks });
// A remembered form, or a template file, carries `labelsMark` as `labels` (see above); readTemplate ignores it.
const marked = template => ({ ...template, ...(labelsMark ? { labels: labelsMark } : {}) });
// Remembered without the file's name, which can hold a person's (the open file brings its own name).
const remember = () => { if (form) { const template = marked(templateNow(false)); template.form = { ...template.form, name: '' }; store.set('template:' + form.hash, template); } };
// The reader's words, with their letters: a caption the reader ran into a checkbox's square is cut at the square
// letter by letter (see cleanWords).
const wordsOf = data => (data.blocks || []).flatMap(block => block.paragraphs || []).flatMap(paragraph => paragraph.lines || []).flatMap(line => line.words || [])
  .map(word => ({ text: word.text, confidence: word.confidence, bbox: word.bbox, symbols: (word.symbols || []).map(symbol => ({ text: symbol.text, confidence: symbol.confidence, bbox: symbol.bbox })) }));
// A template fits a form whose pages have the same shapes; its blanks are scaled to the size the pages are drawn at
// here (a template made by the command line from a PDF's own fields is in points, the page's in pixels).
const fits = template => template.pages.length === form.pages.length && template.pages.every((page, index) => Math.abs(page.width / page.height - form.pages[index].width / form.pages[index].height) < 0.01);
const useTemplate = template => {
  blanks = template.blanks.map(blank => { const from = template.pages[blank.page], to = form.pages[blank.page], sx = to.width / from.width, sy = to.height / from.height;
    return { ...blank, x0: blank.x0 * sx, x1: blank.x1 * sx, y0: blank.y0 * sy, y1: blank.y1 * sy, id: nextId++ }; });
  // A template keeps a radio group as one blank; the buttons inside it come from the PDF itself, when it is open.
  for (const blank of blanks) { const own = blank.choice === 'radio' && blank.field ? (form.fields || []).find(field => field.field === blank.field && field.spots) : null; if (own) blank.spots = own.spots; }
  overrides = {};
};

async function openForm(file) {
  busy = 'Opening the form…'; note = ''; problems = []; pendingTemplate = null; pendingMark = null; example = null; finder = null; render();
  try {
    if (shell) await store.ready.catch(() => {});   // the forms remembered in the app's data folder
    const bytes = await file.arrayBuffer(), own = isPdf(file) ? await readFields(bytes) : null;
    const usable = Boolean(own && !own.encrypted && !own.rotated && own.blanks.length), { pdf, pages, more } = await pagesOf(file, bytes, usable);
    form = { name: file.name, bytes, hash: await sha256(bytes), pdf, locked: Boolean(own?.encrypted), pages };
    blanks = []; overrides = {}; prints = {}; remembered = false; merge = null; labelsMark = null; lastMade = null;
    const notes = [];
    if (more) notes.push('Only the first ' + MAX_PAGES + ' pages are shown; the other ' + more + (own?.encrypted ? ' cannot be carried into the filled copy, because this PDF is locked.' : ' are kept as they are.'));
    let fields = [];
    if (own) {
      if (own.encrypted) notes.push('This PDF is locked against changes, so the filled copy is made from pictures of its pages.');
      else if (own.rotated) notes.push('This PDF has turned pages, so its own fill-in fields are not used; the blanks are found from the page instead.');
      else fields = own.blanks.filter(blank => blank.page < pages.length).map(blank => { const { scale } = pages[blank.page], sized = box => ({ ...box, x0: box.x0 * scale, x1: box.x1 * scale, y0: box.y0 * scale, y1: box.y1 * scale });
        return { ...sized(blank), ...(blank.spots ? { spots: blank.spots.map(sized) } : {}) }; });
      if (own.xfa && !fields.length) notes.push('This PDF is an XFA form (an Adobe-only kind). Its own fields cannot be read here; blanks are found from what the page shows.');
      form.fieldCount = fields.length;
    }
    form.fields = fields;
    const saved = store.get('template:' + form.hash, null);
    let template = null;
    try { template = saved ? readTemplate(saved) : null; } catch { template = null; }
    if (template && fits(template)) {
      useTemplate(template); remembered = true; labelsMark = saved.labels ?? null;
      // Not found again silently: blanks added or removed by hand would be lost.
      if (earlierLabels(labelsMark)) notes.push('This form was remembered ' + EARLIER + AGAIN);
    }
    else {
      const ocr = await reader();
      try {
        for (const [index, page] of pages.entries()) {
          busy = 'Finding the blanks' + (pages.length > 1 ? ' on page ' + (index + 1) + ' of ' + pages.length : '') + '…'; render();
          await ocr.setParameters({ tessedit_pageseg_mode: '3' });
          const { data } = await ocr.recognize(page.canvas, {}, { blocks: true, text: false });
          const words = wordsOf(data);
          const heights = words.filter(word => word.confidence > 50).map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b), textHeight = heights.length ? heights[Math.floor(heights.length / 2)] : undefined;
          // The blank finder measures by the page, not by the reader's guess at the text size: the reader's guess makes
          // letters look like checkboxes on some pages. The text size is used only to find each blank's label.
          const gray = grayOf(page.canvas);
          let found = labelBlanks(findBlanks(gray, page.width, page.height).map(blank => ({ ...blank, page: index })), words, textHeight || 20);
          // The page's read misses the words of a table's header row: each header cell is read on its own, twice.
          await ocr.setParameters({ tessedit_pageseg_mode: '6' });
          found = await headerLabels(gray, page.width, page.height, found, textHeight || 20, (pixels, width, height) => ocr.recognize(pictureOf(pixels, width, height), {}, { blocks: true, text: false }).then(({ data }) => ({ words: wordsOf(data) })));
          for (const blank of order(withFound(fields.filter(field => field.page === index), found), textHeight || 20)) blanks.push({ ...blank, id: nextId++, page: index });
        }
      } finally { await ocr.terminate(); }
      labelsMark = 2; remember();
    }
    if (!blanks.length) notes.push('No blanks were found. Add them by hand: tap “Add or remove a blank”, then drag across each place to write.');
    note = notes.join(' ');
  } catch (error) { form = null; note = error.message || String(error); }
  busy = ''; render();
  if (form && matchMedia('(pointer: fine)').matches) document.getElementById('answers')?.focus({ preventScroll: true });
}

// A form opened from a template file alone: possible when the template carries its page pictures (a photographed form).
async function openFromTemplate(template) {
  const pages = await Promise.all(template.pages.map(async page => {
    const bitmap = await createImageBitmap(await (await fetch(page.image)).blob()), canvas = canvasOf(page.width, page.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, page.width, page.height);
    return { canvas, width: page.width, height: page.height, pdfPage: null, angle: page.angle };
  }));
  form = { name: template.form.name || 'form from template', bytes: null, hash: template.form.sha256, pdf: false, locked: false, pages };
  useTemplate(template); remembered = true; prints = {}; merge = null; problems = []; example = null; finder = null;
}

async function openTemplateFile(file) {
  try {
    const text = await file.text(), template = readTemplate(text);
    let mark = null;
    try { mark = JSON.parse(text).labels ?? null; } catch { /* readTemplate has read it */ }
    pendingTemplate = null; pendingMark = null;              // an offer made for an earlier template file lapses
    if (form && template.form.sha256 === form.hash) {
      if (!fits(template)) throw new Error('This template is for this form, but its pages are a different shape from the form’s.');
      useTemplate(template); labelsMark = mark; remember(); remembered = true;
      note = 'The template’s ' + blanks.length + ' blanks are in place.' + (earlierLabels(mark) ? ' It was saved ' + EARLIER + AGAIN : '');
    } else if (template.form.type === 'image' && template.pages.every(page => page.image)) {
      // Opened from its own pictures, there is no form file here to find the blanks on again.
      await openFromTemplate(template); labelsMark = mark; remember();
      note = 'Opened the form from the template file itself.' + (earlierLabels(mark) ? ' The template was saved ' + EARLIER + ' To name them again, open the original form and tap “Find the blanks again”.' : '');
    } else if (form && fits(template)) {
      pendingTemplate = template; pendingMark = mark;
      note = 'This template was made for a different file (' + (template.form.name || 'no name') + ', fingerprint ' + template.form.sha256.slice(0, 12) + '…), though its pages are the same size as this form’s.';
    } else note = 'This template is for ' + (template.form.name || 'another form') + ' (fingerprint ' + template.form.sha256.slice(0, 12) + '…). Open that form first, then the template.';
  } catch (error) { note = error.message || String(error); }
  render();
}

// Answers from a photo of a printed or typed page: read with the same text reader as the form. It goes into the
// answers box to be corrected, never straight onto the form.
async function readPrinted(file) {
  busy = 'Reading your answers from the photo…'; render();
  try {
    const bitmap = await imageCanvas(file), scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height)), canvas = canvasOf(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const ocr = await reader();
    let numbered = 0, left = [];
    try { await ocr.setParameters({ tessedit_pageseg_mode: '4' }); const { data } = await ocr.recognize(canvas); const read = numberedLines((data.text || '').trim(), blanks.length); numbered = read.numbered; left = read.unnumbered; answers = (answers.trim() ? answers.trim() + '\n' : '') + read.text; }
    finally { await ocr.terminate(); }
    note = (numbered ? numbered + ' lines start with a blank’s number, so each goes to that blank. ' : '') + unplaced(left) + 'Check what was read before you use it.';
  } catch (error) { note = 'The photo could not be read: ' + (error.message || error); }
  busy = ''; render();
}

// Handwriting: the page is cut into its lines here, and each line is read by a handwriting model running in this
// browser (in a worker, so the page stays usable). The model is downloaded from Hugging Face the first time, at a
// pinned revision; the photo itself never leaves the device. Each line is shown as its own picture beside what was
// read, so a wrong word is easy to see and fix.
let worker = null;
async function readHandwriting(file) {
  const choice = store.get('handModel', 'small'), model = HANDWRITING_MODELS[choice] || HANDWRITING_MODELS.small;
  busy = 'Finding the lines of writing…'; render();
  try {
    const bitmap = await imageCanvas(file), scale = Math.min(1, 1800 / bitmap.width, 2600 / bitmap.height), canvas = canvasOf(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const lines = segmentLines(grayOf(canvas), canvas.width, canvas.height);
    if (!lines.length) throw new Error('No lines of writing were found in that photo.');
    hand = { model: choice, lines: lines.map(line => { const crop = canvasOf(line.x1 - line.x0, line.y1 - line.y0); crop.getContext('2d').drawImage(canvas, line.x0, line.y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return { img: crop.toDataURL('image/jpeg', 0.8), text: '', done: false, pixels: context.getImageData(line.x0, line.y0, crop.width, crop.height) }; }) };
    busy = 'Getting the handwriting reader (' + model.title.toLowerCase() + ', about ' + model.megabytes + ' MB, the first time only)…'; render();
    worker ??= new Worker(new URL('./handwriting-worker.js', import.meta.url), { type: 'module' });
    const files = {};
    await new Promise((resolve, reject) => {
      let next = 0;
      const send = () => { const line = hand.lines[next]; worker.postMessage({ type: 'read', index: next, model, base: asset(''), width: line.pixels.width, height: line.pixels.height, data: line.pixels.data }); };
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress' && data.total) {
          files[data.file] = [data.loaded, data.total];
          const [loaded, total] = Object.values(files).reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
          const slot = app.querySelector('.busy'); if (slot) slot.firstChild.textContent = 'Getting the handwriting reader: ' + Math.round(loaded / 1e6) + ' of ' + Math.round(total / 1e6) + ' MB (the first time only)…';
        } else if (data.type === 'read') {
          Object.assign(hand.lines[data.index], { text: data.text, done: true });
          next++; busy = 'Reading line ' + Math.min(next + 1, hand.lines.length) + ' of ' + hand.lines.length + '…'; render();
          if (next < hand.lines.length) send(); else resolve();
        } else if (data.type === 'error') reject(new Error(data.message));
      };
      worker.onerror = event => reject(new Error(event.message || 'The handwriting reader stopped.'));
      send();
    });
    for (const line of hand.lines) delete line.pixels;
    note = 'Each line is beside what was read. Fix any word that is wrong, then put the lines in your answers.';
  } catch (error) { note = 'The handwriting could not be read: ' + (error.message || error); if (hand && !hand.lines.some(line => line.done)) hand = null; }
  busy = ''; render();
}

const unplaced = lines => lines.length ? 'Left out, because no blank number could be read at the start: ' + lines.map(line => '“' + line + '”').join(', ') + '. Type those in with their number, like “9) yes”. ' : '';
function reorder() {
  blanks = form.pages.flatMap((_, page) => order(blanks.filter(blank => blank.page === page), 20).map(blank => blanks.find(item => item.id === blank.id) || blank));
}

const signable = blank => blank.kind === 'sign' || (blank.kind !== 'check' && blank.kind !== 'choice' && isSignatureLabel(blank.label));
const blankName = (blank, number) => 'Blank ' + (number + 1) + (blank.label ? ', ' + h(blank.label) : blank.unsure ? ', label unclear' : '');
// A checkbox whose caption could not be told is shown as unclear, with the words it might be.
const unclear = blank => 'unclear: ' + blank.unsure.map(word => '“' + h(word) + '”').join(' or ') + (blank.unsure.length === 1 ? '?' : '');
function blankInput(blank, number, value, hidden = null) {
  const name = ' data-blank="' + blank.id + '" aria-label="' + blankName(blank, number) + '"';
  if (hidden !== null) return '<input' + name + ' value="' + h(hidden) + '" readonly title="Hidden. Press “Show them” to see or change it.">';
  if (isSignature(value)) return '<img class="signed" alt="Signature" src="' + h(value.signature) + '"><button type="button" class="unsign" data-unsign="' + blank.id + '" aria-label="Take the signature off blank ' + (number + 1) + '">×</button>';
  if (blank.kind === 'check') return '<input type="checkbox"' + name + (value ? ' checked' : '') + '>';
  // A radio group: a button over each of the form's own buttons, so the words printed beside them stay readable.
  if (blank.kind === 'choice' && blank.spots?.length) {
    const picked = pickOption(blank.options, value), width = blank.x1 - blank.x0, height = blank.y1 - blank.y0, pct = (part, whole) => (part / whole * 100).toFixed(3) + '%';
    return blank.spots.map(spot => '<input type="radio" class="spot" name="radio-' + blank.id + '" data-blank="' + blank.id + '" value="' + h(spot.option) + '" aria-label="' + blankName(blank, number) + ': ' + h(spot.option) + '"' +
      ' style="left:' + pct(spot.x0 - blank.x0, width) + ';top:' + pct(spot.y0 - blank.y0, height) + ';width:' + pct(spot.x1 - spot.x0, width) + ';height:' + pct(spot.y1 - spot.y0, height) + '"' + (spot.option === picked ? ' checked' : '') + '>').join('') +
      (value && !picked ? '<span class="radio-miss" title="“' + h(value) + '” is not one of its choices">?</span>' : '');
  }
  if (blank.kind === 'choice') { const picked = pickOption(blank.options, value); return '<select' + name + (value && !picked ? ' class="unmatched" title="“' + h(value) + '” is not one of its choices"' : '') + '><option value=""></option>' + blank.options.map(option => '<option' + (option === picked ? ' selected' : '') + '>' + h(option) + '</option>').join('') + '</select>'; }
  const sign = signable(blank) && !adding ? '<button type="button" class="sign" data-sign="' + blank.id + '">Sign</button>' : '';
  return (blank.y1 - blank.y0 > 90 || blank.multiline ? '<textarea' + name + '>' + h(value) + '</textarea>' : '<input' + name + ' value="' + h(value) + '">') + sign;
}
function pageMarkup(page, index, values, fixed) {
  const mine = blanks.map((blank, number) => [blank, number]).filter(([blank]) => blank.page === index), pct = (value, total) => (value / total * 100).toFixed(3) + '%';
  return '<section class="sheet' + (adding ? ' adding' : '') + '" data-page="' + index + '"><img alt="Page ' + (index + 1) + ' of the form" src="' + page.canvas.toDataURL('image/jpeg', 0.85) + '">' +
    mine.map(([blank, number]) => {
      const style = 'left:' + pct(blank.x0, page.width) + ';top:' + pct(blank.y0, page.height) + ';width:' + pct(blank.x1 - blank.x0, page.width) + ';height:' + pct(blank.y1 - blank.y0, page.height);
      const shownAs = seen(blank, number, values[number], fixed);
      return '<div class="blank ' + blank.kind + (fixed.has(number) && !(blank.id in overrides) ? ' mine' : '') + '" style="' + style + '"><span class="tag">' + (number + 1) + '</span>' + blankInput(blank, number, values[number], shownAs === values[number] ? null : shownAs) +
        (adding ? '<button type="button" class="remove" data-remove="' + blank.id + '" aria-label="Remove blank ' + (number + 1) + '">×</button>' : '') + '</div>';
    }).join('') + '</section>';
}
const shown = (blank, value) => isSignature(value) ? '✍ signed' : blank.kind === 'check' ? (value ? '☑' : '☐')
  : blank.kind === 'choice' && value ? (pickOption(blank.options, value) ? '<b>' + h(pickOption(blank.options, value)) + '</b>' : '<b class="miss">' + h(value) + '</b> (not one of: ' + h(blank.options.join(', ')) + ')') : '<b>' + h(value || '—') + '</b>';
const listMarkup = (values, fixed) => blanks.map((blank, index) => '<li><span class="label' + (!blank.label && blank.unsure ? ' unsure" title="Which words belong to this box could not be told. Check it on the form.' : '') + '">' + (!blank.label && blank.unsure ? unclear(blank) : h(blank.label || (blank.kind === 'check' ? 'checkbox' : 'blank'))) + '</span> ' + shown(blank, seen(blank, index, values[index], fixed)) + (fixed.has(index) && !(blank.id in overrides) && values[index] === fixed.get(index) ? ' <span class="from">filled for you</span>' : '') + '</li>').join('');

// The recovery key in groups of six, easier to copy onto paper (spaces do not matter when it is typed back).
const grouped = key => key.slice(0, 16) + ' ' + key.slice(16).match(/.{1,6}/g).join(' ');
function detailsPanel() {
  const state = keeper.state, button = (id, title, kind = 'secondary') => '<button type="button" id="' + id + '" class="' + kind + '">' + title + '</button>';
  const secret = (name, title, auto) => '<label>' + title + '<input type="password" name="' + name + '" autocomplete="' + auto + '"></label>';
  const choose = (name, title) => '<div class="details passphrase">' + secret(name, title + ' (at least ' + MIN_PASSPHRASE + ' characters; a few unrelated words are best)', 'new-password') + secret(name + '-again', 'The same passphrase again', 'new-password') + '</div>';
  // A hidden detail has no box of its own: what is shown in its place cannot be typed in, and saving leaves it as it is.
  const box = (key, title) => hides(key) && profile[key] ? '<label>' + h(title) + '<input name="hidden-' + key + '" value="' + h(masked(profile[key])) + '" readonly autocomplete="off"></label>'
    : '<label>' + h(title) + '<input name="detail-' + key + '" value="' + h(profile[key] || '') + '" autocomplete="off"></label>';
  const reveal = shell && MASKED.some(key => profile[key]) ? '<p class="subtle">' + (revealed ? 'Your name, date of birth and street address are shown. ' : 'Your name, date of birth and street address are shown by their last characters only. ') +
    '<button type="button" data-reveal class="secondary">' + (revealed ? 'Hide them again' : 'Show them') + '</button></p>' : '';
  const inputs = reveal + '<div class="details">' + DETAILS.map(([key, title]) => box(key, title)).join('') +
    '<label>Dates written as<select name="detail-dateStyle">' + [['us', '11/13/2026'], ['iso', '2026-11-13'], ['day', '13/11/2026']].map(([value, title]) => '<option value="' + value + '"' + ((profile.dateStyle || 'us') === value ? ' selected' : '') + '>' + title + '</option>').join('') + '</select></label></div>';
  const unlock = '<div class="details unlock"><label>Your passphrase, or your recovery key<input type="password" id="unlock-secret" autocomplete="current-password"></label></div>';
  const forget = confirmForget ? '<p class="warn">' + (shell ? 'This removes your details, your saved signature and every document in your locker from this Mac for good: they cannot be brought back. Your archive and your backups are not touched.'
    : 'This removes your details and saved signature from this browser for good: they cannot be brought back.') + '</p><div class="tools">' + button('forget-yes', 'Yes, forget them', 'primary') + button('forget-no', 'Keep them') + '</div>' : '';
  const tools = (...buttons) => confirmForget ? forget : '<div class="tools">' + buttons.join('') + '</div>';
  const stray = keeper.stray ? '<p class="warn">This browser also holds details in plain text beside your locked ones. This version never writes them, so another page at this address may have put them there. They are not used.</p><div class="tools">' + button('forget-stray', 'Forget the plain copies') + '</div>' : '';
  let body;
  if (state === 'checking') body = '<p class="subtle">Looking for your saved details…</p>';
  else if (keeper.legacy) body = '<p class="warn">An earlier version of this page kept these details in this browser in plain text, where another page could read them. ' +
    (state === 'none' ? 'Choose a passphrase to lock them away, or forget them.</p>' + inputs + choose('passphrase', 'A passphrase') + tools(button('save-details', 'Lock them away', 'primary'), button('forget-details', 'Forget them'))
      : 'This browser keeps nothing else here, so they cannot be locked away: forget them, or use them as they are.</p>' + inputs + tools(button('save-details', 'Use these details', 'primary'), button('forget-details', 'Forget them')));
  else if (state === 'locked') body = stray + '<p class="subtle">Your details are kept here, locked.</p>' + unlock + tools(button('unlock', 'Unlock', 'primary'), button('forget-details', 'Forget my details'));
  else if (state === 'none') body = inputs + choose('passphrase', 'A passphrase to lock them with') + tools(button('save-details', 'Save my details', 'primary'));
  else if (state === 'open') body = stray + inputs + tools(button('save-details', 'Save my details', 'primary'), button('lock-now', 'Lock now'), button('forget-details', 'Forget my details')) +
    '<details class="more"><summary>Change my passphrase</summary>' + choose('passphrase-change', 'A new passphrase') + '<div class="tools">' + button('change-passphrase', 'Change it') + '</div></details>';
  else body = inputs + '<p class="subtle">This browser keeps nothing here (a private window?), so your details last until you close the page.</p>' + tools(button('save-details', 'Use these details', 'primary'));
  const recovery = keeper.recoveryKey ? '<div class="recovery" id="recovery-key"><h3>Your recovery key</h3><p>If you forget your passphrase, this is the only way back to your details. Print it or write it down, and keep it somewhere safe; it is shown only now.</p>' +
    '<code>' + h(grouped(keeper.recoveryKey)) + '</code><div class="tools">' + button('print-key', 'Print it') + button('key-kept', 'I have kept it', 'primary') + '</div></div>' : '';
  return '<details class="panel" id="details-panel"' + (store.get('detailsOpen', false) || keeper.recoveryKey || keeper.legacy ? ' open' : '') + '><summary><h2>Your details</h2></summary>' +
    '<p class="subtle">Filled into any blank whose label asks for them (Name, Phone, E-mail, City, State, ZIP…), and “Date” blanks get today. Kept ' + (shell ? 'on this Mac only' : 'in this browser on this device only') + ', locked with a passphrase you choose, and never sent anywhere.</p>' +
    recovery + body + (savedSignature && state !== 'locked' ? '<p class="subtle">Your saved signature: <img class="saved-sign" alt="Saved signature" src="' + h(savedSignature) + '"> <button type="button" id="forget-signature" class="secondary">Forget it</button></p>' : '') + '</details>';
}
// Saving: with the vault open, locked away at once; with none yet, a vault made with the passphrase typed twice.
// What was typed is remembered for the page first, so nothing is lost if the passphrase is refused.
async function saveDetails() {
  const field = name => app.querySelector('[name=' + name + ']'), value = name => field(name)?.value || '';
  // A detail that is hidden has no box of its own on the page, so it stays as it is.
  const details = Object.fromEntries([...DETAILS.map(([key]) => key), 'dateStyle'].map(key => [key, field('detail-' + key) ? value('detail-' + key).trim() : profile[key] || '']).filter(([, item]) => item));
  if (keeper.state === 'none') {
    const passphrase = value('passphrase'), again = value('passphrase-again');
    await keeper.save({ details });
    if (passphrase !== again) note = 'The two passphrases are not the same.';
    else { note = 'Locking your details away…'; render(); try { await keeper.create(passphrase); note = 'Your details are saved, locked with your passphrase. Keep the recovery key below.'; } catch (error) { note = error.message; } }
  } else {
    const kept = await keeper.save({ details }).catch(error => (note = error.message, null));
    if (kept) note = kept === 'kept' ? 'Your details are saved, locked with your passphrase.' : kept === 'locked' ? 'Unlock your details first; then save your changes.' : 'This browser keeps nothing here, so your details last until you close the page.';
  }
  render();
}
async function unlockDetails() {
  const secret = app.querySelector('#unlock-secret')?.value || '';
  if (!secret) { note = 'Type your passphrase, or your recovery key.'; render(); return; }
  note = 'Unlocking…'; render();
  try {
    const unreadable = await keeper.unlock(secret);
    note = unreadable ? 'Unlocked, but your saved details could not be read (' + unreadable + ') Save them again.' : 'Your details are unlocked. They lock again after 15 minutes left alone, or when you close the page.';
  }
  catch (error) { note = error.code === 'EPASSPHRASE' ? error.message.replace('this vault', 'your details') + (/passphrase/.test(error.message) ? ' If it is forgotten, your recovery key opens them.' : '') : error.message; }
  render();
}
async function changePassphrase() {
  const value = name => app.querySelector('[name=' + name + ']')?.value || '';
  if (value('passphrase-change') !== value('passphrase-change-again')) { note = 'The two passphrases are not the same.'; render(); return; }
  try { await keeper.changePassphrase(value('passphrase-change')); note = 'Your passphrase is changed. Your recovery key still opens your details.'; } catch (error) { note = error.message; }
  render();
}
// Printing the recovery key prints that box alone (style.css).
function printKey() {
  const root = document.documentElement, done = () => { root.classList.remove('print-key'); window.removeEventListener('afterprint', done); };
  root.classList.add('print-key'); window.addEventListener('afterprint', done);
  if (!shell) { window.print(); return; }
  // The Mac app prints its page itself, and does not say when it is done: the box stays alone on the page until the
  // next thing done on it.
  const after = () => { done(); for (const kind of ['pointerdown', 'keydown']) document.removeEventListener(kind, after, true); };
  for (const kind of ['pointerdown', 'keydown']) document.addEventListener(kind, after, true);
  printPage();
}
// Printing the page. The Mac app is asked to print it (print_page), and what is hidden is shown first: a printed form
// must carry your details whole.
function printPage() {
  if (!shell) { window.print(); return; }
  if (!revealed && !document.documentElement.classList.contains('print-key')) { revealed = true; render(); setTimeout(() => { shownToPrint = true; }, 0); }
  void tauri.invoke('print_page').catch(error => { note = 'The page could not be printed: ' + (error.message || error); render(); });
}
function mergePanel() {
  if (!form) return '';
  return '<details class="panel" id="merge-panel"' + (merge ? ' open' : '') + '><summary><h2>Many copies from a spreadsheet</h2></summary>' +
    '<p class="subtle">One filled copy of this form for each row of a spreadsheet saved as CSV. A column fills the blank it names: by number (“3”), by label (“Name”), or by the PDF field’s own name. Blanks no column names keep what is on the form now.</p>' +
    '<div class="tools"><button type="button" id="csv-blank" class="secondary">Get a CSV with this form’s columns</button><label class="pick small">Open a CSV<input id="csv-file" type="file" accept=".csv,text/csv"></label></div>' +
    (merge ? mergeList() : '') + '</details>';
}
// Each column keeps to the blank it was matched to when the CSV was opened, by the blank's id: a blank added or removed
// by hand afterwards moves the numbers, not the columns.
const mergeColumns = () => columnsNow(blanks, merge.ids);
function mergeList() {
  const columns = mergeColumns();
  return '<p>' + h(merge.name) + ': ' + merge.rows.length + ' row' + (merge.rows.length === 1 ? '' : 's') + '.</p><ul class="columns">' + merge.headers.map((header, index) => '<li><b>' + h(header || '(no heading)') + '</b> → ' +
    (columns[index] === null ? '<span class="miss">' + (merge.ids[index] !== null ? 'its blank was removed' : merge.shared.includes(header) ? 'two blanks have this label: use the blank’s number instead' : 'matches no blank') + '</span>' : 'blank ' + (columns[index] + 1) + (blanks[columns[index]]?.label ? ' (' + h(blanks[columns[index]].label) + ')' : '')) + '</li>').join('') + '</ul>' +
    '<div class="tools"><button type="button" id="merge-go" class="primary"' + (merge.rows.length && columns.some(column => column !== null) ? '' : ' disabled') + '>Make one PDF of ' + merge.rows.length + ' filled cop' + (merge.rows.length === 1 ? 'y' : 'ies') + '</button></div>';
}
function handPanel() {
  if (!hand) return '';
  return '<div class="hand"><h3>Read from your handwriting</h3><ol>' + hand.lines.map((line, index) => '<li><img alt="Line ' + (index + 1) + ' as written" src="' + line.img + '"><input data-hand="' + index + '" aria-label="Line ' + (index + 1) + ' as read" value="' + h(line.text) + '"' + (line.done ? '' : ' placeholder="reading…"') + '></li>').join('') + '</ol>' +
    '<div class="tools"><button type="button" id="hand-use" class="primary"' + (hand.lines.some(line => line.done) ? '' : ' disabled') + '>Put these lines in my answers</button><button type="button" id="hand-drop" class="secondary">Throw these away</button></div></div>';
}

// The file pickers are kept from one drawing of the page to the next, not made again. The page draws itself again at
// times nobody chose (when the vault has been read, just after the page opens; when it locks; when another tab
// changes it), and a file chosen just then would land on a picker no longer on the page, and nothing would open. A
// picker that had the keyboard's focus keeps it. One not drawn this time (its form has gone) is let go, and taken out
// of the page it was on: held, it would hold that whole page in memory, your details on it even after the vault locks.
const pickers = new Map();
function keepPickers(focused) {
  const drawn = new Set();
  for (const fresh of app.querySelectorAll('input[type=file]')) {
    drawn.add(fresh.id);
    const kept = pickers.get(fresh.id);
    if (kept) fresh.replaceWith(kept); else pickers.set(fresh.id, fresh);
  }
  for (const [id, kept] of pickers) if (!drawn.has(id)) { kept.remove(); pickers.delete(id); }
  if (focused && pickers.get(focused.id) === focused) focused.focus({ preventScroll: true });
}

function render() {
  const focused = document.activeElement;
  const { finals, extra, fixed } = form ? current() : { finals: [], extra: [], fixed: new Map() };
  const model = store.get('handModel', 'small');
  app.classList.toggle('open', Boolean(form));
  app.classList.toggle('example-open', Boolean(!form && example));
  app.classList.toggle('find-open', Boolean(!form && finder));
  app.innerHTML = '<main><header class="top"><h1>Form Filler</h1><p>Photograph or open a form, write your answers anywhere as plain lines, and get the form back filled in. ' +
    '<b>Everything happens on this device.</b> Nothing is uploaded.</p></header>' +
    (busy ? '<div class="busy" role="status">' + h(busy) + '<div class="bar"><i></i></div></div>' : '') +
    (note ? '<div class="note" role="status">' + h(note) + (pendingTemplate ? ' <button type="button" id="template-anyway" class="secondary">Use it on this form anyway</button>' : '') + '</div>' : '') +
    (keeper.legacy ? '<div class="note warn" id="plain-details" role="status">An earlier version kept your details in this browser in plain text, where another page at this address could read them. Lock them away with a passphrase, or forget them, under <a href="#details-panel">Your details</a>.</div>' : '') +
    (problems.length ? '<div class="note" role="status"><b>Not everything went in as written:</b><ul>' + problems.map(problem => '<li>' + h(problem) + '</li>').join('') + '</ul></div>' : '') +
    // No form open: the three ways in, or the example being clicked through. The form picker lives inside "Use my own
    // form" there, so a form chosen, dropped or pasted on the first screen opens exactly as it always did.
    (form ? '' : example ? exampleMarkup(example, h) : finder ? findMarkup(finder, h) : startMarkup(h)) +
    (form ? '<section class="panel"><h2>1. The form</h2><div class="tools"><label class="pick">Use a different form' +
    '<input id="form-file" type="file" accept="image/*,application/pdf,.pdf"></label><label class="pick small">Open a template<input id="template-file" type="file" accept=".json,application/json"></label></div>' +
    '<p class="hint desk">Or drop a form anywhere on this page, or paste a screenshot of one (⌘V / Ctrl+V).</p>' +
    '<p class="subtle">' + h(form.name) + ' · ' + form.pages.length + ' page' + (form.pages.length === 1 ? '' : 's') + (busy ? ' · finding the blanks…' : ' · ' + blanks.length + ' blank' + (blanks.length === 1 ? '' : 's') + (remembered ? ' remembered from last time' : ' found')) +
      (form.fieldCount ? ' · ' + form.fieldCount + ' are the PDF’s own fields' : '') + (form.pages[0].angle ? ' · straightened ' + Math.abs(form.pages[0].angle) + '°' : '') + '</p>' +
      '<div class="tools"><button type="button" id="template-save" class="secondary">Save this form as a template</button>' + (remembered && form.bytes ? '<button type="button" id="refind" class="secondary">Find the blanks again</button>' : '') + '</div></section>' : '') +
    (form ? '<div class="work"><section class="panel answers-panel"><h2>2. Your answers</h2><p class="rules">In the form’s order. A <b>period</b> or a <b>new line</b> moves to the next blank; a lone <b>-</b> skips one.' +
      (useDetails && fixed.size ? ' Blanks filled from your details are passed over.' : '') + '</p>' +
      '<details class="more" id="rules-more"' + (store.get('rulesOpen', false) ? ' open' : '') + '><summary>More ways to write answers</summary><p class="rules"><b>4)</b> or <b>4:</b> at the start puts that answer in blank 4. ' +
      'For a checkbox, <b>x</b> or <b>yes</b> ticks it; for a choice, its first letters are enough (“emer” picks Emergency). A period inside a number (7.38), after an initial (J. Smith) or in an e-mail address stays in the answer.</p></details>' +
      '<label class="toggle"><input type="checkbox" id="use-details"' + (useDetails ? ' checked' : '') + '> Fill my details and today’s date' + (useDetails ? ' (' + fixed.size + ' blank' + (fixed.size === 1 ? '' : 's') + ')' : '') + (useDetails && keeper.state === 'locked' && !keeper.legacy ? ' — your details are locked: unlock them under Your details' : '') + '</label>' +
      '<textarea id="answers" rows="8" placeholder="Jane Roe. 11/13/2026. Respiratory Care&#10;Ventilator. VNT-2219. 1">' + h(answers) + '</textarea>' +
      '<div class="tools"><label class="pick small">Read a printed page<input id="answers-photo" type="file" accept="image/*"></label>' +
      // The handwriting reader fetches its model from the web the first time, and the Mac app fetches nothing.
      (shell ? '' : '<label class="pick small">Read handwriting<input id="hand-photo" type="file" accept="image/*"></label>' +
      '<label class="model">Handwriting reader <select id="hand-model">' + Object.entries(HANDWRITING_MODELS).map(([key, item]) => '<option value="' + key + '"' + (key === model ? ' selected' : '') + '>' + item.title + ' (' + item.megabytes + ' MB once)</option>').join('') + '</select></label>') + '</div>' +
      handPanel() +
      '<ol class="list">' + listMarkup(finals, fixed) + '</ol>' +
      (extra.length ? '<p class="note">More answers than blanks. Not placed: ' + h(extra.join(' / ')) + '</p>' : '') + '</section>' +
      '<section class="panel filled-panel">' +
      '<h2>3. The filled form</h2><p class="subtle">Tap any answer on the form to change it there. Missed a blank? Add it, then drag across the place to write.</p>' +
      '<div class="tools"><button type="button" id="add-mode" class="secondary">' + (adding ? 'Done adding' : 'Add or remove a blank') + '</button></div>' +
      (shell && (revealed || blanks.some((blank, index) => seen(blank, index, finals[index], fixed) !== finals[index])) ? '<p class="subtle">' + (revealed ? 'Your name, date of birth and street address are shown. ' : 'Your name, date of birth and street address are shown by their last characters only; the PDF carries them whole. ') +
        '<button type="button" data-reveal class="secondary">' + (revealed ? 'Hide them again' : 'Show them') + '</button></p>' : '') +
      form.pages.map((page, index) => pageMarkup(page, index, finals, fixed)).join('') +
      '<div class="tools"><button type="button" id="pdf-edit" class="primary" title="Also ⌘S / Ctrl+S">' + (shell ? 'Save PDF you can still edit…' : 'Download PDF you can still edit') + '</button>' + (canShareFiles ? '<button type="button" id="pdf-send" class="primary">Send… (e-mail, Messages)</button>' : '') + '<button type="button" id="pdf-print" class="secondary">' + (shell ? 'Save print-ready PDF…' : 'Download print-ready PDF') + '</button><button type="button" id="print" class="secondary">Print</button>' +
      (shell && lastMade?.form === form.hash ? '<button type="button" id="file-it" class="secondary">File this PDF in the archive…</button>' : '') + '</div>' +
      '<dl class="prints"><dt>Form</dt><dd>' + form.hash + '</dd><dt>Answers</dt><dd id="answers-print">…</dd>' + Object.entries(prints).map(([name, value]) => '<dt>' + h(name) + '</dt><dd>' + value + '</dd>').join('') + '</dl></section></div>' : '') +
    mergePanel() + detailsPanel() + '</main>' +
    '<footer class="version">Form Filler ' + __APP_VERSION__ + (__APP_COMMIT__ ? ' · ' + __APP_COMMIT__ : '') + '</footer>';
  keepPickers(focused);
  void sha256(answers).then(print => { const slot = document.getElementById('answers-print'); if (slot) slot.textContent = print; });
}

function refreshValues() {
  const { finals, fixed } = current();
  blanks.forEach((blank, index) => {
    const input = app.querySelector('[data-blank="' + blank.id + '"]');
    if (!input || input === document.activeElement) return;
    if (input.type === 'radio') { const picked = pickOption(blank.options, finals[index]); for (const button of app.querySelectorAll('[data-blank="' + blank.id + '"]')) button.checked = button.value === picked; }
    else if (input.type === 'checkbox') input.checked = Boolean(finals[index]);
    else if (input.tagName === 'SELECT') { const picked = pickOption(blank.options, finals[index]) ?? ''; input.value = picked; input.classList.toggle('unmatched', Boolean(finals[index]) && !picked); }
    else if (!isSignature(finals[index])) { const shownAs = seen(blank, index, finals[index], fixed); input.value = shownAs ?? ''; input.readOnly = shownAs !== finals[index]; }
  });
  const list = app.querySelector('.list');
  if (list) list.innerHTML = listMarkup(finals, fixed);
  void sha256(answers).then(print => { const slot = document.getElementById('answers-print'); if (slot) slot.textContent = print; });
}

const pagesForPdf = () => Promise.all(form.pages.map(async page => ({ width: page.width, height: page.height, pdfPage: form.pdf ? page.pdfPage : null,
  image: form.pdf && !form.locked ? null : { type: 'jpg', bytes: new Uint8Array(await (await new Promise(resolve => page.canvas.toBlob(resolve, 'image/jpeg', 0.9))).arrayBuffer()) } })));
const save = (bytes, name, type = 'application/pdf') => {
  // The Mac app asks where to save, in its own save dialog, and writes the file there.
  if (shell) return void deskLoaded.then(module => module.saveAs(bytes, name)).then(path => { if (path) { note = 'Saved as ' + path + '.'; render(); } }, error => { note = 'It could not be saved: ' + (error.message || error); render(); });
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([bytes], { type })); link.download = name; document.body.append(link); link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 4000);
};
const baseName = () => form.name.replace(/\.[^.]+$/, '');

async function makePdf(editable) {
  const { finals } = current(), found = [];
  const bytes = await buildPdf({ pages: await pagesForPdf(), blanks, values: finals, sourcePdf: form.pdf ? form.bytes : null, editable, problems: found,
    note: 'Filled with Form Filler. Form SHA-256 ' + form.hash + '. Answers SHA-256 ' + await sha256(answers) + '.' });
  problems = found;
  prints[editable ? 'Editable PDF' : 'Print-ready PDF'] = await sha256(bytes);
  return bytes;
}
async function download(editable) {
  busy = 'Making the PDF…'; render();
  try {
    const bytes = await makePdf(editable), name = baseName() + (editable ? ' - filled.pdf' : ' - filled, print-ready.pdf');
    // In the Mac app the PDF just made can be filed in the archive, with the form it was made from.
    lastMade = shell ? { bytes, name, form: form.hash, answers: await sha256(answers) } : null;
    save(bytes, name);
  }
  catch (error) { note = 'The PDF could not be made: ' + (error.message || error); }
  busy = ''; render();
}
// Sending the filled form straight to Mail, Messages or anything else the device offers (the share sheet). Where the
// device has no share sheet for files, the button is not shown. A browser can refuse to share after the PDF took a
// moment to make (the tap has "expired"); then the PDF is kept ready and the next tap sends it at once.
const canShareFiles = (() => { try { return Boolean(navigator.canShare?.({ files: [new File(['%PDF'], 'form.pdf', { type: 'application/pdf' })] })); } catch { return false; } })();
let readyToSend = null;
async function send() {
  const key = JSON.stringify(current().finals);
  try {
    if (readyToSend?.key !== key) {
      busy = 'Making the PDF to send…'; render();
      readyToSend = { key, file: new File([await makePdf(true)], baseName() + ' - filled.pdf', { type: 'application/pdf' }) };
      busy = ''; render();
    }
    await navigator.share({ files: [readyToSend.file], title: baseName() + ' - filled' });
    note = '';
  } catch (error) {
    busy = '';
    if (error.name === 'NotAllowedError') note = 'The filled PDF is ready. Tap “Send” once more to send it.';
    else if (error.name !== 'AbortError') note = 'The PDF could not be sent: ' + (error.message || error);
  }
  render();
}

async function makeMerge() {
  const { finals } = current(), pages = await pagesForPdf(), copies = [], found = [];
  try {
    for (const [index, row] of merge.rows.entries()) {
      busy = 'Filling copy ' + (index + 1) + ' of ' + merge.rows.length + '…'; render();
      const before = found.length;
      copies.push(await buildPdf({ pages, blanks, values: rowValues(blanks, mergeColumns(), row, finals), sourcePdf: form.pdf ? form.bytes : null, editable: false, problems: found }));
      for (let at = before; at < found.length; at++) found[at] = 'Row ' + (index + 1) + ': ' + found[at];
    }
    const bytes = await joinPdfs(copies);
    problems = found; prints['Merged PDF (' + copies.length + ' copies)'] = await sha256(bytes);
    save(bytes, baseName() + ' - ' + copies.length + ' filled copies.pdf');
  } catch (error) { note = 'The copies could not be made: ' + (error.message || error); }
  busy = ''; render();
}
// A CSV with one column per blank, headed so it matches back: the label, or the blank's number when the label is
// missing or shared.
function blankCsv() {
  const labels = blanks.map(blank => (blank.label || '').trim()), quote = text => /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  const headers = labels.map((label, index) => !label || labels.indexOf(label) !== labels.lastIndexOf(label) || /^\d+$/.test(label) ? String(index + 1) : label);
  save(headers.map(quote).join(',') + '\n', baseName() + ' - columns.csv', 'text/csv');
}

// Signing: draw with a finger (or a mouse) in a box the shape of a signature line.
const pad = document.createElement('dialog');
pad.className = 'pad';
pad.innerHTML = '<form method="dialog"><h2>Sign</h2><canvas width="900" height="260" aria-label="Draw your signature here"></canvas><label class="toggle"><input type="checkbox" name="keep"> Keep this signature on this device, locked with your details<span class="keep-why"></span></label>' +
  '<div class="tools"><button type="button" value="clear" class="secondary">Clear</button><button type="button" value="saved" class="secondary" hidden>Use my saved signature</button><button value="cancel" class="secondary">Cancel</button><button value="use" class="primary">Use this signature</button></div></form>';
document.body.append(pad);
const ink = pad.querySelector('canvas'), pen = ink.getContext('2d');
let signing = null, stroked = false, lastPoint = null;
const clearPad = () => { pen.clearRect(0, 0, ink.width, ink.height); pen.strokeStyle = '#c9d4cc'; pen.lineWidth = 2; pen.beginPath(); pen.moveTo(30, 200); pen.lineTo(870, 200); pen.stroke(); stroked = false; };
const at = event => { const rect = ink.getBoundingClientRect(); return [(event.clientX - rect.left) * ink.width / rect.width, (event.clientY - rect.top) * ink.height / rect.height]; };
ink.addEventListener('pointerdown', event => { ink.setPointerCapture(event.pointerId); lastPoint = at(event); event.preventDefault(); });
ink.addEventListener('pointermove', event => {
  if (!lastPoint) return;
  const point = at(event); pen.strokeStyle = '#0d1a59'; pen.lineWidth = 5; pen.lineCap = 'round'; pen.lineJoin = 'round';
  pen.beginPath(); pen.moveTo(...lastPoint); pen.lineTo(...point); pen.stroke(); lastPoint = point; stroked = true;
});
ink.addEventListener('pointerup', () => { lastPoint = null; });
// The signature alone, cut to the ink, on a clear background (the guide line is not part of it).
function signatureImage() {
  const data = pen.getImageData(0, 0, ink.width, ink.height).data;
  let left = ink.width, right = -1, top = ink.height, bottom = -1;
  for (let y = 0; y < ink.height; y++) for (let x = 0; x < ink.width; x++) { const index = (y * ink.width + x) * 4; if (data[index + 3] > 40 && data[index + 2] > data[index] + 40) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); } }
  if (right < 0) return null;
  const out = document.createElement('canvas'); out.width = right - left + 13; out.height = bottom - top + 13;
  const context = out.getContext('2d'), image = pen.getImageData(left - 6, top - 6, out.width, out.height);
  for (let index = 0; index < image.data.length; index += 4) if (!(image.data[index + 2] > image.data[index] + 40)) image.data[index + 3] = 0;   // keep only the blue ink
  context.putImageData(image, 0, 0);
  return out.toDataURL('image/png');
}
pad.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.value === 'clear') clearPad();
  if (button?.value === 'saved' && savedSignature) { overrides[signing] = { signature: savedSignature }; pad.close(); render(); }
});
pad.addEventListener('close', () => {
  if (pad.returnValue === 'use' && stroked) {
    const signature = signatureImage();
    if (signature) {
      overrides[signing] = { signature };
      // Kept only if your details are still unlocked now (they may have locked while you signed); said either way.
      if (pad.querySelector('[name=keep]').checked) void keeper.save({ signature }).then(answer => {
        note = answer === 'kept' ? 'Your signature is kept, locked with your details.' : 'Your signature was not kept: ' + (answer === 'locked' ? 'your details locked while you signed. Unlock them and sign again to keep it.' : 'your details are not locked away here.');
      }, error => { note = error.message; }).then(render);
    }
  }
  signing = null; render();
});
function openPad(id) {
  signing = id; clearPad(); pad.returnValue = '';
  pad.querySelector('[value=saved]').hidden = !savedSignature;
  const keep = pad.querySelector('[name=keep]'), state = keeper.state;
  keep.checked = false; keep.disabled = state !== 'open';
  pad.querySelector('.keep-why').textContent = state === 'open' ? '' : state === 'locked' ? ' (unlock your details first)' : state === 'unavailable' ? ' (this browser keeps nothing here)' : ' (save your details with a passphrase first)';
  pad.showModal();
}

app.addEventListener('change', event => {
  const target = event.target, file = target.type === 'file' ? target.files[0] : null;
  if (target.type === 'file') target.value = '';        // a kept picker: the same file can be chosen again
  // One job at a time, as for a dropped or pasted file: the job under way works on the same form (copies being made
  // would take a new CSV's columns part-way through), so a file chosen meanwhile is not opened, and the page says so.
  if (file && busy) { note = '“' + file.name + '” was not opened: the page is still busy (' + busy.charAt(0).toLowerCase() + busy.slice(1) + '). Choose it again when that is done.'; render(); return; }
  if (target.id === 'form-file' && file) void openForm(file);
  if (target.id === 'template-file' && file) void openTemplateFile(file);
  if (target.id === 'answers-photo' && file) void readPrinted(file);
  if (target.id === 'hand-photo' && file) void readHandwriting(file);
  if (target.id === 'hand-model') store.set('handModel', target.value);
  if (target.id === 'use-details') { useDetails = target.checked; store.set('useDetails', useDetails); render(); }
  if (target.id === 'csv-file' && file) void file.text().then(text => {
    try { const rows = parseCsv(text); if (!rows.length) throw new Error('The CSV is empty.'); const headers = rows[0], matched = matchColumns(blanks, headers); merge = { name: file.name, headers, rows: rows.slice(1), ...matched, ids: columnIds(blanks, matched.columns) }; note = ''; }
    catch (error) { merge = null; note = error.message || String(error); }
    render();
  });
  if (target.dataset.blank && (target.type === 'checkbox' || target.type === 'radio' || target.tagName === 'SELECT')) { overrides[target.dataset.blank] = target.type === 'checkbox' ? target.checked : target.value; refreshValues(); }
});
app.addEventListener('input', event => {
  const target = event.target;
  if (example && exampleTyped(example, target.id, target.value)) exampleRefresh(example, app, h);
  if (finder && findTyped(finder, target.id, target.value)) findRefresh(finder, app, h);
  if (target.id === 'answers') { answers = target.value; refreshValues(); }
  if (target.dataset.blank && target.type !== 'checkbox' && target.type !== 'radio' && target.tagName !== 'SELECT') { overrides[target.dataset.blank] = target.value; refreshValues(); }
  if (target.dataset.hand) hand.lines[Number(target.dataset.hand)].text = target.value;
});
app.addEventListener('toggle', event => { if (event.target.id === 'details-panel') store.set('detailsOpen', event.target.open); if (event.target.id === 'rules-more') store.set('rulesOpen', event.target.open); }, true);
app.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  // The first screen, the example, and the finder. Each of the three ways in takes the screen while it is open, and
  // leaving one brings the three choices back with nothing kept.
  if (target.id === 'example-start') { example = freshExample(); finder = null; note = ''; render(); }
  if (target.id === 'example-leave') { example = null; render(); }
  if (target.id === 'find-start') { finder = freshFind(); example = null; note = ''; render(); }
  if (target.id === 'find-leave') { finder = null; render(); }
  if (example && examplePressed(example, target.id)) render();
  if (finder && findPressed(finder, target.id)) render();
  if (target.id === 'add-mode') { adding = !adding; render(); }
  if (target.dataset.remove) { blanks = blanks.filter(blank => String(blank.id) !== target.dataset.remove); remember(); render(); }
  if (target.dataset.sign) openPad(target.dataset.sign);
  if (target.dataset.unsign) { delete overrides[target.dataset.unsign]; render(); }
  if (target.id === 'pdf-edit') void download(true);
  if (target.id === 'pdf-print') void download(false);
  if (target.id === 'pdf-send') void send();
  if (target.id === 'print') printPage();
  if (target.id === 'template-save') save(JSON.stringify(marked(templateNow(true)), null, 1), baseName() + ' - template.json', 'application/json');
  if (target.id === 'template-anyway' && pendingTemplate) {
    useTemplate(pendingTemplate); labelsMark = pendingMark; pendingTemplate = null; pendingMark = null; remember(); remembered = true;
    note = 'The template’s blanks are in place. Check they sit where they should: it was made for a different file.' + (earlierLabels(labelsMark) ? ' It was saved ' + EARLIER + AGAIN : ''); render();
  }
  if (target.id === 'refind' && form) { store.drop('template:' + form.hash); const { name, bytes } = form; void openForm(new File([bytes], name, { type: form.pdf ? 'application/pdf' : 'image/png' })); }
  if (target.id === 'csv-blank') blankCsv();
  if (target.id === 'merge-go') void makeMerge();
  if (target.id === 'hand-use') {
    const read = numberedLines(hand.lines.map(line => line.text.trim()).filter(Boolean).join('\n'), blanks.length);
    answers = (answers.trim() ? answers.trim() + '\n' : '') + read.text; hand = null;
    note = read.numbered ? read.numbered + ' lines start with a blank’s number, so each went to that blank. ' + unplaced(read.unnumbered) + 'Check them on the form.' : ''; render();
  }
  if (target.id === 'hand-drop') { hand = null; note = ''; render(); }
  if (target.id === 'save-details') void saveDetails();
  if (target.id === 'unlock') void unlockDetails();
  if (target.id === 'lock-now' && !keeper.lock()) { note = 'Keep your recovery key first, then lock: press “I have kept it”.'; render(); }
  if (target.id === 'forget-stray') { keeper.forgetStray(); note = 'The plain copies are forgotten; your locked details are as they were.'; render(); }
  if (target.id === 'change-passphrase') void changePassphrase();
  if (target.id === 'key-kept') keeper.keptKey();
  if (target.id === 'print-key') printKey();
  if (target.dataset.reveal !== undefined) { revealed = !revealed; render(); }
  if (target.id === 'file-it' && lastMade && form) void deskLoaded.then(module => module.fileInArchive({ made: lastMade, original: form.bytes ? { name: form.name, bytes: new Uint8Array(form.bytes) } : null, title: baseName() }));
  if (target.id === 'forget-details') { confirmForget = true; render(); }
  if (target.id === 'forget-no') { confirmForget = false; render(); }
  if (target.id === 'forget-yes') { confirmForget = false; void keeper.forget().then(() => { note = 'Your details are forgotten on this device.'; }, error => { note = error.message; }).then(render); }
  if (target.id === 'forget-signature') void keeper.forgetSignature().then(() => { note = 'Your saved signature is forgotten.'; }, error => { note = error.message; }).then(render);
});
// Quicker ways in on a computer: drop a form (or a template) anywhere on the page, paste a screenshot of one, and
// ⌘S / Ctrl+S for the editable PDF.
function takeFile(file) {
  if (busy) return;
  if (/\.json$/i.test(file.name) || file.type === 'application/json') void openTemplateFile(file);
  else if (isPdf(file) || /^image\//.test(file.type)) void openForm(file);
  else { note = '“' + file.name + '” is not something this opens: use a photo, a scan or a PDF of the form, or a template.'; render(); }
}
const carriesFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragover', event => { if (!carriesFiles(event)) return; event.preventDefault(); document.body.classList.add('dropping'); });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('dropping'); });
document.addEventListener('drop', event => {
  document.body.classList.remove('dropping');
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault(); takeFile(file);
});
document.addEventListener('paste', event => {
  const file = [...(event.clipboardData?.files || [])].find(item => /^image\//.test(item.type) || isPdf(item));
  if (!file || busy) return;
  event.preventDefault();
  void openForm(file.name && file.name !== 'image.png' ? file : new File([file], 'pasted form.png', { type: file.type }));
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's' && form && !busy) { event.preventDefault(); void download(true); }
});

// Adding a blank: drag across the place to write, on the page itself.
let drag = null;
app.addEventListener('pointerdown', event => {
  const sheet = event.target.closest('.sheet.adding');
  if (!sheet || event.target.closest('.blank')) return;
  const rect = sheet.getBoundingClientRect(), box = document.createElement('div');
  box.className = 'drawing'; sheet.append(box);
  drag = { sheet, rect, box, x: event.clientX - rect.left, y: event.clientY - rect.top };
  sheet.setPointerCapture(event.pointerId); event.preventDefault();
});
app.addEventListener('pointermove', event => {
  if (!drag) return;
  const x = event.clientX - drag.rect.left, y = event.clientY - drag.rect.top;
  Object.assign(drag.box.style, { left: Math.min(x, drag.x) + 'px', top: Math.min(y, drag.y) + 'px', width: Math.abs(x - drag.x) + 'px', height: Math.abs(y - drag.y) + 'px' });
});
app.addEventListener('pointerup', event => {
  if (!drag) return;
  const { sheet, rect, x, y } = drag, page = form.pages[Number(sheet.dataset.page)], sx = page.width / rect.width, sy = page.height / rect.height;
  const x1 = event.clientX - rect.left, y1 = event.clientY - rect.top;
  drag.box.remove(); drag = null;
  if (Math.abs(x1 - x) < 8 || Math.abs(y1 - y) < 6) return;
  const blank = { id: nextId++, page: Number(sheet.dataset.page), kind: Math.abs(x1 - x) < 40 && Math.abs(y1 - y) < 40 ? 'check' : 'box', x0: Math.min(x, x1) * sx, y0: Math.min(y, y1) * sy, x1: Math.max(x, x1) * sx, y1: Math.max(y, y1) * sy, label: 'added by hand' };
  blanks.push(blank); reorder(); remember(); render();
});

// Another program can open this page with answers ready: …/#answers=Jane%20Roe.%2011%2F13%2F2026
const fromLink = new URLSearchParams(location.hash.slice(1)).get('answers');
if (fromLink) answers = fromLink;
render();
void keeper.start();
if (shell) void deskLoaded.then(module => { desk = module.start({ app, keeper, store, h, say: message => { note = message; render(); } }); });
// Anything done on the page keeps the vault open; 15 minutes of nothing locks it (keep.js). A timer does not run while a
// computer sleeps, so the time is looked at again whenever the page comes back into view, and every minute.
for (const kind of ['pointerdown', 'keydown', 'input']) document.addEventListener(kind, () => keeper.touch(), true);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keeper.check(); });
for (const kind of ['pageshow', 'focus']) window.addEventListener(kind, () => keeper.check());
setInterval(() => keeper.check(), 60000);
app.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.id === 'unlock-secret') { event.preventDefault(); void unlockDetails(); } });

// Offline after the first visit: a service worker keeps the page's own files (built ones only).
// When a newer version has been published, the old one must not linger: the page looks for it each time it is opened
// or brought back to the front, and once the new version is in place the page reloads into it, unless a form is open
// (then it says so and waits, so nothing typed is lost).
// The Mac app has no use for one: its page is in the app itself, and WebKit registers none at the app's address.
if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol !== 'file:' && !shell) {
  const hadOne = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register(asset('sw.js')).then(registration => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update().catch(() => {}); });
  }).catch(() => { /* works online without it */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadOne || reloading) return;
    if (!form && !answers.trim() && keeper.state !== 'open' && !keeper.recoveryKey) { reloading = true; location.reload(); return; }
    note = 'A newer version of Form Filler is ready. It opens the next time you open the page (or reload it now, after you download this form).'; render();
  });
}
