# Phase 2 proposal: shell, vault, archive, backup

Written 2026-11-17, after the inventory ([INVENTORY.md](INVENTORY.md)), for the plan in [BUILD_PLAN.md](BUILD_PLAN.md).
It was written as a proposal. **Status, evening of 2026-11-17:** approved, with the rulings recorded under
[Decisions](#decisions-ruled-2026-11-17). **Status, 2026-11-21:** the never-list gate and slice 0 are built and
tested. Slice 1, the throwaway shell spike, ran on 2026-11-20 ([SHELL_SPIKE.md](SHELL_SPIKE.md)). Of slices 2 to 4,
the archive (2.5.0) and backup and restore (2.7.0) are built as library modules with their commands, and the vault
(2.6.0) as a library module the web page uses. The Tauri shell itself, slice 5, is built on branch `phase-2-shell`
(2.8.0): its groundwork ([As built, part 1](#slice-5-as-built-part-1-the-groundwork-2026-11-21)) and its screens
([As built, part 2](#slice-5-as-built-part-2-the-screens-2026-11-21)). Slice 6, the owner's own drill on a real
document, is not done.

Marks: **[V]** verified: run here, read here in the code named, or read on the page linked. (The Tauri and age pages
were read by a fetch helper whose report is relayed here. The shell spike of 2026-11-20 then ran Tauri, built with
plain `cargo`, and `age-encryption` in its webview; Tauri's command-line tool has not been run. The stock `age` tool
has been run in CI only, by `tests/interop.test.js` since 2026-11-21: age 1.1.1 on GitHub's Linux runner, not on
this Mac.) **[I]** inferred, to be confirmed before it is relied on.

## The proposal in one paragraph

Keep the code the repository already has and add three plain-JavaScript modules beside it (`archive`, `vault`,
`backup`), tested with the `node:test` setup that exists, each working through a small file interface. Wrap the
existing page in a thin Tauri shell whose only job is to give those modules real files. Encrypt with **age**, a
standard, published file format, so the vault and every backup can be opened with a stock command-line tool even if
Form Filler is gone. Keep the archive a plain folder, as the plan says. Before any of that, make the tests run in
WebKit, because the shell *is* WebKit and the inventory found the form reader misbehaves there.

## What phase 2 delivers, and what it does not

Delivers:

- A Mac app (Tauri) that shows today's Form Filler page and can read and write real folders.
- A vault: your profile, saved signature and a document locker, encrypted at rest, opened with a passphrase.
- The archive folder with its `record.json` files, an index, and the two rules built in: never delete, never misfile.
- An encrypted backup snapshot to a folder or drive you pick, and a restore.
- The plan's check, as an automated test and as a drill you run yourself: wipe, restore, everything comes back.

Does not deliver (later phases): pre-flight, matching blanks to the vault, the Crab, the ledger, Gmail, the watched
`_Inbox`, phone pairing, the extension, taxes. The public web page keeps working exactly as it does today.

One addition I recommend beyond the plan's wording: **a "File in archive" step on export, inside the shell only.**
The plan puts auto-archive in phase 3, but its phase 2 check needs a real document in the archive to back up and
restore, and its ordering rule is "the archive exists before anything is sent".

## The privacy wall in phase 2

The plan's privacy wall has six parts ([BUILD_PLAN.md](BUILD_PLAN.md)). Where each one lands:

| # | Part | In phase 2 | State |
| --- | --- | --- | --- |
| 1 | Data lives outside the repo | The vault in the app's own data folder, the archive at `~/Form Filler Archive/`. The gate also refuses to commit vault files (`.age`), anything from the archive or backup folders, and the local never-list | Gate: built. Folders: with the shell |
| 2 | Never-list commit gate | A pre-commit hook and a commit-message hook on the Mac, and the same check in both GitHub workflows, over every file and every commit. Patterns only in the repo. Your real values are kept nowhere: `never-list/local.txt` (which git ignores) holds a keyed fingerprint of each, and the key is in the Mac's Keychain | **Built, first commit of the branch** |
| 3 | Fake data only | Already how the repo works. The gate now enforces it for anything that is not text: a picture, PDF or video is refused until a person lists it as invented | **Built** |
| 4 | The Crab never holds the key | A rule for phase 4 that phase 2 must not make hard: the vault hands out values through one narrow call that takes "this form, these fields, approved by the owner", and the part that talks to a model is given that result, never the vault or its key. A test will check the Crab's code cannot import the vault | Design rule; nothing to build yet |
| 5 | On-screen masking | Every vault field has a kind. Kinds on the never-list (name, birthdate, address, Social Security, licence, routing and account numbers) show their last four characters in the profile, the locker and on the filled form, until you press to reveal | With the shell's screens |
| 6 | No shared browser storage | In the Mac app, storage belongs to the app alone. On the web page, details and the signature move out of plain `localStorage` into the same encrypted vault format, kept in the browser and opened with a passphrase. Until then the page checks what it reads back (done in slice 0) | Check: built. Encryption: with the vault module |

**Can the live page be fixed now?** In part. The live page keeps your details and saved signature as plain text in
storage that other pages published under the same GitHub account can also read and write (**[I]**, from how
browsers scope storage; not tested). The quick part is done on this branch as its own small
commit: what comes back from storage is checked and escaped, so a planted value can no longer run as code. That can go
to `main` by itself whenever you say. The rest, keeping another page from *reading* them, needs either encryption
with a passphrase (the vault, below) or giving the page its own site address; neither is a quick fix. Until then,
"Forget my details" and "Forget it" on the live page remove what is stored.

Part 6 adds one thing to this proposal's scope: the vault module must run in a browser as well as in the shell. It was
already written against a small storage interface, so this is one more adapter (the browser's IndexedDB), not a second
vault.

Found in slice 3's review (2026-11-20), and corrected here: encryption with a passphrase keeps other pages at the same
address from *reading* your details out of storage, but not from *scripting* the page while it is open. A page there
can open Form Filler in a frame or in a window it holds and read what is typed, or rewrite the copy the service worker
keeps (they share its cache). The page now refuses to run in a frame or a window another page there holds, and the
service worker serves a kept file only while it matches its build's fingerprint; that leaves a page there able to
delete or replace the vault's files, and to guess at the passphrase against a copy of the key file. Only an address of
its own closes this off: a custom domain for this site, or a GitHub Pages site of its own. That is the owner's choice.
**Done** (2026-11-21): the repository moved to its own GitHub organization, `formfiller-app`, and the page is now
served from `formfiller-app.github.io/form-filler/`, where nothing else is published. 2.6.0, the first version with
the vault, was never served at the old address.

## Slice 0: fix the ground first

The shell renders pages with the Mac's own WebKit. The inventory found, in a WebKit build **[V]**:

- a phantom blank on both PDF test forms, shifting every later answer by one (defect 1);
- no test in the repository or in CI runs on WebKit at all.

And in an older Chromium, PDFs do not open (defect 2) **[V]**.

So before the shell:

1. Declare Playwright in `package.json` and give `scripts/walk.cjs` an `--engine webkit` switch. CI runs both.
2. Try pdf.js's `legacy/` build for defect 2. It exists in the installed package **[V]**; that it cures the failure
   is **[I]** until run.
3. Fix or fence defect 1. First experiment: the stricter thresholds from patch 0002, which were written for the same
   symptom. Untested in WebKit **[I]**.
4. Fix defect 3 (pages lost past page 10) or make the page refuse such a PDF. An archive that promises "the exact
   bytes" cannot sit behind an export that drops pages.

Check: the walk passes in Chromium and in WebKit, or each remaining failure is written down as known.

### Slice 0: done (2026-11-17)

Every fix has a test that failed on the old code and passes now. "Walk" is `scripts/walk.cjs`, 27 steps.

| Defect | What changed | The test that failed before and passes now |
| --- | --- | --- |
| 1. Phantom blanks in WebKit | `src/lib/blanks.js`. A checkbox must have ink in at least three of its four corners, and its top and bottom must end at the same places. A line to write on must be ink at least 90% of the way along, with nothing hanging directly under it | Unit: `tests/blanks.test.js`, on two new fixtures that are the invented PDFs exactly as WebKit 26.6 drew them. Walk in WebKit: the two PDF steps and their three knock-on steps |
| 2. PDFs fail in an older browser | `src/app/main.js` loads pdf.js's `legacy/` build (about 60 kB more for the reader and for its worker) | Walk: a new step takes the missing features away from any browser and opens a PDF. Also the whole walk in the real Chromium 143: 11 steps failed before, none now |
| 3. Pages lost past page 10 | `src/lib/output.js` copies a PDF whole, in order. A locked PDF's later pages still cannot be carried; the page now says so instead of saying they are kept | Unit: `tests/lib.test.js`, a 12-page PDF comes out with 12 pages (was 10). Walk: the same on the page itself |
| 8, in part. Stored values written into the page unchecked | `src/app/main.js`: a saved signature must be a PNG picture, saved details must be text, and both are escaped where they are written | Walk: a planted "signature" that would have run as code does nothing |

Walk results **[V]**, same day, on the test machine:

| | Before the fixes | After |
| --- | --- | --- |
| Chromium 153 (the build CI uses) | 24 of 27 (the three new steps fail) | **27 of 27** |
| WebKit 26.6 (Playwright's build) | 17 of 27 | **27 of 27** |
| Chromium 143 (a year-old build) | 16 of 27 | **27 of 27** |

`npm test`: 30 tests, all passing, on Node 20 and 24 (20 before, plus 8 for the never-list gate and 2 for these fixes).

What was learned on the way:

- **Chromium was passing by one pixel.** The "Q" is drawn almost identically in both engines; a single row of
  anti-aliasing kept Chromium on the right side of a threshold. The rule is now about shape, not about that pixel.
  **[V]** (the pixels were printed and compared).
- **Patch 0002's thresholds would have fixed half of it.** Its larger minimum checkbox (about 20 px here) is above the
  "Q" (17 px), but its longer minimum line (157 px) is below the phantom line (199 px). **[I]**: worked out from the
  patch's stated numbers, not run.
- **The offline step failed in WebKit because of the test tool.** With the server really taken away, WebKit reloads
  the page from its kept copy and works; Playwright's "offline" switch breaks that in WebKit only. The step now takes
  the server away in every engine. **[V]**
- **Round option buttons were never found, before or after.** (An earlier version of this note said the corner rule
  had cost them; that was wrong.) On an invented form with 14 round buttons (`tests/fixtures/options.pdf`) the old
  finder found none of them in any rendering; what it found instead was letters, up to eight capital O's and Q's taken
  for checkboxes in WebKit. The new finder finds neither. **[V]** A PDF's own radio buttons are found and filled, and
  the chosen one is marked in both kinds of filled copy. **[V]**
- **A rule that does find them** is written and tested in the library and not yet used by the page:
  `findOptions`. A button is a ring of ink that is round, hollow, thin, at least about a third of a line high, and
  standing apart from what is beside it; and it never comes alone, so a ring counts only with another the same size on
  its line or straight above or below. Each such set is one blank where one button may be chosen. On the invented form
  it finds all 14 buttons in the right 6 sets in three renderings (poppler, Chromium, WebKit) and takes none of the
  letters; on the forms that had phantom blanks it finds nothing. **[V]** Still to do before the page can use it: the
  filled PDF must carry the set as a real radio group, templates must remember the buttons, and the page must name
  each button from the words after it (`nameOptions` does that from the text reader's words). Not tried on a real
  form. Known limit: two lone capital O's of one size on one line, each standing apart, would pass for a set.

Still not verified: real Safari, an iPhone, any real form, and the walk in the Tauri window; the shell spike
(2026-11-20) opened the page there and read the invented `form.pdf`, 13 blanks found as in the walk **[V]**. The CI
changes (the gate step, the WebKit job on a Mac runner) now run on GitHub and pass **[V]**.

## Tauri setup

Facts read today on <https://v2.tauri.app> and the package registries **[V]**:

| Fact | Value |
| --- | --- |
| Latest stable | `tauri` crate 2.12.6; `@tauri-apps/cli` 2.12.5 |
| macOS needs | Xcode **Command Line Tools** are enough for a desktop-only app (full Xcode is for iOS). macOS 10.15 or later. |
| Rust | Installed with rustup. The plugins used below need Rust 1.90 or later. |
| Adding to an existing Vite project | `npm install -D @tauri-apps/cli@latest`, then `npx tauri init`, which creates `src-tauri/` |
| Config keys (`tauri.conf.json`, under `build`) | `devUrl`, `frontendDist`, `beforeDevCommand`, `beforeBuildCommand` |
| Vite | Add `server.watch.ignored: ["**/src-tauri/**"]` |
| File access | Granted per capability in `src-tauri/capabilities/default.json`; a permission alone opens no path, each needs a scope such as `{ "path": "$APPDATA/*" }`; `deny` beats `allow` |
| Folders chosen at run time | Rust: `app.fs_scope().allow_directory(path, …)`. `tauri-plugin-persisted-scope` "save[s] filesystem and asset scopes and restore[s] them when the app is reopened" |
| Watching a folder | JS `watch` / `watchImmediate`, Cargo feature `watch` (needed in phase 5, not now) |

What a build machine needs **[V]**: the Xcode Command Line Tools, Rust 1.90 or later installed through `rustup`, and
Node 22 or later. Nothing Tauri has been built yet beyond the throwaway shell spike, with plain `cargo`
([SHELL_SPIKE.md](SHELL_SPIKE.md)).

How it maps onto this repository:

| Setting | Value | Why |
| --- | --- | --- |
| `build.frontendDist` | `../dist` | `vite.config.js` already builds with `base: './'`, so the same build serves the web page and the shell **[V]** |
| `build.devUrl` | `http://127.0.0.1:5173` | The repo's `dev` script already binds 127.0.0.1 **[V]**; 5173 is Vite's default port **[I]** |
| `beforeDevCommand` / `beforeBuildCommand` | `npm run dev` / `npm run build` | Existing scripts **[V]** |
| Plugins | `fs`, `dialog`, `persisted-scope` | Files, folder pickers, and keeping picked folders allowed after a restart |
| File scope | The app's own data folder, plus only the archive folder and backup destination you pick | Least access that works |
| Rust code | A few dozen lines: register plugins, allow a picked folder | Everything else stays in JavaScript, where the tests are |

Things the fetched pages did **not** state, and what the shell spike found (2026-11-20, [SHELL_SPIKE.md](SHELL_SPIKE.md)):

- The Mac webview is WKWebView, and the built app loads from `tauri://localhost`. **[V]**
- A service worker does not register there: WebKit wants an http or https address for one. The page tries anyway and
  carries on without it. **[V]** The plan stands: the shell will skip it, since a service worker exists to make a web
  page work offline and the shell is already offline.
- Tesseract's worker files and WebAssembly load from that address, and pdf.js works there: a PDF opens and is read.
  **[V]** Whether pdf.js runs its worker as a worker there, or in its fallback on the page, was not checked. The
  handwriting reader (its worker and its ONNX WebAssembly) was not tried.
- `persisted-scope` keeps a granted folder allowed after a restart. **[V]** The dialog grants a picked folder with the
  same `allow_directory`, on the same app-wide scope, but lets in subfolders only when the page asks
  (`recursive: true`), which the archive's nested folders need. **[V]** from its source (`tauri-plugin-dialog`
  2.8.4, `commands.rs`); a real click was not run. A default folder taken without a pick still needs the Rust grant.
- A locally built program runs on the Mac that built it with no developer's signature, only the ad-hoc one the linker
  adds. **[V]** for the bare program from the terminal; a bundled `.app` opened from the Finder was not tried.
- Found in the code, not run (**[V]** from source): a folder grant does not reach names that start with a dot on
  macOS unless the fs plugin is set to `requireLiteralLeadingDot: false`, which the archive's `.formfiller/` needs;
  and a strict content policy must allow `ipc:` in `connect-src`, or Tauri sends every call as JSON, bytes included.

### Slice 5, as built, part 1: the groundwork (2026-11-21)

No screen yet: the app shows today's page and nothing else. What is built is what the screens will stand on, and
each thing the spike left unchecked that a script can check. **[V]** here means run on this Mac, in a test build of
the app (`npm run mac:check`), unless a row says it was read in the code.

What is there:

- `src-tauri/`: the app. Tauri 2.12.7 with the `fs`, `dialog` and `persisted-scope` plugins at the spike's versions,
  every version pinned and `Cargo.lock` kept; built with `@tauri-apps/cli` 2.12.6, kept in `node_modules`. Nothing new
  was downloaded by cargo: the spike's downloads were enough. **[V]**
- `src/app/files-tauri.js` and `src/app/store-tauri.js`: the file interface and the vault's store over Tauri's file
  plugin, with every call `src/lib/files/node.js` and `src/lib/stores/node.js` have. The archive's and the vault's own
  tests run on them too, over a stand-in for the app (`tests/tauri-stand-in.js`), and `tests/shell/selftest.js` runs
  the same promises in the app itself, against the real plugin.
- The page's API comes from the app (`withGlobalTauri`), so no Tauri package is bundled into the page, and the web
  page's build carries none of this.

What changed from the proposal, and why:

- **More Rust than "a few dozen lines": about 310, plus about 100 only a test build has.** Read in the plugin's code
  (`tauri-plugin-fs` 2.7.1), and then run: it never writes a file through to the disk, and it has no way to give a
  file a name only if the name is free (its rename replaces what is there). A vault whose key file was renamed into
  place unsynced could be empty after a power cut, and the archive's first rule is that nothing is overwritten. So the
  app adds `settle` (sync a file) and `name_file` (a second name, refused by the system if the name is taken, then the
  first name goes); `real_path`, so the page can refuse a folder that is a link to another granted folder; `whoami`
  and `alive`, so the app and the command line keep one lock between them; and `places`, `reveal` and `print_page`.
  The rest is the next point.
- **A restore puts the archive back in its own place (ruled by the owner, 2026-11-21).** A restore stages beside the
  archive, and the archive's usual place is the home folder, which the app is not to have. So the app grants, by
  name, only Form Filler's own names there (`grant_home`: "Form Filler Archive", a restored copy of it, a restore's
  staging folder), tells the page only those names of what the home folder holds (`home_names`), and
  `homeFiles` in `files-tauri.js` reaches nothing else. A name there that is a link is not granted, and counts as
  taken. In the test build, with a folder standing in for the home folder: a file beside those names cannot be
  listed, read or written, by the page's code or by the plugin asked directly. **[V]** The real home folder is first
  used when the owner runs the app.
- **Forgetting the vault removes its empty folder too (ruled by the owner, 2026-11-21)**, in the app's store, so a
  restore afterwards puts the vault back in place and not beside. The command line has no "forget".
- **No folder is named in the capability file.** The app's data folder is granted when the app starts, and a picked
  folder by the dialog, so the plugin's commands and the app's own check a path against one list. `scopeDroppedPaths`
  is off: by default, anything dropped on the window is granted. `requireLiteralLeadingDot` is off, for `.formfiller`.
- **The window goes nowhere but its own page** (`on_navigation`), and a form dropped on it reaches the page.

What the spike left unchecked, checked now **[V]**:

| The question | The answer |
| --- | --- |
| A strict content policy | On: `default-src 'none'`, scripts and workers from the app only (with `'wasm-unsafe-eval'` for the text reader), no inline script, styles from the app's own file, and `style-src-attr 'unsafe-inline'` for the places the page puts its blanks. Under it the invented `form.pdf` gives its 13 blanks with every label right in about 0.7 s, the PDF with its own fields and the crooked photo read as on the web page, and nothing was blocked or warned of. A `fetch` and a picture from a web address are refused, and so is sending the window to one. |
| Whether pdf.js runs its worker as a worker | No warning was logged while the PDFs opened, and pdf.js warns when it falls back to running on the page. **[I]** from that |
| Files in a granted folder's subfolders, hidden names too | An archive is made, added to, moved, indexed and verified through the app's files, and then verifies from the command line. |
| The vault at age's own work factor | Made in about 0.5 s, unlocked in about 0.46 s. |
| A bundled `.app` | `Form Filler Test.app`, 20 MB, signed ad hoc (`adhoc,runtime`), its signature verifies. Started as Finder starts it (through `open`, which hands it to Launch Services), every check passes. A double-click in Finder itself was not done. |
| `tar`, hashing, and a backup of 2 GB | Below. |

A backup, a full check and a restore of a made-up archive of 2 GB in 8,720 files (16 of 64 MB, 512 of 1 MB, 8,192 of
64 KB), on this Mac's own disk, in an optimised build, **with the window in view** **[V]**:

| | Took | Speed |
| --- | --- | --- |
| The archive written through the app's files, each file synced | 54.5 s | 38 MB/s, about 6 ms a file |
| Backup (tar, SHA-256 of every file and of the snapshot, age, read back and fingerprinted) | 54.8 s | 37 MB/s |
| Full check with the passphrase | 32.4 s | 63 MB/s |
| Restore (opened, every file checked and written, synced, moved into place) | 85.3 s | 24 MB/s |
| The archive's own check of every file afterwards | 14.3 s | 144 MB/s |

Memory at its highest, looked at every half second: 359 MB in the app, 587 MB in its page. Stage by stage, on 512 MB
of 64 MB files: reading through the plugin 1,900 MB/s (1 MiB at a time); SHA-256 in JavaScript about 200 MB/s (the
system's own, which cannot take a stream, about 2,400); age opening about 200 MB/s; reading the tar costs nothing
measurable. So SHA-256 in JavaScript and age set the pace, as the proposal expected of age.

**A window that cannot be seen runs several times slower.** macOS slows the page of a window that is hidden,
minimized or covered. The same full check of 512 MB took 8 to 9 s in view and 45 to 55 s hidden or minimized. The
app asks macOS not to (`background_throttling`, WebKit's inactive scheduling policy, macOS 14 or later); with that,
hidden checks took 15 and 39 s. With App Nap off and WebKit's own process suppression off for one run, 9 s after 5 s
hidden and 31 s after 45 s more. Each of those is one run, not a study, and one run stayed slow after the window was
shown again. **[V]** as far as that goes: nothing tried keeps a hidden window at full speed. Tauri's notes say a
hidden view may be suspended altogether after about five minutes without that setting **[I]**; that was not run.
It always finishes; it is slower while nobody looks. The fallback of the next section (the loop in Rust) would not be
slowed this way **[I]**, and is the owner's call.

Also found:

- WebKit in the app cannot read a stream with `for await`; the app's file code reads streams through a reader. **[V]**
- A PDF opened while the window cannot be seen waits at "Opening the form…": hidden for 30 s it was not read, and it
  was read 0.8 s after the window was shown. A photo is read while hidden. **[V]** pdf.js draws in the turns a page is
  given to draw in, and a hidden page is given none **[I]**; the web page in a tab nobody is looking at is likely the
  same **[I]**. The checks in the app keep its window small, in a corner and above the others for that reason.
- Started as Finder starts it, the app answers to macOS for the folders it reads: a folder in Downloads, Documents or
  on the Desktop, or on another drive, has macOS ask the owner once whether the app may (and again after each rebuild,
  since an ad-hoc signature changes with the build **[I]**). The data folder and `~/Form Filler Archive` are in none of
  those places. **[V]** that a read in Downloads waited on such a question; the rest **[I]**.
- A test found a hole before it shipped: granting one of Form Filler's own names in the home folder while a link
  stood at that name would have granted the folder the link led to. Closed, and tested, in Rust and in the stand-in.

Not checked, because each needs a click in a real dialog and the owner declined to have the test app clicked for
them: a folder picked in the folder dialog and still granted after a restart (`--run pick`, then `--run picked`),
a file named in the save dialog, the page's own "Choose the form" button and its file panel (`--run picker`), and
printing (`--run print`). Also not checked: a backup drive, an archive much larger than 2 GB, the handwriting reader
(left off in the app: it fetches its model from the web, which the content policy refuses), and `tauri dev`.

### Slice 5, as built, part 2: the screens (2026-11-21)

The slice's check is "you can do all of it by clicking". **[V]** here means clicked by a script: in Chromium and in
WebKit over a stand-in for the app (`scripts/walk-mac.cjs`, 11 steps), and inside the app itself against its real
file plugin (`tests/shell/selftest.js`, the 6 steps under "screens"). Nothing has been clicked by a person yet.

What is there (`src/app/desk.js`, with `desk.css`, `desk-words.js` and `platform.js`):

| Screen | What it does | Checked |
| --- | --- | --- |
| First run | A passphrase makes the vault; the recovery key is shown once, printable; the archive is made in the home folder, or in a folder that is picked (with a warning if it is one a syncing service copies). Or a backup is restored instead. "Not now" leaves the page usable as on the web | **[V]**, the picked folder in the walk only |
| Unlock | In the bar, in the locker, and in *Your details* as before: one vault, the page's own keeper | **[V]** |
| Locker | A document picked, titled, sealed in; the list; a copy saved out, the same bytes; shown only while unlocked. No removal | **[V]** |
| Archive | The index by matter, newest first; an item's files; show in Finder; move to another matter; check every file; look again (the index made again); what is in the folder unrecorded is told and left | **[V]**; Finder itself not started |
| File in archive | After a PDF is saved: its title, who it is with, sent or received, a matter or none (then `_Unsorted`); the form and the PDF filed with both fingerprints in the record | **[V]** |
| Backups | A place picked (refused inside the archive or the data folder); back up, with what is written told as it goes and a Stop; the list; check the copy; check fully with the secret | **[V]**; Stop not tried |
| Restore | From the list or from a folder picked (one backup, the backups folder, or the drive); the secret; each thing back in place or beside, said in words; then the app is opened again on what was restored | **[V]**: into an empty place, over what is there, and after the vault was forgotten |

Choices made on the way:

- **The archive is always the folder named "Form Filler Archive" in a folder that holds it.** In its usual place
  the holder is the home folder, reached by Form Filler's own names only. Elsewhere, the folder that is *picked* is
  the holder, not the archive itself: a restore stages beside the archive, and a pick grants only what was picked.
  `settings.json` keeps `archive.holder` (`"home"`, or a path) and `backup.to`.
- **In the app nothing of the page's is in the window's own storage.** The forms it remembers are
  `templates/<sha256>.json` and its settings are in `settings.json`, in the data folder, answered from memory and
  written behind; so a backup carries them, and the walk's restore brings back "13 blanks remembered from last
  time". **[V]** After a restore the settings are read again from the disk before anything is written to them.
- **Hidden until asked** (the privacy wall's fifth part): `fullName`, `firstName`, `lastName`, `address` and
  `birthDate`, by their last four characters (two for a value of five to eight, none for four or fewer). In *Your
  details* a hidden detail has no box of its own, and saving leaves it as it was. On the filled form, a blank your
  details filled shows hidden and cannot be typed in until shown. The PDF is made from the values themselves, and
  printing shows them first. Not hidden: e-mail, phone, city, state, ZIP, and anything you type as an answer.
  The locker's titles are shown as you gave them. In the app only: the web page is as it was.
- **Saving goes through the save dialog** (a PDF, a template, a CSV, a copy of a locker document), and printing
  through the app (`print_page`): whether the page's own `window.print()` opens the Mac's print panel there was not
  tried.
- **Left out of the app**: the handwriting reader (it fetches its model from the web), and the service worker.
- **`main.js` changed by 80 lines added and 22 removed**, where the proposal aimed at under about 60 changed: the
  hiding is most of it. Every change is behind `shell`, which is false on the web.
- **With no vault, the backups already made are still listed**, and can be checked and restored: that is how a vault
  that was forgotten comes back. A new backup needs the vault, since it is sealed to its key.

One review, by one reader with nothing but the code and the contracts it must keep (2026-11-21), found eleven
things. Ten were fixed, each with a test; the walk of the screens, started while it read, found one more:

- The app's own list of picked folders (`.persisted-scope`, kept by the plugin in the data folder) could be written
  by the page, which could so grant itself any folder at the next start. It is now forbidden to the page. (Found
  while checking the review's sixth point, not by it.)
- `settle` asked for the strongest sync only, which a network share refuses: every file made there would have
  failed, and so a backup. It now falls back to the plain kind, as Node does. **[I]** that such a disk refuses it:
  from Rust's and libuv's code, not run on one.
- The app's commands told a missing file from a forbidden one anywhere on the disk. Outside the granted folders the
  answer is now always "forbidden".
- The archive's lock names the app's process, but the page holds it: a page loaded again mid-change would have
  left the archive locked until the app was quit. The lock now carries a token for each loading of the page.
- "It is somewhere else…" made a new, empty archive in whatever folder was picked. It now only takes a folder that
  holds one, and no pick may be the archive itself.
- A restore that stopped after it had put the settings back left the page's memory to write over them; and a vault
  put back was not seen until the app was opened again. Both are looked at again after any restore.
- A box's name went into a selector unescaped: an item with a quote in its title could not be moved.
- The locker read a whole file before asking its size; a backup drive not plugged in read as "no backup there yet";
  details shown to be printed stayed shown; an error's number was taken from the path if the path held one; a
  hidden file half-written was left behind in two places.
- The first answer to "where are the app's folders", if it failed, was kept, and the vault then looked unreachable
  for good with nothing said. It is asked again, and such a failure is now said on any screen.

Left as a known limit, from that review: `persisted-scope` grants a remembered folder again at each start by its
path, links followed. So if a folder that was granted is later replaced by a link (by you, or by another program),
what the link leads to is within the page's reach after a restart. The screens themselves still refuse to write
through a link. Closing it means the app keeping its own list, with each folder's real path when it was picked.

Not done, or not checked:

- Nothing that needs a click in one of the Mac's own panels: the folder dialog, the file panel behind the page's
  "Choose the form", the save dialog, and the print panel. In the walk and in the app's own checks a dialog answers
  with the folder the script names, and the grant a real pick would make is made by the stand-in or by a test command.
  So that a picked folder is still granted after a restart rests on the spike's run of the same grant.
- A document cannot be viewed inside the locker, only saved out; an item cannot be added to the archive from a screen
  except from a PDF just made (the command line's `archive add` does the rest); a file cannot be added to an item
  from a screen.
- Stop during a backup or a restore; a backup drive that is unplugged; an archive that is somewhere else than the
  settings say (the screen offers to say where it is; not walked).
- The app with the owner's real home folder: every check used a folder standing in for it.

## Where the logic lives

**Proposal: JavaScript modules behind a small file interface; Rust stays thin.**

```
src/lib/archive.js ─┐
src/lib/vault.js   ─┼─ use ─▶ a file interface (read, write-new, rename, list, …)
src/lib/backup.js  ─┘                 │
                        ┌─────────────┴──────────────┐
                 src/lib/files/node.js        src/app/files-tauri.js
                 (tests, command line)        (the Mac app)
```

Why:

- The repository is JavaScript with a clean library and fast tests. The same modules run under `node --test`, in the
  command line, in the shell, and later on the phone and in the extension, which have no Rust at all.
- One person maintains this. A second language holding the important logic is a second place for bugs.

What it costs, said plainly:

- **The vault key is in the webview's memory while unlocked.** A script-injection bug in the page could reach it.
  Today the page escapes every OCR word, PDF field name, file name and answer it prints, through one helper, `h()`
  **[V]** (read, not audited line by line). The one value written into the page unescaped is the saved signature's
  image address, which comes from the browser's own storage; in the shell it will come from the vault. The shell will
  load no remote content, under a strict content-security policy. If that is not enough, decryption can move into Rust using the `age` crate with **no change
  to any file on disk**, because the format is a standard **[I]**.
- **Big files through the webview.** `FileHandle.write` is slow and `writeFile` appends of bytes are not: 2 GB took
  135 s one way and 1.0 s the other **[V]** (see the backup section). The Rust fallback described there was neither
  built nor timed; at 2 GB it was not needed.

## Vault encryption scheme

### The choice: the age format

[age](https://age-encryption.org) is a small, published file-encryption format with a reference command-line tool.
Its author maintains a JavaScript implementation:

| `age-encryption` (npm) | Read today **[V]** |
| --- | --- |
| Version, licence | 0.3.1, BSD-3-Clause |
| Runs on | "Node.js 20+, Bun, Deno, and all recent browsers" |
| Passphrase encryption | Yes (`setPassphrase`, `addPassphrase`, `setScryptWorkFactor`) |
| Key pairs | Yes (identities and recipients) |
| Large files | Yes, encrypts and decrypts `ReadableStream`s |
| Depends on | The noble cryptography libraries and `@scure/base` |

The shell spike ran it in the webview on 2026-11-20 ([SHELL_SPIKE.md](SHELL_SPIKE.md)): 16 MB with a passphrase and
with a key pair, a 64 MB stream, and 2 GB through the backup's loop, sealed and opened again **[V]**. It is checked
against the stock `age` tool in CI (`tests/interop.test.js`, 2.7.0; age 1.1.1 on Linux): a backup's snapshot and
the vault's files open with it **[V]**.

Why a standard format rather than encryption written here with the browser's built-in crypto:

1. **Your records outlive the software.** Any vault file or backup opens with `age -d` on any computer. That is the
   plan's own promise for the archive, extended to the encrypted parts.
2. **No home-made format.** The mistakes in encryption are usually in the wrapping, not the cipher.
3. **One format on every surface.** Rust has an `age` crate too **[I]**, so the laptop, phone and extension can never
   disagree.

Why not Tauri's Stronghold plugin: its page carries no deprecation notice **[V]**, but it is Tauri-only, so the phone
and the extension could never read the vault, and nothing outside Form Filler could either.

### Keys

```
your passphrase ──scrypt──▶ unlocks ──▶ identity.age  (the vault key, a key pair)
                                              │
                         public half ─────────┼──▶ encrypts every vault file and every backup
                         private half ────────┴──▶ decrypts them, only while unlocked
```

- **The vault key** is an age key pair, made on first run.
- **`identity.age`** is that key, encrypted with your passphrase. It is the only file the passphrase touches.
- **Everything else** is encrypted to the key's public half.

What that buys:

- Changing the passphrase rewrites one small file.
- A **backup can be written while the vault is locked**, because writing needs only the public half.
- A **recovery key**: the vault key itself, printable once at setup (ruled: yes).
- The phone can later be given its own key instead of your passphrase.

Unlocking: the passphrase decrypts `identity.age`; the key stays in memory until you lock, quit, or the app has been
idle (15 minutes is my suggested default). The passphrase is never stored.

### On disk

In the app's own data folder (`~/Library/Application Support/<app id>/` **[V]**, where the shell spike's saved folder
grants went):

```
vault/
  vault.json          not secret: format version, date made, the public key
  identity.age        the vault key, locked with your passphrase
  profile.age         your details and saved signature
  locker/
    index.age         the list of locker documents: title, kind, dates, size, SHA-256
    <id>.age          one file per document, the document's exact bytes
templates/
  <sha256>.json       a form's remembered blanks (not secret; what localStorage holds today)
settings.json         where the archive is, when the last backup ran
```

- One file per document, not one big blob: a failed write can damage at most one file.
- Every write goes to a new file that is then renamed into place, and the previous copy is kept as `.prev`, so a
  crash mid-write loses nothing **[I]** that rename is atomic on the Mac's file system.
- Each decrypted record says what it is (its kind and id), and the index holds each document's SHA-256, so a swapped
  or damaged file is noticed.

As built (2.6.0): as above, with these choices made on the way, several of them from review.
- The key is age's classic X25519 kind, which every version of the stock tool reads (not the newer post-quantum kind).
- Anyone who can write the store could seal a file to the public half that vault.json shows, so each record also
  carries an HMAC-SHA-256 tag keyed from the vault key (through HKDF), and a record without a good tag is refused.
  Putting an older genuine record back in place of a newer is not caught.
- `identity.age` and `profile.age` keep no `.prev`, so a forgotten signature is gone from the store and the store's
  copy of the key opens only with the new passphrase. A copy of `identity.age` kept elsewhere (a backup) still opens
  with the old one: changing the passphrase locks the same key again. After a passphrase may have been seen, the way
  out is a new vault (Forget, then save again).
- Every write first checks that vault.json still names this vault's key, so a tab left open cannot write over a vault
  forgotten and made again elsewhere.
- In the browser the files are kept in IndexedDB, one record each; the passphrase needs at least 8 characters.

### What it protects against, and what it does not

| Protects against | Does not protect against |
| --- | --- |
| A lost or stolen Mac that is off (with its disk encrypted by FileVault) | Malware running as you while the vault is unlocked |
| A lost backup drive | Someone who has your passphrase or recovery key |
| Another program or website reading the files | A forgotten passphrase with no recovery key: **the vault is gone** |
| The vault folder ending up in a cloud-synced place | Anything in the **archive**, which is a plain folder by design |

That last row is the plan's own default ("archive format" is on its still-open list). I recommend keeping it: a
plain folder is what makes the archive readable without the app. It does mean the most sensitive paper you own, a
finished tax return, sits unencrypted inside the disk's encryption.

## Archive folder and index

### Where it lives

You choose at first run. The default is `~/Form Filler Archive/`, **not `~/Documents`**: on a Mac with iCloud's
"Desktop & Documents Folders" setting on, an archive in Documents would be uploaded to iCloud, against "local first".
The app should warn when a chosen folder sits inside a known cloud-synced location.

### Layout

As the plan draws it, plus one hidden folder for the index:

```
Form Filler Archive/
  Taxes/2026/
    2026-11-17 sent IRS - Form 1040/
      original - f1040.pdf
      filled - f1040.pdf
      sent - f1040.pdf
      cover - e-mail to IRS.eml
      confirmation - receipt.pdf
      record.json
  Licensing/…   Work/<employer>/<contract>/…   Housing/<address>/…
  _Inbox/
  _Unsorted/
  .formfiller/
    index.json
```

- A **matter** is just the folder path (`Taxes/2026`). New matters are new folders.
- An **item** is one dated folder: `<date> <received|sent> <counterparty> - <title>`.
- Files keep their own names behind a role word, so the folder reads sensibly in Finder.

### `record.json`

```json
{
  "formFiller": "archive-record",
  "version": 1,
  "id": "0b6f6c0e-…",
  "matter": "Taxes/2026",
  "title": "Form 1040",
  "direction": "out",
  "counterparty": "IRS",
  "channel": "export",
  "dates": { "created": "2026-11-17T15:30:00-05:00", "sent": null, "received": null, "confirmed": null, "replied": null },
  "ledger": null,
  "filing": { "by": "you", "confidence": 1, "reason": "chosen at export" },
  "form": { "sha256": "…", "answersSha256": "…" },
  "files": [
    { "role": "original", "name": "original - f1040.pdf", "sha256": "…", "bytes": 181234, "added": "2026-11-17T15:30:00-05:00" },
    { "role": "filled",   "name": "filled - f1040.pdf",   "sha256": "…", "bytes": 190112, "added": "2026-11-17T15:30:01-05:00" }
  ],
  "history": [ { "at": "2026-11-17T15:30:00-05:00", "event": "created" } ]
}
```

It carries everything the plan lists: direction, counterparty, channel, dates, the ledger entry (empty until phase 5)
and a SHA-256 of each file. `form` reuses the two fingerprints Form Filler already writes into every PDF **[V]**, so a
filled PDF can be tied back to its record.

### The index

- **The folders are the truth; the index is a cache.** `.formfiller/index.json` is rebuilt at any time by reading
  every `record.json`. Deleting it loses nothing.
- It lists each item with its path, matter, dates and file fingerprints. That is enough for search, for "have I
  already got this exact file?", and for "is this exactly what I sent?".
- A JSON file, not a database. At one person's scale that should be fine into the tens of thousands of items **[I]**;
  if it measures slow, a database can replace the cache without touching a single record.
- **You can rearrange the archive in Finder.** A rebuild finds each item again by the `id` inside its `record.json`.
  Folders with no record are listed as "not recorded" and left alone.

### The two rules, built in rather than promised

**Never delete.** The archive module is handed a file interface that *has no delete and no overwrite*: it can read,
create a file that does not exist yet, create a folder, rename to a name not yet taken, and list. A name clash gets
" (2)". A newer version of a document is added beside the old one. The only thing ever rewritten is the index cache.
A test asserts that after every operation, every file that existed before still exists with the same SHA-256.

As built (2.5.0): a record that changes, when a file is added or the item moved, is written anew, and the old
`record.json` is kept in the item's hidden `.formfiller/` folder as `record 1.json`, `record 2.json`…, so no record
is overwritten either. The test therefore holds by content: after every operation every earlier file's bytes are
still there, and every document is still at its path unless the operation moved its item. A new item is put
together in `.formfiller/new/` and moved into its matter in one rename, so a half-made item never sits among the
others; anything left unfinished by a stop is reported by `verify`. Two more things the rules needed, found in
review: one program at a time changes an archive (a lock, `.formfiller/lock`, which with the index cache is the only
file the archive ever rewrites or removes), and `verify` compares with the index, so an item taken out of the archive
whole in Finder is reported as gone rather than simply no longer seen.

**Never misfile.** Filing takes a matter and a confidence. In phase 2 there is no guessing at all: an item goes where
you put it, and if you put it nowhere it goes to `_Unsorted`. The suggestion logic of later phases plugs into the
same call, with a threshold below which `_Unsorted` is the only answer.

### Operations in phase 2

Create an item; add a file to an item; move an item to another matter (a rename, recorded in `history`); rebuild the
index; verify (re-hash everything and report what is missing, changed or unrecorded, changing nothing).

## Backup and restore

### What a backup is

```
<the drive or folder you pick>/Form Filler Backups/
  2026-11-17 1530/
    snapshot.tar.age     everything, encrypted to the vault's public key
    identity.age         the vault key, locked with your passphrase
    snapshot.sha256      fingerprint of snapshot.tar.age, to catch a bad copy
    README.txt           how to restore, with and without Form Filler
```

Inside `snapshot.tar.age`: the whole archive folder, the whole `vault/` folder (already encrypted, so it is wrapped
twice), `templates/`, `settings.json`, and a `manifest.json` naming every file with its size and SHA-256.

Restoring **without Form Filler**, on any computer with the `age` tool. This was the intended shape, **[I]**; as
built, README.txt gives one line instead, for the reason under "As built (2.7.0)" below:

```sh
age -d -o key.txt identity.age                          # asks for your passphrase
mkdir restored
age -d -i key.txt snapshot.tar.age | tar -x -C restored
```

Design points:

- **One file per snapshot.** File names in the archive say a lot ("sent IRS - Form 1040"), so they must be inside
  the encryption, not beside it.
- **Full snapshots, not incremental, in this version.** Simpler to reason about and to verify. Each one is the size of
  the archive.
- **The app never deletes a backup.** It lists them with dates and sizes; thinning old ones is yours.
- **After writing**, the copy on the destination is read back and its fingerprint compared. With the vault unlocked,
  "verify fully" decrypts it and checks every file against the manifest.
- **Restore never overwrites.** It unpacks to a staging folder, checks every file against the manifest, and only then
  moves things into place, and only into empty places. If the archive or vault already exists, the restored copy goes
  beside it as `… (restored 2026-11-17 1530)`.

As built (2.7.0): as above, with these choices made on the way.
- The tar holds two folders under fixed names, `data/` (the app's data folder: `vault/`, and `templates/` and
  `settings.json` when there are any) and `archive/` (the whole archive, hidden files and empty folders included, but
  never its lock), and last `manifest.json`: `{ formFiller: "backup-manifest", version: 1, made, recipient, entries:
  [{ path, kind, bytes, sha256 }], skipped: [{ path, why }] }`, every member in tar order. A link is never followed;
  it is named in `skipped`. A hand restore gives `restored/data` and `restored/archive`, whatever the folders were
  called. The tar is plain pax, written and read by `src/lib/tar.js` with no tar library, and its reader refuses
  anything the writer never writes: links, absolute paths, "..", a name twice, a member before its folder, bytes
  after the end.
- `snapshot.sha256` covers `identity.age` too, so a swapped key file is found before any passphrase is tried. Its two
  lines are as `shasum -a 256 -c` and `sha256sum -c` read them.
- A backup is put together in a staging folder, `.ff-staging-<16 hex digits>` in `Form Filler Backups/`, read back
  from the drive, and then renamed to its name in one step; a restore stages beside the archive and inside the data
  folder. A staging folder that is given up, or emptied, is removed whole: with the index cache and the lock, the only
  thing the file interface removes. Ctrl-C while either runs removes its staging, as a failure does. One left by a
  backup that was killed is listed as unfinished, and one left by a restore is named by the next restore.
- A copy that goes beside is named for the backup's own date, so it says which backup it holds. Anything at a place
  counts as taken, an empty folder too: a create-only rename is the only move the file interface has, and it never
  replaces anything.
- README.txt's restore without Form Filler is one line, not the piped shape above:
  `age -d -i identity.age -o snapshot.tar snapshot.tar.age && mkdir restored && tar -x -f snapshot.tar -C restored`.
  age gives out the pieces it has checked before it finds a bad one **[V, the library; I for the stock age]**, and
  tar exits 0 on input with no end blocks **[V, bsdtar]**, so with a pipe a damaged backup could unpack in part while
  tar, and so the whole line, reports success; only age's own error message would say otherwise **[I, from age
  1.1.1's source]**. With `&&`, tar runs only on what age finished checking, and no key file is left on disk. It
  needs room for one more copy of the snapshot. With only the recovery key, the same line takes `-i key.txt`. CI
  runs both forms of the line with the stock age 1.1.1 on Linux **[V]**: the passphrase is asked for at a terminal
  and opens `identity.age`. If age stops with an error, it may already have written part of the snapshot to
  `snapshot.tar`, unencrypted **[I, from age 1.1.1's source]**, so README.txt says to delete it then too.
- A backup made while the vault is locked trusts the public key vault.json names, since nothing else can be checked
  without the passphrase; `form-filler backup verify --fully` proves it opens with your passphrase, and
  `backup make` says so every time.
- The checks prove that a backup is undamaged and sealed to the vault's key, not who made it: anyone with the public
  key could seal a snapshot. The vault's records carry tags only its key can make, so a restore refuses a forged one;
  a snapshot whose vault holds no records at all (no details and no locker list) is restored, and both a restore and
  `verify --fully` say so. README.txt says to keep backups on drives you control.
- A name in the archive may be as long as a Mac's disk holds, 255 UTF-16 units (up to 765 bytes), so a name another
  program wrote is backed up too; the archive's own names stay within 240 bytes. The archive's folder name on a
  restore must leave room for " (restored YYYY-MM-DD HHMM) (999)" within 255 bytes.

### The open engineering question

A snapshot may be gigabytes (photos and scans add up). The JavaScript library streams **[V]**. Whether Tauri's file
plugin could stream that much through the webview at a usable speed was **[I]**; the spike found that it can (below).

Plan: write `backup.js` against the file interface, where Node's streams make it easy to test. If a real backup proves
too slow or too hungry, the same loop moves into one Rust command using the `tar` and `age` crates. The file format,
the tests and the restore instructions do not change.

What the spike measured, in an optimised build, through its throwaway shell (SHELL_SPIKE.md). The 2 GB was one 8 MB
piece of random bytes sent 256 times, not an archive: there was no `tar` and no hashing.
- Writing 2 GB with `writeFile` appends of 8 MB byte arrays took 1.0 s; the same through `FileHandle.write`, whose
  bytes travel as JSON, took 135 s.
- Sealing 2 GB with `age` as the page made it, and writing it with `writeFile` appends, took 9.8 s. Reading it back
  and opening it took 9.2 s; `age` checked every piece, and all 2 GB came back.
- Memory, sampled every half second during those two loops: the highest readings were 350 MB in the page's WebKit
  process and 126 MB in the program. A peak shorter than half a second could be missed.

So at 2 GB it is neither too slow nor too hungry: the loop stays in JavaScript, gathers what `age` gives out into byte
arrays (8 MB in the spike), and writes them with `writeFile` appends, never `FileHandle.write`. It must not hand
`writeFile` the stream itself: given a stream, `writeFile` writes it with `FileHandle.write` (**[V]** in the plugin's
code). **[V]** for 2 GB on this Mac's own disk; **[I]** for `tar`, hashing, much larger archives and a backup drive,
and the speeds may include the operating system's cache.

### The backup and restore test

This is the plan's check for phase 2, in two forms.

**Automated**, in `tests/backup.test.js`, run by `npm test` and CI:

1. Build a small world in a temporary folder: a vault with a profile, a signature and two locker documents; an
   archive with items in several matters and in `_Unsorted`, with awkward names (accents, 200-character names, spaces,
   a duplicate file); templates; settings.
2. Record the SHA-256 of every file.
3. Take a snapshot.
4. **Wipe**: remove the vault, the archive, the templates and the settings.
5. Restore from the snapshot with the passphrase.
6. Assert: every file is back, byte for byte; the rebuilt index equals the original; the vault unlocks and the
   profile reads the same; nothing extra appeared.

And the ways it must fail safely:

| Case | Must happen |
| --- | --- |
| Wrong passphrase | A clear refusal; nothing written |
| One byte of the snapshot flipped | Verification fails; nothing restored |
| Snapshot cut short | The same |
| Restore onto an existing archive | Nothing overwritten; restored beside it |
| Restore using only the recovery key | Works (if you choose to have one) |
| The snapshot opened with the real `age` tool and `tar` | Same files, same fingerprints (skipped where `age` is not installed; installed in CI) |

**By hand, by you**, in the Mac app, on a real document (the plan's rule for every phase). In outline; exact
copy-paste steps come with the build:

1. Fill a real form and file it in the archive. Add a real document to the locker.
2. Back up to an external drive.
3. Quit. **Move** (not delete) the app's data folder and the archive folder aside.
4. Open the app, which now knows nothing. Restore from the drive.
5. Compare the restored archive with the copy moved aside; the command will print nothing if they match.
6. Unlock the vault and open the locker document.

## Files to create or change

### Create

| File | What it is |
| --- | --- |
| `src-tauri/Cargo.toml`, `Cargo.lock`, `build.rs`, `tauri.conf.json` | The shell's project and settings (written by `tauri init`, then edited) |
| `src-tauri/src/main.rs`, `src-tauri/src/lib.rs` | Start-up: register the three plugins; one command that allows a picked folder |
| `src-tauri/capabilities/default.json` | Exactly which files the page may touch |
| `src-tauri/icons/*` | App icons, generated from `public/icons/icon-512.png` |
| `src/lib/hash.js` | One SHA-256 helper. Today it is written twice, in `main.js` and in `bin/form-filler.mjs` **[V]** |
| `src/lib/archive.js` | Items, `record.json`, the add-only rules, index, move, verify |
| `src/lib/vault.js` | Vault format, lock and unlock, profile, locker |
| `src/lib/backup.js` | Snapshot, verify, restore |
| `src/lib/files/node.js` | The file interface over Node, for tests and the command line |
| `src/app/files-tauri.js` | The same interface over Tauri's file plugin |
| `src/app/platform.js` | "Am I in the shell?" and which storage to use |
| `src/app/desk.js`, `src/app/desk.css` | The new screens: first-run setup, unlock, locker, archive list, backup and restore |
| `tests/archive.test.js`, `tests/vault.test.js`, `tests/backup.test.js`, `tests/interop.test.js` | Including the wipe-and-restore test and the stock-`age` check |
| `docs/RESTORE.md` | How to restore with and without the app (the same text goes into every backup) |
| `LICENSE` | Your choice; see decisions |

### Change

| File | Change |
| --- | --- |
| `package.json`, `package-lock.json` | Add `age-encryption`, `@tauri-apps/cli`, `@tauri-apps/api`, the `fs` and `dialog` plugin packages, and Playwright as a declared dev dependency. New scripts for the shell and the WebKit walk. (Package names for the plugins are **[I]** until installed.) |
| `vite.config.js` | Ignore `src-tauri/` in the watcher; the legacy pdf.js build if slice 0 adopts it |
| `.gitignore` | `src-tauri/target/`, `src-tauri/gen/` |
| `src/app/main.js` | Four small hooks, aiming for under about 60 changed lines: route its storage through one interface (so the shell uses the vault and the web page keeps `localStorage`); skip the service worker in the shell; after an export in the shell, offer "File in archive"; open the new screens. Slice 0's defect fixes are separate. |
| `src/app/style.css` | Dark-mode fix for the blanks (defect 6) |
| `src/lib/index.js` | Export the new modules |
| `bin/form-filler.mjs` | `archive verify` and `backup restore`, so a restore never depends on the window opening |
| `scripts/walk.cjs` | `--engine webkit` |
| `.github/workflows/ci.yml` | Run the walk in both engines; install `age` for the interop test |
| `README.md`, `CHANGELOG.md` | What is new, and how to build the Mac app |

### Not changed

`.github/workflows/pages.yml`. The public page keeps publishing from `main`. The vault, archive and backup code is
inert there because it only switches on inside the shell.

## Order of work

Each slice ends in something you can check. Sizes are relative, not dates.

| # | Slice | Size | Its check |
| --- | --- | --- | --- |
| – | **Never-list gate** (privacy wall, part 2) | Small | **Done.** A commit carrying a never-list value is refused, on the Mac and on GitHub |
| 0 | Ground: WebKit in the tests, defects 1 to 3 | Medium | **Done.** The walk passes in both engines |
| 1 | **Spike, thrown away afterwards**: Rust installed; the page in a Tauri window; a PDF opened in the real webview; a folder picked, written to, and still allowed after restart; age round-trip in the webview and against the `age` tool; a 2 GB stream timed | Small | A one-page note of what was found; the **[I]** marks above become **[V]** or get replaced. **Run 2026-11-20** ([SHELL_SPIKE.md](SHELL_SPIKE.md)): all but the stock-`age` check (on hold then; written in slice 4, and not run yet), a real click in the folder dialog, a bundled `.app` opened from the Finder, whether pdf.js runs its own worker, and the handwriting reader |
| 2 | Archive module and its tests | Medium | `npm test`; `form-filler archive verify` on a folder you made by hand. **Built** (2026-11-20, 2.5.0): `src/lib/archive.js`, the file interface over Node, and `form-filler archive add`, `file`, `move`, `index`, `verify`; the hand check is yours |
| 3 | Vault module and its tests, with its browser adapter (privacy wall, part 6) | Medium | `npm test`; the web page keeps no detail or signature in plain text. **Built** (2026-11-20, 2.6.0): `src/lib/vault.js` with stores in memory, in a folder and in IndexedDB; the page keeps your details and signature in it, and the walk checks in both engines that nothing of them is in plain text. Pages at the same address can still script the page while it is open (see "The privacy wall in phase 2"); on 2026-11-21, before 2.6.0 was published, the page moved to an address of its own. The locker has no screen yet (slice 5), and the stock-`age` check came with slice 4, where CI runs it (age 1.1.1 on Linux) |
| 4 | Backup and restore, with the wipe-and-restore test | Medium | `npm test`, including the stock-`age` check. **Built** (2026-11-21, 2.7.0): `src/lib/backup.js` and `src/lib/tar.js`, `unlockKey` in the vault, `form-filler backup make`, `list`, `verify` and `restore`, and the wipe-and-restore test with each way it must fail safely. The system's tar and the stock checksum tools are checked on the Mac; in CI, on Linux, GNU tar and the stock `age` 1.1.1 open a backup by README.txt's own lines, with the recovery key and with the passphrase (first run 2026-11-21). The hand check is yours |
| 5 | The shell: setup, unlock, locker, archive list, export into the archive, backup and restore screens, with never-list fields masked (privacy wall, part 5) | Large | You can do all of it by clicking. **Built** (2026-11-21, 2.8.0, branch `phase-2-shell`): the app, its file interface and vault store (part 1), and its screens with your details hidden until asked (part 2), clicked through by scripts in two browsers and inside the app. Not clicked by a person yet, and none of the Mac's own panels. See "Slice 5, as built", parts 1 and 2 |
| 6 | Your drill on a real document | Yours | Wipe, restore, everything comes back |

Work happens on `phase-2-…` branches. `main` stays releasable throughout.

## Decisions, ruled 2026-11-17

| # | Decision | Ruling |
| --- | --- | --- |
| 1 | Archive format | **Plain folder.** |
| 2 | Where the archive lives | **`~/Form Filler Archive/`.** Not Documents, not iCloud. |
| 3 | A recovery key | **Yes, printable.** |
| 4 | The five patches | **Rebase later:** 0002 before phase 3, 0001 before phase 6. 0004 is decided against `main`'s own Send button then. |
| 5 | Licence | **MIT.** Added on `phase-1-inventory`. The copyright line names the GitHub account, not a person, because the never-list keeps the owner's name out of committed files. |
| 6 | "File in archive" on export | **Yes, in phase 2, in the shell only.** |
| 7 | Defects 1 to 3 before the shell | **Yes: slice 0, done.** |
| 8 | The privacy wall | **Added to phase 2; the gate first.** See above. |

## Risks

1. **WebKit.** The reader's defects there were proven, and slice 0 fixed them. The spike then opened and read a PDF
   in the shell: pdf.js works there, and the text reader's worker and WebAssembly load there **[V]**. Not settled yet:
   whether pdf.js runs its own worker there, the handwriting reader's worker and ONNX WebAssembly, and any of it under
   the strict content policy the shell is to have (the spike ran with none).
2. **A forgotten passphrase.** Encryption that works has no back door. Decision 3.
3. **The archive is plain text on disk.** A folder that a cloud service syncs would upload it; hence the default
   location and the warning. Decisions 1 and 2.
4. **Big backups through the webview.** Measured in the spike: at 2 GB, about 10 s each way, written as byte arrays
   with `writeFile` appends. A Rust fallback that changes no file format stays in reserve. Measured in the app
   (slice 5, part 1), with `tar` and hashing and 8,720 files: a backup of 2 GB in 55 s, a full check in 32 s, a restore
   in 85 s, with the window in view; several times slower while the window cannot be seen.
5. **The key lives in the webview while unlocked.** Mitigated by a strict content policy and no remote content;
   movable to Rust later.
6. **`age-encryption` is version 0.3.** Its interface may still change; pin the exact version. The file format it
   writes is the stable part **[I]**.
7. **A new toolchain.** Rust is new to this project. Keeping the Rust to a few dozen lines is deliberate.
8. **Every push to `main` goes public.** No real document, name or number may enter the repository, in fixtures,
   tests or screenshots. All test material stays invented, as it is now.
