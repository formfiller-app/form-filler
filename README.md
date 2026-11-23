# Form Filler

Photograph or open a form, write your answers as plain lines, and get the form back filled in: as a PDF you can still
edit, a print-ready PDF, or printed. It runs in your browser, on your own device. The form, your answers and your
details are not uploaded anywhere. It installs like an app (Add to Home Screen) and works offline after the first
visit.

It is also a library and a command-line tool, so other programs can fill forms with it. And since 2.8.0 it is a
Mac app, built on your own Mac from this repository: the same page in a window of its own, with a locker for your
documents, an archive of everything you file, and backups. See [The Mac app](#the-mac-app).

**Open it:** <https://formfiller-app.github.io/form-filler/>. The foot of the page names the version you have; this
README describes 2.10.0, and what changed in each version is in [CHANGELOG.md](CHANGELOG.md). Until 2026-11-21 the
page was at `swixixle.github.io/form-filler/`. If you used it there, start again at the new address and add it to your
home screen from there; [Privacy](#privacy) says how to remove what the old one kept.

Everything below describes what works today, except the section headed [Roadmap](#roadmap-planned-not-built), which
is planned and not built.

## How to use it

The pictures are the page itself, filling an invented form with invented answers.

### Start here: three ways in

The page opens on three choices.

- **Try an example** — a worked example that runs start to finish in about half a minute, with no form to find and
  nothing of your own typed in. "Starting a new job in Indiana": one tap opens an invented person's new-hire packet
  with its answers already in place; you change the address once and it lands on both forms that carry it, and on
  neither of the others; then two previews side by side show what the people office would receive and what payroll
  would receive, with the bank details in payroll's and not in the other's. Everything in it is invented — the
  person, the employer, the credit union, both addresses, the account numbers and the three forms, each marked
  "(invented form)". Nothing is sent, nothing is saved, no vault is made, and leaving it leaves nothing behind.
- **Use my own form** — what the rest of this section describes: choose a photo, a scan, a screenshot or a PDF, drop
  one on the page, paste a screenshot of one, or open a template.
- **Find a form** — ask in plain words ("I'm starting a job in Indiana") instead of knowing the form's number. Each
  form found says who issued it, where it applies and when it was last checked, and whether Form Filler fills it or
  hands you to the official site; one checked longer ago than the 180 days the bank promises says so rather than
  passing as fresh. Two things it will not do: **use a model** — your words are matched against the words each form
  is known by, which can be read and tested, and nothing you type leaves the device — and **invent a result**, so a
  question it cannot answer gets nothing back. The forms in it are invented so far, every one, as is each issuer and
  each address on the web; a real list replaces them without touching the matching. The wider direction is in
  [docs/PAPERWORK_PROPOSAL.md](docs/PAPERWORK_PROPOSAL.md).

### 1. Open the form

A photo, a scan, a screenshot or a PDF. Every place to write is found, shaded and numbered: a line to write on, an
empty box or table cell, a square checkbox. A crooked photo is straightened first. "Date" is filled with today.

When a PDF has its own fill-in fields, those are the blanks, exactly, and they are the fields that get filled: text,
checkboxes, drop-downs and radio buttons (shown as a button over each of the form's own). A signature line drawn on
the page with no field behind it is still found. Missed a blank? Add it by dragging across the place to write.

<img src="docs/images/blanks.png" width="420" alt="An invented equipment loan form, photographed a little crooked, with its 13 blanks shaded and numbered and today's date already in the Date blank">

### 2. Write your answers

One after another, in the form's order, as plain lines:

- a **period** or a **new line** moves to the next blank;
- a lone **-** (or an extra period, ". .") leaves a blank empty;
- **4)** or **4:** at the start puts that answer in blank 4 ("4:30" is a time, not a blank number);
- for a checkbox, **x** or **yes** ticks it; for a choice, its first letters are enough ("emer" picks Emergency);
- a period inside a number (7.38), after an initial (J. Smith) or a short title (Dr., St.), in a.m./p.m., or with no
  space after it (jane@example.org) stays in the answer.

The list under the box shows each blank's label and what it will get, so a wrong placement shows before anything is
made. A checkbox is listed by its own caption, whichever side of the box it is printed on ("[ ] Yes" or "Yes [ ]").
When that cannot be told (a word as near one box as the next, or a note, code or price beside the caption), the list
says "unclear" instead of guessing, and no CSV column goes to that box. A table's cells (two empty rows or more) are
listed by their column's header ("Item", "Qty"). Each header cell is read on its own, twice, and the cells are named
only when both reads say the same; otherwise they are listed as "blank".

**Your details** (full, first and last name, e-mail, phone, street address, city, state, ZIP, date of birth) are saved
once on the device and filled into any blank whose label asks for them. A label about someone else ("Patient name",
"Emergency contact phone", "Supervisor") is left alone. "Date" gets today, but a date of birth, start, end or due date
does not. A cell named from its column's header is never filled this way, whatever the header says: a "Name" column
is many people's. (Where no header could be read, a table's first row can still carry the header's words from the
page's read, and is filled like any other blank, as before.)
Typed answers pass over the blanks your details filled, so you type only what is missing.

**Answers on paper.** Write each answer after its blank's number ("3 Jane Roe", "7. Facilities", "#9 yes"), in any
order, photograph the page and tap *Read handwriting* (or *Read a printed page* for typed text). Each line read is
shown beside its own picture, so a wrong word is fixed before it goes in. A line whose number could not be read is
left out and named, never put in order where it would cover another blank's answer. Write a word after the number
("9 yes"), not a lone mark: on the synthetic test page "9 x" came back as "qx".

<img src="docs/images/answers.png" width="330" alt="The answers box with six lines typed, and the list of the 13 blanks with the answer each will get">

### 3. Check it on the form, sign, and send

Every answer sits in its blank on the page and can be changed there. Sign with a finger or a mouse; the signature is
placed as a picture, and keeping it on the device for next time is a choice you make each time. Then download the PDF
you can still edit, a print-ready PDF, print, or *Send…* (Mail, Messages, or anything the device's share sheet offers,
where it has one for files).

What a PDF field cannot take (a choice it does not offer, more characters than it allows) is listed, not dropped.
Each download shows its SHA-256 beside the form's and the answers', and the PDF records the form and answer
fingerprints.

<img src="docs/images/filled.png" width="420" alt="The same invented form filled in: name, department, two items with serial numbers and quantities, the Night box ticked, a comment and a drawn signature">

### Shortcuts

- **Remembered forms.** A form's blanks are remembered by the form's fingerprint (SHA-256), so the same form opens ready
  the next time. A template can be saved as a file and opened on another device.
- **Many copies.** A spreadsheet saved as CSV gives one filled copy per row, all in one PDF. Columns match a blank by its
  number ("3"), its label ("Name") or the PDF field's own name; a column that matches nothing is named, not guessed.
  "Get a CSV with this form's columns" gives you the headings to start from.
- **On a computer.** Drop a form anywhere on the page or paste a screenshot of one; the answers box sits beside the form
  on a wide screen, and ⌘S / Ctrl+S downloads the editable PDF.
- **From another program.** A link can carry the answers: `https://…/form-filler/#answers=Jane%20Roe.%20555-0100`.

## The Mac app

The same page in a window of its own on a Mac, with what a web page cannot have: real folders. There is no download
yet: it is built from this repository on your own Mac ([Run it](#run-it)). A bar across the top goes between filling
a form and what the app keeps:

- **Your vault** is made the first time the app opens. A passphrase locks it, and a recovery key, shown once and
  printable, is the only other way in. It holds your details, your signature and the locker, in the
  [age](https://age-encryption.org) format, in the app's own data folder
  (`~/Library/Application Support/io.github.formfiller-app.form-filler/`). It locks again after 15 minutes left alone.
- **The locker** is for documents you want kept locked away: an ID, a licence, last year's return. Add one, see the
  list, save a copy back out. Nothing is removed from it in this version.
- **The archive** is one plain folder, `~/Form Filler Archive` unless you choose another place for it, that reads
  sensibly in Finder and needs no app. After you save a filled PDF, *File this PDF in the archive…* files it with the
  form it was made from, in a matter you name (or in `_Unsorted`), with a record and a fingerprint of each file. The
  Archive screen lists everything by matter, shows an item in Finder, moves it to another matter, and reads every
  file again to compare it with its fingerprint. Nothing in the archive is ever deleted or written over.
- **Backups** are each one sealed copy of the archive, the vault, the forms the app remembers and its settings, on a
  drive or folder you pick. *Check the copy* compares it with its fingerprints; *Check it fully…* opens it with your
  passphrase and checks every file in it. *Restore…* checks every file before anything is moved, and overwrites
  nothing: what is there already stays, and the restored copy goes beside it. Form Filler never deletes a backup.
  The first screen of a new installation offers *Restore from a backup instead*.

In the app your name, date of birth and street address are shown by their last four characters (fewer for a short
value), in *Your details* and on the filled form, until you press *Show them*. The PDF always carries them whole, and
printing shows them first.

What the app can reach: its own data folder; a folder you pick in one of its dialogs; and, in your home folder, only
folders named `Form Filler Archive…`, with a hidden work folder while a restore runs. Its window opens no web address
and fetches nothing from one. That is why *Read handwriting*, which downloads its model, is left out of the app.

What to know before relying on it:

- **It has been clicked through by scripts, not yet by a person.** Every screen is walked in two browsers over a
  stand-in for the app, and again inside the app itself against its real file code ([Tested](#tested-in-webkit-and-chromium)).
  The Mac's own panels (choosing a folder, choosing a file, naming a file to save, printing) have not been clicked.
- **It is slower while its window cannot be seen.** macOS slows the page of a window that is hidden, minimized or
  covered: a backup, a check or a restore then takes several times as long, and a PDF waits to be read until the
  window is shown. In view, a made-up archive of 2 GB in 8,720 files was backed up in 55 s, checked fully in 32 s
  and restored in 85 s.
- **It is signed only by the build itself**, not with a developer's certificate, so it runs on the Mac that built it;
  macOS may ask again whether it may use a folder in Documents, on the Desktop or on another drive after each build.
- **A backup is as large as what it copies**, each time; thinning old ones is yours to do.

## Privacy

- **It runs on your device.** The form, your answers, your details and your signature are read and filled in the
  browser. Nothing is sent anywhere. The test walk below checks it: across all of its steps, no request leaves the
  page's own address.
- **One download, only when you ask for it.** *Read handwriting* fetches a handwriting model (TrOCR) from Hugging Face
  the first time, at a fixed version: Quick, about 64 MB, or Larger, about 338 MB. Your photo stays on the device, but
  the download tells Hugging Face your IP address, as any download does.
- **What it keeps, and where.** Your details and a signature (if you choose to keep it) are kept in this browser on
  this device in an encrypted vault, locked with a passphrase you choose, never in plain text. The browser's storage
  belongs to the whole web address the page is served from, `formfiller-app.github.io`, and nothing else is published
  there: it is the address of this project's own GitHub organization, which holds this repository only. The vault is
  in the [age](https://age-encryption.org) format, the passphrase is never kept, and while it is unlocked your details
  are in the page's memory only; it locks again when you close the page or leave it alone for
  15 minutes. When the vault is made you are shown a recovery key, once: the only way back in if the passphrase is
  forgotten. Each form's blank positions are kept in plain storage, without the file's name, since they hold nothing
  of you. *Forget my details* removes the vault; details an earlier version kept in plain text are shown, and gone as
  soon as you lock them away or forget them. What is read back from storage is checked before it is used.
- **What the vault does not stop.** It keeps other pages at the same web address from reading your details out of the
  browser's storage, but not from scripting this page while it is open. Only an address of its own closes that off,
  and the page has one, as long as nothing else is published at `formfiller-app.github.io`. The page also refuses to
  run inside another page or in a window another page opened, and its offline copy is checked against the fingerprints
  its build wrote. Changing your passphrase locks the same key again, so an earlier copy of the key file still opens
  with the old one; if your passphrase may have been seen, forget your details and save them again, which makes a new
  key.
- **What the old address kept.** Until 2026-11-21 the page was served from `swixixle.github.io`, an address other
  pages published by the same GitHub account could share. The versions served there, up to 2.5.0, had no vault: what
  they kept (your details, a saved signature, and the forms they remembered, with their file names) is in plain text,
  and may still be in your browser at that address. The old address now shows a page that says where Form Filler
  went, lists what the old version left in that browser, shows your details if you ask (to type them in again here),
  and removes all of it when you press *Remove it all*. A copy kept there for offline use, or put on a home screen,
  should turn into that page the next time it is opened with a connection. A copy on an iPhone or iPad home screen
  keeps storage of its own, apart from Safari's: open it once more, press *Remove it all* there too, then delete it.
  Clearing your browser's stored data for `swixixle.github.io` removes it all as well.
- **In the Mac app**, what the page keeps is not in a browser at all: the vault, the forms it remembers and its
  settings are files in the app's own data folder, and the archive is a folder you own. The archive is plain files,
  by design, so it is as private as the disk it is on (FileVault) and as its backups, which are sealed. The app
  warns if the folder you choose for it looks like one a syncing service copies to its servers.
- **The repository holds nothing personal.** Tests, fixtures and pictures use invented people and invented forms only.
  A gate checks every commit before it is made, and again on GitHub, for the shapes of Social Security, routing and
  account numbers, dates of birth, real e-mail addresses, and any picture or PDF not listed as invented. On the
  maintainer's own computer it also checks for their own name and other values, which it keeps only as keyed
  fingerprints. How it works: [never-list/README.md](never-list/README.md).

## Tested in WebKit and Chromium

`scripts/walk.cjs` drives the built page at phone size through 49 steps, using the invented forms in
`tests/fixtures`, and checks every PDF it makes with `pdftotext` and pdf-lib. Among them:

- a crooked photo straightened and its 13 blanks found; the same form as a PDF, keeping its own page;
- answers placed, changed on the form, signed; a blank added by hand and removed;
- checkboxes labelled by their own captions on either side, Yes/No pairs both ways round, and a box that cannot be
  told shown as unclear;
- the same form and sheet as PDFs: no box gets another box's words, and a CSV column "Day" goes to the Day box (or
  to none, where that box is unclear) and never to the Night box;
- the table's cells labelled by their column's header: on the photo, every one; on the PDF, each by its own header or
  none;
- a form remembered and a template saved by an older version each saying so;
- a PDF's own fields found and filled, radio buttons included, and a choice it does not offer reported;
- a 12-page PDF filled with all 12 pages kept, in order; many copies from a CSV, its columns keeping to their blanks
  when blanks are added or removed by hand;
- templates saved and opened on a "new device"; answers handed over in a link;
- offline: the page opens again and finds blanks with the server gone;
- a PDF opened in a browser that lacks the newest JavaScript; a planted value in storage that does not run;
- the three ways in, and the worked example: the packet open and filled, one address change landing on both forms
  that carry it, the two offices side by side with the bank details in payroll's and not the other's, and nothing of
  the invented person left in storage;
- the finder: the whole bank listed with issuer, where it applies and when checked, a stale form marked as stale, a
  plain-words question narrowing it with the caret staying where it was typed, and a question it cannot answer
  returning nothing at all;
- drop, paste and ⌘S on a computer; nothing sent anywhere; no page or console errors.

The checks on GitHub run it on every push, in **Chromium** (on Linux) and in **WebKit** (on a Mac), WebKit being the
engine of Safari and of every iPhone browser. Before 2.2.0 it ran in Chromium only, and in WebKit the page took the ring
of the "Q" in "Qty" for a checkbox, so every later answer landed one blank late:

<img src="docs/images/webkit-qty.png" alt="The same table of an invented form in WebKit: before the fix, a blank numbered 4 on the Q of Qty and the cells numbered 5 to 10; now, the cells numbered 4 to 9">

The Mac app's own screens are walked too. `scripts/walk-mac.cjs` clicks through them in Chromium and in WebKit, in
13 steps: first-run setup; your details kept locked and shown hidden; the worked example and the finder run inside the app; a
form filled, its PDF saved and filed; the archive checked and an item moved; the locker; a backup made and checked fully; everything moved aside and restored
byte for byte; a second restore that goes beside; and the vault forgotten. In that walk the app itself is stood in
for (`tests/tauri-stand-in.js`, written from the file plugin's source), and its dialogs answer with the folder the
walk names. `npm run mac:check` then runs inside the app itself, in a test build, against its real file plugin: 17
checks of the file code (every promise the command line's file interface makes; the home folder reachable only by
Form Filler's own names; the page under the app's content policy, with nothing fetched), and the screens clicked
through by a script in a first run of their own (6 steps), also when the app is started as Finder starts it. Last, in
a start of its own, the window is closed as its close button closes it: the app must then end by itself within the
minute, and not stay running with no window. The
checks on GitHub run the walk of the screens in both engines and the app's Rust tests; the app itself is started only
on a Mac at hand.

With `--handwriting` the walk also reads two synthetic handwritten pages (51 steps; it downloads the 64 MB model). The
library, the command line and the app's file code have 390 unit tests (`npm test`). 33 of them are known limits, reported as "todo":
30 of the checkbox labels (9 of those are layouts where a box still gets words that are not its caption), and 3 of
the blank finder in tables. Two open a backup with the stock `age` tool, and are skipped where it is not installed;
one of those needs Linux. One types a passphrase at a terminal, which it makes with python3, and is skipped without
it.

Not tested: a real iPhone or a real Safari (Playwright's WebKit build stands in for them), real handwriting, and real
forms. In the Mac app: anything that needs a click in one of the Mac's own panels (choosing a folder or a file,
naming a file to save, printing), a real backup drive, and an archive much larger than 2 GB.

## Plugging it into other programs

**The library** (`src/lib/index.js`, ES module, Node 22 or a browser; its runtime dependencies are pdf-lib and, for
the vault and backups, age-encryption and @noble/hashes):

```js
import { readFields, placeAnswers, buildPdf } from 'form-filler';

// A PDF's own fields, in points.
const { blanks } = await readFields(pdfBytes);

// Loose answers, one per blank, in order.
const { values } = placeAnswers(blanks, 'Jane Roe. jane@example.org. 555-0100. -. emer');

const filled = await buildPdf({
  pages: [{ width: 612, height: 792, pdfPage: 0 }],
  blanks,
  values,
  sourcePdf: pdfBytes,
  editable: true,
});
```

A source PDF comes through whole: its pages that `pages` does not list are kept, in order (`keepOtherPages: false`
leaves them out). Also: `readTemplate`, `makeTemplate`, `findBlanks` (from a page's grayscale pixels), `numberedLines`
(answers written after their blank's number), `autofill`, `parseCsv`/`matchColumns`/`rowValues`, `joinPdfs`,
`segmentLines`, and `findOptions`/`nameOptions`, which find round option buttons drawn on a page, each set as one
choice (not yet used by the page). Install it from GitHub: `npm install github:formfiller-app/form-filler`.

**The command line** (`bin/form-filler.mjs`, no browser, no network):

```sh
# A template from a PDF's own fields
form-filler fields form.pdf --out form.json

# What a template holds, or what is wrong with it
form-filler check form.json

# One filled copy
form-filler fill --template form.json --form form.pdf \
  --answers "Jane Roe. 555-0100. emer" --out filled.pdf

# One copy per row of a CSV
form-filler fill --template form.json --form form.pdf \
  --csv people.csv --out all.pdf

# Your details and a fixed date; print-ready; fail on anything that did not go in
form-filler fill ... --details me.json --today 2026-11-17 --print --strict
```

`--strict` exits 2 if anything could not go in as written. The form must be the file the template was made from (same
SHA-256) unless `--any-form` is given. A photographed form's template carries its page picture, so it needs no
`--form`.

**A template** is plain JSON, checked field by field when read (`src/lib/templates.js` documents it):
`{ formFiller: "template", version: 1, form: { sha256, name, type }, pages: [...], blanks: [...] }`.

**The archive** (`src/lib/archive.js` documents it): a plain folder of everything that came in or went out, filed by
matter. Each item is a dated folder (`Taxes/2026/2026-11-17 sent IRS - Form 1040/`) with its files behind role words
and a `record.json` holding each file's SHA-256. Nothing in it is ever deleted or overwritten: a name that is taken
gets " (2)", and a record that changes is written anew with the old one kept in the item's hidden `.formfiller`
folder. The only files it rewrites or removes are its own bookkeeping there: the index cache, and a lock that lets
one program at a time change the archive. The page does not use it yet; the Mac app will.

```js
import { openArchive } from 'form-filler';
import { nodeFiles } from 'form-filler/files/node';

const archive = openArchive(nodeFiles('Test Archive'));
const { path } = await archive.createItem({ matter: 'Taxes/2026', direction: 'out', counterparty: 'IRS',
  title: 'Form 1040', files: [{ role: 'filled', name: 'f1040.pdf', bytes }] });
const report = await archive.verify();   // { ok, missing, changed, unrecorded, unfinished, problems, notes }
```

```sh
# File documents as a new item (the archive's folder is made if needed); prints the item's folder
form-filler archive add "Test Archive" --matter Taxes/2026 --direction out \
  --counterparty IRS --title "Form 1040" --role filled filled.pdf

# Read every file again and say what is missing, changed or not recorded; changes nothing
form-filler archive verify "Test Archive"
```

Also `archive file` (more files for an item, beside what is there), `archive move` (to another matter, written in
its record) and `archive index` (the index cache made again from every record). `verify` also says which items the
index knew that have left the archive, and exits 1 if anything is missing, changed, gone, unfinished or unreadable;
with `--strict`, also if anything is not recorded. The archive's flags are read strictly, so a misspelt one is
refused instead of swallowing the file after it.

**The vault** (`src/lib/vault.js` documents it): your details, saved signature and a locker of documents, encrypted
with [age](https://age-encryption.org) so every file opens with the stock `age` tool too (`tests/interop.test.js`
checks that in CI, with age 1.1.1 on Linux). A passphrase locks the vault
key; the key locks everything else, so a new passphrase rewrites one small file, and the key itself is the recovery
key, given once when the vault is made. It keeps its files in a store it is handed (in memory, in a folder, or in a
browser's IndexedDB), each written whole (only the locker's list keeps the copy before it, beside it), and each
record checked when read back so a damaged or swapped file is refused.

```js
import { createVault, unlockVault } from 'form-filler';
import { nodeStore } from 'form-filler/stores/node';

const store = nodeStore('Test Vault');
const { vault, recoveryKey } = await createVault(store, 'a few unrelated invented words');
await vault.writeProfile({ details: { fullName: 'Jane Roe' }, signature: null });
const again = await unlockVault(store, recoveryKey);   // or the passphrase
```

**Backups** (`src/lib/backup.js` documents them; [docs/RESTORE.md](docs/RESTORE.md) is the README.txt each one
carries): one encrypted snapshot of the archive and the vault, with the templates and settings beside it, on a drive
or folder you pick, in `Form Filler Backups/2026-11-17 1530/`. The snapshot is a plain tar sealed with age to the
vault's public key, so a backup needs no passphrase and can be made while the vault is locked. Beside it are a copy of
the vault's key file, `snapshot.sha256` (`shasum -a 256 -c snapshot.sha256` checks the copy without Form Filler), and
README.txt, which says how to restore with Form Filler and without it. Each backup is read back from the drive before
it is kept, and Form Filler never deletes one. A restore unpacks out of sight, checks every file against the
snapshot's manifest and that the vault opens and reads back, and only then moves each thing into place. It never
overwrites: what is there stays, and the restored copy goes beside it as `… (restored 2026-11-17 1530)`, the
backup's date. The page does not make backups yet; the Mac app will.

What the checks prove is that a backup is undamaged and sealed to your vault's key, not that you made it: anyone who
has the vault's public key could seal a snapshot, so keep backups on drives you control. The vault's own records carry
tags only its key can make, so a restore refuses a forged one, and `verify --fully` and `restore` both say when a
snapshot's vault holds no details and no locker documents; the archive's files carry no such tags.

```js
import { makeBackup, restoreBackup } from 'form-filler';
import { nodeFiles } from 'form-filler/files/node';

const { path } = await makeBackup({ data: nodeFiles('Test Data'), archive: nodeFiles('Test Archive'),
  destination: nodeFiles('/Volumes/BACKUP') });   // path: 'Form Filler Backups/2026-11-17 1530'
const { placed } = await restoreBackup({ backup: nodeFiles('/Volumes/BACKUP/' + path),
  secret: 'a few unrelated invented words',      // the passphrase you had then, or the recovery key
  data: nodeFiles('Test Data'), archive: { parent: nodeFiles('.'), name: 'Test Archive' } });
```

```sh
# A backup on a drive, read back as it is written; prints its folder
form-filler backup make /Volumes/BACKUP --data "Test Data" --archive "Test Archive"

# Open it with the passphrase (asked for, not shown) and check every file against its manifest; writes nothing
form-filler backup verify "/Volumes/BACKUP/Form Filler Backups/2026-11-17 1530" --fully

# Restore it: whatever is there already stays, and the restored copy goes beside it
form-filler backup restore "/Volumes/BACKUP/Form Filler Backups/2026-11-17 1530" \
  --data "Test Data" --archive "Test Archive"
```

Also `backup list` (the backups on a drive, with their sizes, and any that stopped before they were finished). The
flags are read as strictly as the archive's. A passphrase is never a flag: `verify --fully` and `restore` ask for it
(or the recovery key) without showing what is typed, or read it as one line from standard input, so it is in no shell
history. Every refusal or failure exits 1 with one line saying why, and so does a `verify` that finds anything not
as it should be; a restore that put a copy beside what was there counts as done (exit 0). Ctrl-C while `make` or
`restore` is under way stops it as a failure would, with what was staged removed, and exits 130. A folder whose name
has a space in it goes in quotes.

## What it cannot do (yet)

- **Labels.** A table's cells are named by their column's header only where its two reads agree. The header row
  must be the table's top row, closed by a rule over it and by the column's own walls, over two empty rows or more.
  These leave the cells "blank":
  - a header across several columns, or an open table;
  - a table directly under another with the same columns;
  - a header the reader cannot read the same twice (handwriting, a smudge, a photo's blur).

  Two reads can still agree on the same misreading: a column headed "lbs" is read "Ibs" both times, and named so. On
  an invented set of 75 headers made to trip it, no cell was named wrong, and 26 of the 193 cells found under a real
  header were left blank. A CSV column named like a header goes to the form's own blank of that name, or to none:
  use the column's number for a table's cells. A checkbox is
  left unclear whenever its caption is in doubt, and the rule leans to doubt: a caption with a note, number, code or
  price beside it ("Yes – go to Q8", "Adult $12", "500 ml"), answer codes, and a caption that wraps to the next line
  are left unclear even when a person could tell. A note, price or code the rule does not recognise can still end up
  in a box's name ("Employed answer 5a", "Adult 12pp", "Daily DY", "Oui précisez"), and the reader can misread a caption's
  own letters ("Adutt"). On a PDF, the words are read from the page as this browser draws it. A PDF that names its
  fonts without carrying them is drawn with the device's own, so it can read differently on another device: on
  GitHub's Linux machine the invented form's "Day" came back "pay", and that box was left unclear. Labels decide which
  of your details fill a blank and which CSV column goes where, so check the list before relying on them.
- **Blank numbers sit over the start of a label** on a photographed form ("Na… 1" above). The list under *Your
  answers* gives each number with its whole label.
- **Round option buttons drawn on a page** (not a PDF's own radio buttons, which work) are not found by the page yet.
- **Real handwriting has not been measured.** The tests use handwriting-style fonts (Caveat, Patrick Hand) on ruled
  paper. On that page in Node the quick reader read four of the five lines right and garbled the date (4.3% of
  characters wrong, measured 2026-11-17; an earlier run measured 1.4%). The larger reader is not known to be better: it
  got the date wrong too (11.6%). A person's own hand will do worse, joined-up writing worst. Lines must be written
  apart from each other; two lines that touch are split at their thinnest row, which can cut a tall letter.
- **A table can still gain or lose a blank.**
  - A header cell in small print (7 to 9 pt), or holding a short word such as "ID" or "No.", can be offered as a
    blank.
  - In rows under about 25 pt, a header's letters within about 1 pt of a rule (or blurred into one on a photo) can
    still split the header cell into blanks.
  - A photographed table can lose cells, and on Legal paper rows of 14 pt or less are not found.
  - A labelled field over an empty box ("Holder: ___") is taken for a table's header.

  A blank that is not there puts every later answer one blank late; a lost one, one blank early. Check a table's
  blank numbers before typing, or put answers there by number ("7) Lee Doe").
- **A photo taken at an angle** (not just turned) is straightened for rotation only, not perspective.
- **Dotted-line blanks and blanks with no line or box**, such as a gap after a colon: add them by hand.
- **Long PDFs**: only the first 10 pages are shown and filled; the rest are kept as they are. A locked PDF is filled as
  pictures of its pages, so its pages after the tenth are not in the filled copy, and the page says so.
- **XFA forms** (an Adobe-only kind) cannot have their own fields read; PDFs with turned pages use found blanks rather
  than their own fields.
- **Fonts**: answers are set in Helvetica; letters it cannot draw are swapped for plain ones.
- **Many copies** are print-ready only (each copy's fields would clash with the next).

## Run it

Node 22 or later, and poppler (`pdftotext`, `pdftoppm`) for the tests. The stock `age` tool is optional: where it is
installed, `tests/interop.test.js` also opens a backup with it (CI installs it, and fails if it is missing there).

```sh
npm ci
npm test                          # the library and the command line, on invented forms
npm run build                     # makes dist/
npx playwright install chromium webkit   # once: the two browsers the walk drives
node scripts/walk.cjs dist        # the whole page in Chromium at phone size
node scripts/walk.cjs dist --engine webkit   # the same in WebKit
node scripts/walk.cjs dist --handwriting     # also reads the synthetic handwritten pages
node scripts/walk-mac.cjs dist    # the Mac app's screens, clicked through over a stand-in for the app
node scripts/walk-mac.cjs dist --engine webkit   # the same in WebKit, the app's own engine
node scripts/walk-mac.cjs dist --slow 20         # the same with every answer of the stand-in 20 ms late
npm run check:handwriting         # the same reader in Node, with a character error rate
npm run hooks                     # once, if you will commit: turns on the never-list gate
```

The Mac app, on a Mac with Xcode's command line tools and Rust 1.90 or later (through `rustup`):

```sh
npm run mac:build                 # the page, then the app: src-tauri/target/release/bundle/macos/Form Filler.app
npm run mac:test                  # the app's Rust tests
npm run mac:check                 # a test build ("Form Filler Test"), then its checks inside its own window
npm run mac:try                   # that test build opened for you to try, with nothing of yours in it
npm run mac:dev                   # the app over Vite's server, redrawn as the page's code changes
```

`mac:build` makes the app's icons from `public/icons/icon-512.png` first, and takes a few minutes the first time
(cargo downloads and builds Tauri once). Open the app from Finder, or drag it to Applications. `mac:check` uses a
temporary folder in place of the app's data folder and of your home folder, so it reads and writes nothing of yours;
its window stays small, in a corner and above the others while it runs, because a window that cannot be seen is
slowed down. `mac:try` opens the same test build for a person: a folder named `Form Filler Trial` in your home
folder stands in for your home folder and for the app's data, so the vault and the archive you make in a trial are
not yours. Delete that folder when you are done.

Each push to `main` that passes the tests publishes the page to GitHub Pages (`.github/workflows/pages.yml`). Or unpack
a built folder and run `python3 serve.py` (port 8771). On a phone: open the page, then Share → Add to Home Screen
(iPhone) or Install app (Android).

The test forms and pages in `tests/fixtures` are invented (`scripts/make-fixtures.py` and
`scripts/make-option-fixture.mjs` draw them); the pictures in this README are made by `scripts/shots.cjs`.

## Roadmap (planned, not built)

None of this exists yet. The plan is in [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md); what the code was before it started
is in [docs/INVENTORY.md](docs/INVENTORY.md), and how phase 2 was built (the Mac app, the vault, the archive and
backups, all above) is in [docs/PHASE2_PROPOSAL.md](docs/PHASE2_PROPOSAL.md). The wider direction the worked example
belongs to — paperwork brought in however it arrived, a vault of the things forms keep asking for with the documents
behind them, a library of forms, blank packets sent as one link, and control of what comes out — is in
[docs/PAPERWORK_PROPOSAL.md](docs/PAPERWORK_PROPOSAL.md).

- **A library of forms** to search in plain words, each saying who issued it, where it applies and when it was last
  checked. The first screen's third choice says it is not built.
- **Filing by itself**: every PDF made in the app filed as it is made, files dropped into `_Inbox` read and filed,
  and a matter suggested, with anything uncertain left in `_Unsorted`. Today filing is a button you press.
- **Pre-flight checks** before anything is sent: empty blanks, missing signatures, dates, conflicts.
- **The Crab**, a guide on the page that walks the blanks, explains each field from the form's own instructions, and
  says when it cannot check something.
- **Taxes**: documents gathered through the year and a return prepared from them, filed through the IRS's own free
  forms or by mail.
- **A phone app** paired with the laptop over the local network, and **a browser extension** that fills web portals
  and leaves the submit click to you.

Where it stands: phase 1 (the inventory) is done. Of phase 2, the never-list gate and the fixes for WebKit, older
browsers and long PDFs are in 2.2.0, checkbox labels in 2.3.0, tables with tight rows in 2.3.1, and table cells named
by their headers in 2.4.0. A throwaway spike of the
Mac app has run ([docs/SHELL_SPIKE.md](docs/SHELL_SPIKE.md)), the archive is built as a library and a command
(2.5.0), the vault keeps your details locked (2.6.0), backups are built as a library and a command, with a
restore tested by wiping and restoring (2.7.0), and the Mac app with its screens for all three is built (2.8.0).
The page's first screen and its worked example are 2.9.0, the first slice of the paperwork proposal above, and the
finder — a bank of invented forms searched in plain words, with no model and no invented results — is 2.10.0, its
second.
What phase 2 still lacks is its own check, done by a person on a real document: wipe, restore, and everything comes
back.

## Licence

MIT ([LICENSE](LICENSE)). The page bundles Tesseract.js (Apache 2.0), ONNX Runtime Web (MIT), Transformers.js
(Apache 2.0), pdf.js (Apache 2.0), pdf-lib (MIT), and for the vault age-encryption (BSD 3-Clause) with the noble and
scure cryptography libraries (MIT); their licence files are copied into the build (`ocr/`, `ort/`,
`licenses/`). The handwriting models are Microsoft's TrOCR in Xenova's ONNX conversion, downloaded at run time, not
bundled: Microsoft's code for TrOCR (the unilm repository) and the base model's card say MIT; the small model's
Hugging Face card names no licence (checked 2026-11-13).
