# Changes

## 2.9.0 (2026-11-22)

- **The page opens on three ways in**, instead of asking you to find a form first: *try an example*, *use my own
  form* (the same picker as before: choose, drop or paste a form, or open a template), and *find a form*, which says
  plainly that there is no library of forms yet and shows nothing rather than made-up results.
- **A worked example, start to finish in about half a minute.** "Starting a new job in Indiana": one tap opens an
  invented person's new-hire packet with its answers already in place; change the address once and it lands on both
  forms that carry it, and on neither of the others; then two previews side by side show what the people office
  would receive and what payroll would receive, with the bank details in payroll's and not in the other's.
  Everything in it is invented — the person, the employer, the credit union, both addresses, the account numbers and
  the three forms, each marked "(invented form)" in its own title. Nothing is sent, nothing is saved, no vault is
  made, and none of your own details are asked for. Leaving it brings back the three choices and leaves nothing
  behind. The same example runs in the Mac app.
- Bank numbers in the example are shown by their last characters, as everywhere else in Form Filler.
- **Where this is going** is written down in [docs/PAPERWORK_PROPOSAL.md](docs/PAPERWORK_PROPOSAL.md): paperwork
  brought in however it arrived, a vault of the things forms keep asking for with the documents behind them, a
  library of forms that says who issued each one and when it was last checked, blank packets sent as one link, and
  control of what comes out. The example is its first slice; the rest is proposed and not built.
- Tests: 379 unit tests (370 before); the page's walk is 45 steps (39 before) and the Mac screens' walk 12 (11
  before), both in Chromium and in WebKit.

## 2.8.0 (2026-11-21)

- **A Mac app** (phase 2, slice 5): the same page in a window of its own, built with Tauri from `src-tauri/`
  (`npm run mac:build`), with what a web page cannot have: real folders. There is no download yet: it is built on
  your own Mac, and is signed only by the build itself. A bar across the top goes between filling a form and the
  app's own screens:
  - **First run**: a passphrase makes your vault, the recovery key is shown once and can be printed, and you say where
    the archive lives (`~/Form Filler Archive`, or a folder you pick, with a warning if that folder is one a syncing
    service copies elsewhere). Or a backup is restored instead.
  - **Locker**: a document sealed into the vault, listed, and a copy saved back out, the same bytes. Nothing is
    removed from it in this version.
  - **Archive**: everything filed, by matter; an item shown in Finder or moved to another matter; every file read
    again and compared with its fingerprint.
  - **File this PDF in the archive…**: after a filled PDF is saved, it is filed with the form it was made from, in a
    matter you name or in `_Unsorted`, with a record that carries both fingerprints.
  - **Backups**: made on a drive or folder you pick, read back from it, checked against their fingerprints or opened
    with your passphrase and checked file by file. **Restore** checks every file before anything is moved and
    overwrites nothing: what is there stays, and the restored copy goes beside it. With no vault, the backups already
    made can still be listed, checked and restored.
- **Your name, date of birth and street address stay off the screen** in the Mac app until you press *Show them*
  (the privacy wall's fifth part): in *Your details* and on the filled form they show by their last four characters,
  fewer for a short value. The PDF carries them whole, and printing shows them first.
- **In the app, everything is in folders a backup carries**: the vault, the forms the page remembers
  (`templates/<sha256>.json`) and its settings (`settings.json`) are files in the app's data folder, not in a
  browser's storage.
- **What the app can reach**: its own data folder, a folder you pick in a dialog, and, in your home folder, only
  Form Filler's own names (`Form Filler Archive`, a restored copy of it, and a hidden staging folder while a restore
  runs). Its window opens no web address and fetches nothing from one (a strict content policy), so *Read
  handwriting*, which downloads its model, is left out of the app.
- **A file interface for the app** (`src/app/files-tauri.js`, `src/app/store-tauri.js`) with every promise the
  command line's has. Tauri's file plugin never writes a file through to the disk and has no way to give a file a
  name only if the name is free, so the app adds those in Rust (about 310 lines in all, where the proposal hoped for
  a few dozen). Forgetting the vault in the app removes its empty folder too, so a later restore puts the vault back
  in place.
- **Tightened after one review**, each with a test: the app's own list of the folders you picked is out of the
  page's reach (a page that could write it could grant itself any folder at the next start); the app says nothing
  about a file outside the folders it was granted, not even whether it is there; a file is synced the plain way on a
  disk that cannot do the strongest kind (a network share), so a backup there is not refused; a lock left by a page
  that was loaded again is taken over instead of locking the archive until the app is quit; "It is somewhere else…"
  never makes a new, empty archive; after a restore, finished or not, the settings and the vault are looked at again
  before anything is written; a document's size is asked before it is read into the locker; a backup drive that is
  not plugged in is said to be gone, not empty; and details shown only to be printed are hidden again at the next
  click.
- **Found by GitHub's own run of the screens' walk**, on its Mac, the first time the branch was pushed: the filing
  screen was drawn again when the archive's list arrived, and a matter being typed at that moment lost the caret, so
  what was typed next went nowhere and the form was filed with no matter. The list now arrives without the screen
  being drawn again, any redraw keeps the caret and what was typed, and the walk types exactly as the list arrives.
- **Checks**: the archive's and the vault's own tests also run on the app's files and store; `scripts/walk-mac.cjs`
  clicks through every screen in Chromium and in WebKit over a stand-in for the app, moving everything aside and
  restoring it byte for byte; `npm run mac:check` runs the file code and the same clicks inside the app itself,
  against the real plugin. Not checked: anything that needs a click in a real dialog (the folder, save and file
  panels, and printing) has not been clicked by a person yet.
- **Measured in the app**, with its window in view: a made-up archive of 2 GB in 8,720 files is backed up in 55 s,
  checked fully in 32 s and restored in 85 s. **A window that cannot be seen is several times slower** (macOS slows
  the page of a hidden, minimized or covered window), and a PDF opened in a hidden window waits to be read until the
  window is shown. The screens say to keep the window in view.
- Tests: 370 unit tests (326 before), 8 in Rust; both walks of the web page pass unchanged.

## 2.7.0 (2026-11-21)

- **Backups, encrypted, and a restore tested by wiping and restoring** (phase 2, slice 4). A backup is one snapshot of
  the archive and the vault, with the templates and settings beside it, written to a drive or folder you pick, in
  `Form Filler Backups/2026-11-17 1530/`: `snapshot.tar.age`, a plain tar sealed with age to the vault's public key
  (so a backup needs no passphrase and can be made while the vault is locked); `identity.age`, the vault's key, locked
  with your passphrase; `snapshot.sha256`, both files' SHA-256, for `shasum -a 256 -c` or `sha256sum -c`; and
  `README.txt`, how to restore with Form Filler and without it (the same text is [docs/RESTORE.md](docs/RESTORE.md)).
  A backup is put together out of sight and read back from the drive before it is given its name, so it appears whole
  or not at all. Form Filler never deletes one.
- A restore writes nothing until the copy matches its fingerprints and your passphrase or recovery key opens it. Then
  it unpacks out of sight, checks every file against the snapshot's manifest, and checks that the vault opens and its
  details and locker documents read back; only then does it move each thing into place, with one rename. It never
  overwrites: whatever is there stays (an empty folder too), and the restored copy goes beside it as
  `… (restored 2026-11-17 1530)`, the date of the backup. A wrong passphrase, a damaged or cut-short copy, a snapshot
  that does not match its manifest, and a vault that does not open are each refused, with nothing left behind. A
  damaged `identity.age` stops only the passphrase: the recovery key restores without it.
- What the checks prove is that a backup is undamaged and sealed to your vault's key, not that you made it: anyone
  with the vault's public key could seal one, so keep backups on drives you control. A restore says what the vault
  held, and it and `verify --fully` both say when a snapshot's vault holds no details and no locker documents.
- On the command line: `form-filler backup make`, `list`, `verify` (with `--fully`, the snapshot opened and every file
  checked against its manifest, writing nothing) and `restore`. A passphrase is never a flag: it is asked for without
  showing what is typed, or read as one line from standard input. Ctrl-C while `make` or `restore` is under way
  stops it as a failure would, with what was staged removed (exit 130).
- In the library: `makeBackup`, `listBackups`, `verifyBackup`, `restoreBackup` and `README_TEXT` (`src/lib/backup.js`);
  `unlockKey` (`src/lib/vault.js`), the vault key on its own, from a backup's copy of its key file or the recovery
  key; and `readStream`, `createFileFrom` and `discardStaging` in the file interface (`form-filler/files/node`). The
  snapshot's tar is written and read by `src/lib/tar.js`, a small writer and a strict reader written here: no tar
  library.
- Checked against the stock tools (`tests/interop.test.js`). On this Mac: the system's tar (bsdtar 3.5.3) unpacks a
  snapshot's tar to every file its manifest lists, byte for byte (it writes accented names in their other encoding,
  which the Mac takes for the same names), and `shasum -a 256 -c` and `sha256sum -c` pass `snapshot.sha256` and fail
  a damaged copy. In CI, on GitHub's Linux runner, which installs `age` and fails without it: GNU tar 1.35 unpacks
  the tar with every name exactly as written; the stock `age` 1.1.1 opens the snapshot by README.txt's own line with
  the recovery key, then every vault file but the key file, and writes a document out by README.txt's line for that;
  and it opens the snapshot by the same line with the passphrase, typed at a terminal, which opens the key file
  itself. The stock `age` has not been run on a Mac: it is not installed on the one this was built on.
- `@noble/hashes` 2.4.0 is now a dependency, pinned. It was installed already, as age-encryption's own; backups use
  its SHA-256 a piece at a time, so a large file is never held whole.
- The page does not make backups yet; the Mac app will. The web page's own vault, in the browser, is not backed up.

## 2.6.0 (2026-11-20)

- **Your details and saved signature are kept locked** (phase 2, slice 3; the privacy wall's part 6). The page used to
  keep them in this browser's storage in plain text, where any page published at the same web address could read
  them. Now they are kept in an encrypted vault in the browser, locked with a passphrase you choose. Saving your
  details the first time asks for the passphrase (twice) and shows a recovery key once, to print or write down: the
  only way back in if the passphrase is forgotten. On a later visit your details are locked until you unlock them; they
  lock again when you close the page or leave it alone for 15 minutes. *Lock now*, *Change my passphrase* and *Forget
  my details* (asked twice) are beside them. The signing pad keeps a signature only while your details are unlocked.
- Details an earlier version kept in plain text are used as before, with a note at the top of the page saying so,
  until you lock them away with a passphrase or forget them; then the plain copies are gone. Plain copies found beside
  a vault are never used (this version never writes them): they can only be forgotten.
- What the vault cannot stop is said plainly (README, Privacy): another page at the same web address can still script
  this one while it is open. Against that, the page now refuses to run inside another page or in a window another
  page opened, and its service worker serves a kept file only while it matches the fingerprint its build wrote.
- **A web address of its own** (2026-11-21): the page moved from `swixixle.github.io/form-filler/` to
  <https://formfiller-app.github.io/form-filler/>, the address of the project's own GitHub organization, where nothing
  else is published, so no other page shares its storage. This version, the first with the vault, was never served at
  the old address. At the new address you start again. What earlier versions kept at the old one is in plain text and
  may still be there, and a browser that opened the page there may go on opening its old copy, which does not hear of
  the move; README, Privacy, says how to remove both. The repository moved with it, to `formfiller-app/form-filler`;
  GitHub sends links to the old one on.
- Two tabs keep to one vault: each hears when another makes, changes, locks or forgets it, and a tab whose vault was
  forgotten under it is refused when it writes. The idle lock counts the clock, so a computer that slept comes back
  locked. *Forget it* forgets a saved signature everywhere it was kept. Remembered forms no longer keep the file's name.
- **The vault** (`src/lib/vault.js`), for the page now and the Mac app next: an age key pair made on first use,
  locked with the passphrase (scrypt); your details and signature, and a locker of documents with each one's SHA-256,
  locked to the key. Every file is a standard age file, meant to open with the stock `age` tool (checked in slice 4).
  Each record also carries a tag only the vault key can make, so a damaged or swapped file, or one sealed by someone
  else to the public key, is refused. It keeps its files in a store: in memory, in a folder, or in a browser's
  IndexedDB.
- `age-encryption` 0.3.1 is now a dependency, pinned; it loads only when your details are used.

## 2.5.0 (2026-11-20)

- **The archive, as a library and on the command line** (phase 2, slice 2). A plain folder of everything that came
  in or went out, filed by matter: each item is a dated folder ("2026-11-17 sent IRS - Form 1040") holding its files
  behind role words and a `record.json` with each file's SHA-256. Nothing in it is ever deleted or overwritten: the
  archive works through a file interface that has no delete and no overwrite, a name that is taken gets " (2)", and a
  record that changes is written anew with the old one kept. An item nobody filed goes to `_Unsorted`. The index
  (`.formfiller/index.json`) is a cache, kept up to date and made again from the records at any time, so the folders
  can be rearranged in Finder; `verify` reads every file again and says what is missing, changed or not recorded,
  which items the index knew have left the archive, and what a stop left unfinished, and changes nothing. One program
  at a time changes an archive (a lock in `.formfiller`; one left by a program that stopped is taken over).
- On the command line: `form-filler archive add`, `file`, `move`, `index` and `verify`. Their flags are read
  strictly: one the command does not know, one given twice or one with no value is refused, so a file is never taken
  for a flag's value and left out.
- In the library: `openArchive`, `readRecord`, `cleanName`, `matterPath`, `itemsWithFile`, and `nodeFiles` (from
  `form-filler/files/node`), the file interface over Node.
- One SHA-256 helper (`src/lib/hash.js`) for the page, the library and the command line, which each had their own.
- The page does not use the archive yet; the Mac app will.

## 2.4.1 (2026-11-19)

- **Many copies from a CSV, after blanks are changed by hand.** The page matched a CSV's columns to blank numbers once,
  when the CSV was opened. Adding or removing a blank by hand afterwards moved the numbers, so the columns for the
  blanks after it landed one blank off: on the invented form, removing blank 1 sent a "Day" column to the Night box
  (defect 16, in 2.2.0 too). Now each column keeps to the blank it was matched to, and a column whose own blank is
  removed says so and fills nothing. A walk step makes the copies after removing and adding blanks, and checks that
  the tick is in the Day box.
- In the library: `columnIds` and `columnsNow` keep a CSV's matched columns to their blanks, by each blank's `id`.

## 2.4.0 (2026-11-19)

- **Table cells named by their headers.** A cell under a table's header row was listed as "blank". Now, in a table with
  two empty rows or more, it is listed by its column's header ("Item", "Serial number", "Qty"), so the list shows what
  goes where. The page's read of a whole form does not return a ruled header row's words, so each header cell is read
  on its own instead, twice: as it is, and from a copy enlarged twofold. The cells are named only when all of these
  hold:
  - both reads say the same, letter for letter, but for misread letters told by their neighbours ("[tem" for "Item",
    "TotaI" for "Total", "N0." for "No.");
  - the first read is at least 60% sure;
  - the header row is closed by a rule over it and the column's walls, and is the table's top row.

  Otherwise they stay "blank": a wrong name is worse than none.
- **Measured on an invented set made to trip it:** 75 headers, including smudges, logos, scribbles, handwriting,
  two-line and one-character headers, and photographed copies. No cell was named wrong. Of the 193 cells found under a
  real header, 167 were named and 26 left blank, mostly under handwritten or photographed headers. The 32 cells under a
  smudge, logo, scribble or empty header all stayed blank. An independent review then found six ways to a wrong name
  that the set did not cover, and they are closed:
  - a column run on across the caption rows of a boxed form, or into a second table;
  - a cramped header cut at the wall ("Neight" for "Weight");
  - a filled-in row taken for the header;
  - a misread letter settled one fixed way;
  - a row's own label taken for part of the header;
  - a caption over a single field taken for a column.
- A table's first row could already take words from its header when the page's read reached them, sometimes only part
  of a header ("price" for "Unit price"). Such a label (whole words of the header) now becomes the whole header once it
  reads the same twice, and is dropped when it does not.
- **A cell named from its column's header is never filled with your details** or today's date, whatever the header
  says: a "Name" or "Date" column belongs to many rows. A single field under its own caption cell is no table and is
  filled as before.
- A CSV column named like a header goes to the form's own blank of that name, if it has one ("Name:" over a table with
  a Name column); the table's cells alone match no column (which row would it be?). Columns by number still reach them.
- A template with cells named from a header says version 2, which older versions of the program refuse rather than
  fill every row of a Name column with one name.
- No new download: the header reads use the same reader as the rest of the page. On the invented form (three
  headers) they add about a tenth of a second to finding the blanks: 85 to 140 ms, measured in Chromium and WebKit on
  a Mac.
- Known limits:
  - Two reads can agree on the same misreading (a column headed "lbs" is read "Ibs" both times, and named so).
  - A table directly under another with the same columns has no header read: its walls run on up into the first.
  - A form remembered by an earlier version keeps its labels until *Find the blanks again*.
- In the library: `headerLabels` names a page's table cells from two reads of each header cell, given a function that
  reads a small picture; `headerCells` and `headerLabel` are its parts. A template keeps the mark (`column: true`).

## 2.3.1 (2026-11-19)

- **Tables with tight rows.** In rows under about 25 pt, the upright strokes of a header's letters passed for cell
  walls, so the header cell was split and its pieces were offered as blanks. Every answer typed after them landed one
  blank late. Now a piece beside a stroke that is surely a letter is not offered. The rows are still cut where they
  were, so every cell 2.2.0 and 2.3.0 found is still found:
  - walls drawn short of the rules, broken or rounded;
  - a box with a unit at its right ("Weight ___ kg");
  - two fields in one box ("Signed ___ Date ___").

  On 360 invented tables the pieces fall from 430 to 12, with no cell lost and no blank added.
- **Still left.** A letter within about 1 pt of a rule can still split its cell, more often on photos. A labelled
  field over an empty box ("Holder: ___") is taken for a table's header, as it already was in roomy rows. The
  measure found four older defects, logged in `docs/INVENTORY.md` (12 to 15). The worst is a header cell in small
  print or with a short word ("ID", "No."), which is offered as a blank.

## 2.3.0 (2026-11-19)

- **Checkbox labels.** A checkbox is labelled by its own caption, on its right ("[ ] Yes") or its left ("Yes [ ]"),
  judged for the whole group of boxes on its line. Before, it took the words on its left: on the invented form the box
  beside "Day" was called "Shift" and the Night box "Day", so a CSV column "Day" ticked the Night box.
- **Never a guess.** When the words that belong to a box cannot be told, the box is listed as unclear, with the words
  it might be, and no CSV column goes to it. That covers a word as near one box as the next, a note, number, code or
  price beside a caption ("Yes – go to Q8", "Adult $12", "500 ml"), answer codes, a caption that may run on to the
  next line, headings over boxes that have words beside them too, and a lone box between a question and another
  field's prompt or a note ("Member? [ ] Number: ___", "Paid? [ ] (optional)"). The rule leans to unclear: some
  captions a person could tell are left unclear as well. Notes, prices and codes it does not recognise ("Adult
  12pp", "Daily DY") can still end up in a box's name; the tests list them as known limits.
- **Forms and templates from an earlier version** keep their blanks and old labels, so blanks added or removed by hand
  are not lost, and say so; *Find the blanks again* names their checkboxes anew.
- A CSV column named like both a checkbox and the line its caption names ("[ ] Other: ____") goes to the line, as
  before. `form-filler check` lists an unclear checkbox with the words it might be.
- In the library: `labelBlanks` labels a page's blanks; `cleanWords` drops the reader's words for a checkbox's square
  and recovers a caption the reader ran into it. Templates keep `unsure`, and mark labels made this way (`labels: 2`).

## 2.2.0 (2026-11-17)

- **Safari, iPhone and other WebKit browsers:** two things that are not blanks were taken for blanks on PDFs there (the
  ring of a "Q" as a checkbox, the tops of a bold heading's letters as a line), which put every later answer one blank
  late. A checkbox must now have corners, and a line must be ink nearly all the way along with nothing hanging from
  it. The whole page is now walked in WebKit as well as Chromium, on every push.
- **Older browsers:** a PDF now opens in a browser a year or two old (it stopped with "getOrInsertComputed is not a
  function").
- **Long PDFs:** a PDF with no fields of its own and more than 10 pages lost every page after the tenth in the filled
  copy. All pages are kept now, in order. In the library, `buildPdf` keeps a source PDF's unlisted pages unless
  `keepOtherPages: false` is given.
- **What the browser kept is checked before it is used:** a saved signature must be a PNG picture, and saved details
  must be text.
- **Round option buttons** drawn on a flat page: the library can find them, each set as one choice (`findOptions`,
  `nameOptions`). The page does not use them yet.
- **Privacy in the repository:** a gate stops any commit that carries personal information, on the maintainer's
  computer and again on GitHub (`never-list/README.md`).
- MIT licence. The README is rewritten for what works today, with new pictures, and the plan is kept apart under
  "Roadmap". The planning documents are in `docs/`.

## 2.1.0 (2026-11-16)

- **Answers on paper, by number.** Write each answer after its blank's number ("3 Jane Roe"), in any order, photograph
  the page, and each goes to its blank. A line whose number cannot be read is left out and named, not put in order.
- **Send.** The filled PDF goes to Mail, Messages or anything else the device's share sheet offers.
- **Radio buttons** in a PDF get a button over each of the form's own, instead of one box over them and their words.
- **On a computer:** drop or paste a form onto the page; the answers box gets the cursor and sits beside the form;
  ⌘S / Ctrl+S downloads the editable PDF.
- The answer rules are one line, with the rest folded away. Blank numbers are a little larger on wide screens.
- **No old copies:** the page names its version at the foot, looks for a newer one each time it is opened, and moves
  to it by itself (if a form is open, it says so and waits).
- The README shows the paper workflow with screenshots of the live page.

## 2.0.0 (2026-11-13)

A library apart from the page; a PDF's own fields as blanks; templates; your details and today's date; signing;
many copies from a CSV; handwriting read on the device; offline; tests and the GitHub Pages deploy.

## First version (2026-11-13)

Blanks found from a form's own lines, filled from loose answers, out as an editable or print-ready PDF.
