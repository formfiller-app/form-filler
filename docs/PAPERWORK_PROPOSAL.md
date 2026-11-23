# Paperwork proposal: bring it in, keep it, find it, fill it, send it

Written 2026-11-22, for the plan in [BUILD_PLAN.md](BUILD_PLAN.md), after the Mac app
([PHASE2_PROPOSAL.md](PHASE2_PROPOSAL.md), slice 5). It sets out the direction the owner gave that evening, in the
order it would be built, with the worked example as its first slice.

**Status, 2026-11-22:** slice 1, the worked example, is built on branch `demo-indiana` and walked in both engines.
Slices 2 to 6 are proposed and not built. Nothing here changes the plan document kept on claude.ai, which stays the
source of truth; where that document and this file differ, the document wins.

Marks: **[V]** verified: run here, or read here in the code named. **[I]** inferred, to be confirmed before it is
relied on. Nothing in this file was checked against a real form, a real agency or a real bank: every form named as
an example is invented.

## The direction in one paragraph

Form Filler fills a form you already have. The direction is the rest of the job around that form: paperwork arrives
however it arrives and is brought in without ceremony; the things forms keep asking for live in one place you own,
each with the document that proves it; the form itself can be found by saying what you are doing rather than by
knowing its number; a packet of forms can be sent out blank by whoever needs it filled, and filled by the person who
has the details; and what comes out the other end stays yours — downloaded, printed, e-mailed or shared, encrypted
when it is sensitive, and kept as it was sent even after you move house or change bank.

## Why the first screen changed

The page used to open by asking the person to find a form. That is the one thing a person who needs help with
paperwork cannot do: they know they are starting a job in Indiana, not that the form is called WH-4. So the page now
opens on three choices — **try an example**, **use my own form**, **find a form** — and the first of them is a
worked example that runs end to end in about half a minute.

The third choice is honest about not existing: it says there is no library of forms yet and shows nothing rather
than made-up results **[V]** (`scripts/walk.cjs` checks that nothing is listed).

## Slice 1: the worked example (built, 2026-11-22)

**What it is.** "Try an example → Starting a new job in Indiana": one tap opens an invented person's new-hire packet
with its answers already in place; the person changes the address once and watches it land on both forms that carry
it; then two previews side by side show what the people office would receive and what payroll would receive, with
the bank details in payroll's and not in the other's. It ends there: nothing is sent, nothing is saved, no vault is
made, and nothing of the person's own is asked for.

**Everything in it is invented**, as the privacy wall's third part requires: the person (Avery Nolan), the employer,
the credit union, both addresses, the account numbers, and the three forms themselves. No real form is copied, and
each form says "(invented form)" in its own title. The packet is drawn as three sheets in the page, not as PDFs, so
the example adds no picture and no PDF to the repository and needs nothing vouched.

**Where the code is.**

| File | What it holds |
| --- | --- |
| `src/app/example-words.js` | The invented packet, the two offices, and the small sums: which forms carry the address, what each office is sent, how a bank number is shown. No browser needed, so it is tested on its own |
| `src/app/example.js` | The screen: the three ways in, the three steps of the example, and the redraw that keeps the caret in a box being typed in |
| `src/app/main.js` | Shows the three ways in when no form is open, the example while it is being clicked through, and today's page once a form opens |
| `src/app/style.css` | The sheets and the two-column layouts, light and dark |
| `tests/example.test.js` | Nine checks of the words and the sums |
| `scripts/walk.cjs` | Six clicked steps: the three choices, the example opening, the address on both forms, the two previews, leaving it, and the side-by-side layout on a computer |
| `scripts/walk-mac.cjs` | One clicked step: the same example inside the Mac app's window |

**What it is not.** It is a worked example, not a template for real filing: it makes no PDF, writes no vault, files
nothing in the archive and sends nothing. The forms are invented, so nothing in it can be filed with anybody.

**Checked here** (a Mac, 2026-11-22) **[V]**: 379 unit tests, none failing; the page's walk 45 of 45 and the Mac
screens' walk 12 of 12, both in Chromium and in WebKit; 8 Rust tests. `npm run mac:check` was **not** run, because
the owner's own trial of the app (`npm run mac:try`) was open and that check rebuilds the bundle it came from.

## Slice 2: paperwork comes in however it arrived

A scan, an upload, a photo, an e-mail attachment, a pasted link. Today the page takes a file; the rest are each a
small door onto the same opening step.

- **Built already**: choose a file, drop one, paste a screenshot, **and open a photograph of a form** — a phone
  photo, crooked, is straightened and its blanks found from the pixels **[V]** (`tests/fixtures/form-photo.png`;
  both walks open one, and the Mac app's checks open one too). The owner asked for photos of forms on 2026-11-22;
  they are not a slice to build, they work today.
- **Where the effort goes** (owner, 2026-11-22): of everything in this document, being **very good at taking a form
  in** is one of the two things that matter most — the other is slice 4's search. A library of forms is worth less
  than a page that reliably opens whatever the person already has, however it reached them.
- **To build**: open from a link the person pastes (fetched by the Mac app, not the page, so the page keeps its
  promise that nothing leaves the device without being asked); take an e-mail attachment, which in the Mac app means
  a watched folder the person drops mail into, not a mailbox connection **[I]**; and in the app, a `_Inbox` folder
  the plan already names, where anything dropped is opened and offered for filing.
- **The rule to keep**: whatever the door, the form lands in the same place and is read by the same code. No door
  gets its own half-built pipeline.
- **The check that would prove it**: one form, brought in through every door, gives the same fingerprint and the
  same blanks.

## Slice 3: the personal vault, with the documents behind it

The vault today holds your details and a signature. The direction is wider: identification, bank details, employment
history and professional credentials, each kept **with the document that proves it**.

- A credential is one thing, not three: a licence number, the date it expires, and the scan of it belong together.
  Sharing it should let you share the number alone, the number and the expiry, or the scan as well — chosen each
  time, and shown before it goes.
- Employment history is the thing forms ask for that nobody has to hand: employer, dates, title, address, and the
  letter or payslip that proves it.
- **Login passwords stay out.** They belong to the password manager, and Form Filler should never become a worse
  one. The vault holds what forms ask for, not what websites ask for.
- **What this needs**: the vault's shape grows from a flat set of details to a set of records, each with a kind, its
  fields, its documents in the locker, and when it was last confirmed. The privacy wall's fifth part already says
  which kinds are shown by their last characters; a new kind must declare which it is.
- **The risk**: a vault of records is a data model that is hard to change later. It should be written down and
  reviewed before it is built, and it should carry a version from its first day **[I]**.
- **The check that would prove it**: a licence put in, backed up, restored on an empty machine, and shared three
  ways (number; number and expiry; with the scan), with the share showing exactly what it is about to give.

## Slice 4: a library of forms

Government, tax, court, medical and bank forms, found by saying what you are doing.

**The owner's answer, 2026-11-22**: aim for **as many relevant forms as possible** — a bank of forms, not a token
handful. But the count is not what makes it good. The two things it must be excellent at are **finding the form that
is current** and **taking a form in** (slice 2). A wide library that serves a stale form is worse than a narrow one
that always lands the person on today's version, or hands them straight back to the upload door.

So the shape changes: the library is a **finder**, not a warehouse. It may hold many entries, and an entry may be no
more than an issuer, the words people use for the form, where it applies, when it was last checked and a link to the
official copy. Filling it inside Form Filler is the bonus case, not the entry fee.

- Each form in the library says **who issued it**, **where it applies**, and **when it was last checked**. The last
  of those is the honest part: a form library that does not say how stale it is will quietly mislead people.
- A form is either **filled in Form Filler**, where its blanks are understood, or **opened at the official site**,
  where they are not. There is no third state where it half works.
- Searching in plain words ("I'm starting a job in Indiana") needs no model: a list of forms with the words people
  use for them, matched plainly, goes a long way, and can be checked. A model may help later; it must not be the
  thing that decides what a form is **[I]**.
- **The hard part is not the search, it is the upkeep.** Who checks each form each year, and what happens when a
  form changes? A library with no answer to that is worse than no library. One answer: ship few forms, each with the
  date it was checked and a link to where the official copy lives, and say plainly when a check is overdue.
- **The check that would prove it**: for every form in the library, the official link still answers, and the
  "last checked" date is within the period the library promises.

## Slice 5: blank packets, chosen once and sent as one link

An employer, a clinic or a bank picks the forms it needs once, and sends one link. The person who opens it fills it
with their own details, and sees exactly which fields and which attachments each recipient gets.

- The packet that is sent out is **blank**: it carries the list of forms and who gets what, never anybody's answers.
- The person filling it sees the split before anything goes: this office gets these fields and this attachment, that
  one gets those. That is what the example's third step shows with invented data.
- **This is the first part of the direction that puts two people's computers in the same story**, so it is the first
  that needs something between them. The smallest honest version: the packet's definition is a file or a link that
  carries no answers, and the filled result goes back the way the person chooses (download, e-mail, share) rather
  than through anything Form Filler runs **[I]**.
- **The check that would prove it**: a packet made by one person, opened by another, filled, and split — with a test
  that the recipient who should not get the bank details cannot find them anywhere in what they receive.

## Slice 6: control of what comes out

- Download, print, e-mail or share, as today, and the archive keeps what was sent.
- **Sensitive packets are encrypted by default**, with the format the vault and backups already use (age).
- **An export has to be asked for.** Nothing leaves in bulk because a button was near the mouse.
- **New details are for future forms.** Changing your bank or your address changes what the next form is filled
  with; it never rewrites what was sent. The archive's "never delete, never misfile" rules already say this, and the
  vault's records would need the same: a change is a new value from today, not an edit of the past **[I]**.
- **The check that would prove it**: change the address, fill a new form, and show the archive's older item
  unchanged, byte for byte.

## Nothing of your paperwork goes to a model

The owner asked on 2026-11-22 whether a filled-in form goes through Anthropic, and said plainly that it must not.
It does not, and here is what was read to establish that, so the claim can be re-checked rather than believed.

- **No model provider appears in the shipped code at all.** No Anthropic or other provider's name, no key, no
  endpoint, in `src/` or `bin/` **[V]**.
- **The whole page makes two `fetch` calls.** One reads a picture already kept inside a template, from the device
  **[V]**. The other is the service worker, which returns early on any request that is not from the page's own
  address **[V]** (`src/app/sw.js`).
- **One thing is downloaded, and only when asked for.** Pressing *Read handwriting* fetches a TrOCR model from
  Hugging Face, pinned to an exact revision, kept by the browser afterwards **[V]** (`src/lib/models.js`). That is a
  download: a file comes in. The README already says it tells Hugging Face your IP address, as any download does.
- **The reading happens on the device.** The model runs in a worker through ONNX Runtime's WebAssembly, served from
  the app's own files — `device: 'wasm'` in `src/app/handwriting-worker.js` **[V]**. The form's pixels are never sent
  anywhere to be read.
- **The Mac app cannot reach an outside address at all.** Its content policy is `default-src 'none'` with
  `connect-src 'self' data: ipc: http://ipc.localhost` **[V]** (`src-tauri/tauri.conf.json`), and the app's own
  checks include "nothing is fetched from anywhere but the app itself", which passes **[V]**.

What *does* go through Anthropic is this repository's code, because it is written in Claude Code. The owner's filled
forms never have. That distinction is the whole of it.

**The rule this sets for everything ahead.** Slice 4's plain-English search is the one place a model would be the
obvious tool, so it is the one place to be careful:

1. Matching the words people use against a list of forms needs no model, and a list can be checked by a test. That
   is the design.
2. If a model is ever used, it runs **on the device**, as the handwriting reader already does.
3. If one ever ran elsewhere, it would receive the search words only — never a filled form, never a field from the
   vault, never a document — it would say so before each use, and it would be refusable without losing the rest.
4. **The check that would prove it**: no filled form, and nothing out of the vault, is ever an argument to a network
   call. That is testable the same way `tests/example.test.js` already tests the example's words module for having no
   `fetch`, no storage and no `navigator`.

## What none of this changes

The privacy wall in [BUILD_PLAN.md](BUILD_PLAN.md) holds throughout, and the first slice was written to it: the
example is invented end to end, keeps nothing, sends nothing, and shows bank numbers by their last characters as the
rest of Form Filler does **[V]** (`tests/example.test.js`, and both walks check that nothing of the invented person
reaches storage or the app's data folder).

Two rules this direction must not quietly break:

1. **Nothing is uploaded.** Links that fetch, packets that travel and libraries that update all want a network. Each
   one must be the person's choice, must say what it is about to do, and must leave the page that fills forms
   working with no network at all.
2. **Nothing is sent or signed without a click.** A packet that splits itself between recipients is exactly the kind
   of convenience that could send something nobody read.

## Order of work, and what to do first

1. **Slice 1, the example** — built; waiting on the owner's go to reach `main` and the published page.
2. **Slice 4's smallest half, the finder's shape** — invented forms with issuer, where it applies and when checked,
   and plain-word search over them, so the third choice on the first screen stops saying "not built". Written as
   data, so a real list can replace the invented one without touching the code. This is one of the owner's two
   priorities, and the search must stay model-free (see above).
3. **Slice 3, the vault's records** — the data model written down and reviewed first.
4. **Slice 2's remaining doors** — link and watched folder, in the Mac app.
5. **Slice 5, packets** — only after 3 and 4, since a packet is a list of library forms and vault fields.
6. **Slice 6, control** — alongside 5; the encryption and the archive rules exist already.

## Open questions for the owner

- ~~**How many forms, and who keeps them current?**~~ **Answered 2026-11-22**: as many relevant ones as possible,
  but being good at finding the current form and at taking a form in matters more than the count. Who keeps them
  current is still open, and it is still the thing slice 4 stands or falls on.
- **Does a packet ever travel through anything of ours?** If never, slice 5 is files and links only, which is much
  smaller and much safer.
- **Is the example's packet the right one?** Starting a job was chosen because it is common, has more than one form,
  and has a real reason for two recipients. A clinic's intake or a bank's account opening would show the same
  idea.
