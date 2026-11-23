# The vault's records: the shape, written down before it is built

Slice 3 of [PAPERWORK_PROPOSAL.md](PAPERWORK_PROPOSAL.md). That slice names its own risk — *"a vault of records is a
data model that is hard to change later. It should be written down and reviewed before it is built, and it should
carry a version from its first day"* — so this document is the slice's first step, and **nothing here is built yet**.
It is for the owner to argue with.

Marks: **[V]** read from the code and confirmed, **[I]** proposed or inferred here.

## What the vault holds today

Read from `src/lib/vault.js` and `src/lib/profile.js` **[V]**:

| File | What is in it |
| --- | --- |
| `vault.json` | `{ formFiller: 'vault', version: 1, made, recipient }` — not secret; names the key that opens the rest |
| `identity.age` | the vault key, locked with the passphrase. The only file the passphrase touches |
| `profile.age` | one record: `{ kind: 'profile', id: 'profile', details, signature }` |
| `locker/index.age` | one record: `{ kind: 'locker-index', id: 'locker', documents: [...] }` |
| `locker/<id>.age` | one document's exact bytes |

Two things already exist that this slice should build on rather than invent beside.

**There is already a record envelope.** Every sealed record is written as
`{ formFiller: 'vault-record', version: 1, kind, id, ...fields, saved }`, and a reader refuses anything whose
`formFiller`, `version`, `kind` or `id` is not what it expected, with `EFOREIGN` **[V]**. A sealed record may not
exceed 8 MiB (`RECORD_LIMIT`) **[V]**. So "carry a version from its first day" is already true; what this slice adds
is new `kind`s inside the same envelope.

**There is already a locker.** Each document has `{ id, title, kind, name, added, bytes, sha256 }` in the index and
its exact bytes in a file of its own, checked against that size and hash when read back **[V]**. Records do not need
a second way to keep documents; they need a way to *point at* these.

`details` today is a flat map of string to string, and `MASKED = ['fullName', 'firstName', 'lastName', 'address',
'birthDate']` decides which of them show by their last characters **[V]**.

## What a record is

```
{
  id:        'k7m2q9x4',          // made here, never reused, never meaningful
  kind:      'credential',        // one of the kinds below
  title:     'Driving licence',   // what you call it, in your words
  fields:    { number: '...', expires: '...', issuer: '...' },
  documents: ['3f8a...', ...],    // ids of locker documents that prove it
  confirmed: '2026-11-23T09:14:02+00:00' | null,
  added:     '2026-11-23T09:10:55+00:00',
  changed:   '2026-11-23T09:14:02+00:00',
}
```

Every value in `fields` is a string, as `cleanDetails` already requires of details **[V]** — no numbers, no nested
objects, no arrays. A date is a string in the form the person typed; Form Filler already knows how to read and write
dates for blanks, and a record is not the place to start storing them twice **[I]**.

## The four kinds, and what each field gives away

The proposal's fifth part of the privacy wall says which kinds are shown by their last characters, and that **a new
kind must declare which it is**. So every field declares `shown` or `hidden`, and **a field that declares nothing is
hidden**. That default is the whole point: a field nobody thought about must fail towards privacy, not away from it
**[I]**. Hidden means `masked()`, which is already how the page shows a name or a date of birth **[V]**.

### `identity` — a passport, a driving licence, a birth certificate

| Field | | Why |
| --- | --- | --- |
| `number` | hidden | the thing the form wants and the thing worth stealing |
| `nameOnIt` | hidden | a name, as `fullName` already is |
| `issuer` | shown | which office issued it gives nothing away |
| `where` | shown | the state or country it is valid in |
| `issued`, `expires` | shown | dates about the document, not about you |

### `bank` — one account

| Field | | Why |
| --- | --- | --- |
| `account`, `routing` | hidden | the example already shows bank numbers by their last four **[V]** |
| `accountName` | hidden | a name |
| `institution` | shown | which bank, which the payee learns anyway |
| `sort` | shown | what kind of account: current, savings |
| `opened` | shown | a date about the account |

### `employment` — one position, not a whole history

A history is a set of these, ordered by `from`. One record per position, because a form asks for one at a time, and
because a position ends without the others changing **[I]**.

| Field | | Why |
| --- | --- | --- |
| `employer`, `title` | shown | what a form asks for openly, and what a reference letter already says |
| `from`, `to` | shown | dates about the job |
| `address` | shown | the employer's address, not yours |
| `supervisor` | hidden | somebody's name, and not even yours to give |
| `pay` | hidden | what you earned is nobody's business until you say so |

### `credential` — a professional licence or certification

| Field | | Why |
| --- | --- | --- |
| `number` | hidden | the licence number |
| `body` | shown | who awards it |
| `kind` | shown | what it is |
| `issued`, `expires` | shown | dates about the credential |
| `status` | shown | active, lapsed, suspended, as the body words it |

This is the proposal's worked case: *"a licence number, the date it expires, and the scan of it belong together"*.
In this shape they do: two fields and a document id on one record.

## Documents belong to the locker, and records point at them

A record names document ids; a document knows nothing about records. That is deliberate **[I]**:

- One document can prove two things. A payslip is evidence of a job and of what it paid.
- The locker already works and is already backed up, checked and restored. Nothing about it needs to change.
- **Removing a record leaves its documents where they are.** A record is a set of fields; a document is a thing you
  were given. Throwing away the first should not throw away the second.
- **Removing a document is its own act**, and the page should say which records are about to lose their proof
  before it happens.

## `confirmed` means somebody looked, not somebody typed

`confirmed` is set when the person says *this is still right*, and by nothing else. Editing a record sets `changed`,
not `confirmed`. A record that has never been confirmed says so rather than showing a date **[I]**.

This matters because it is the same honesty the finder already owes about a form's "last checked": a record that
quietly looks fresh because somebody fixed a typo in it is worse than one that admits nobody has checked since 2023.

**Open:** whether a form filled from a long-unconfirmed record should say so as it fills. It is a question about the
screen, not about the shape, so the shape does not settle it.

## What sharing needs from this shape

The proposal asks that sharing a credential can give the number alone, the number and the expiry, or the scan as
well — chosen each time, and shown before it goes. A share is then:

```
{ recordId, fields: ['number', 'expires'], documents: [] }
```

The shape's only job is to make the parts nameable, which a flat map of named strings does. Two rules belong with it
rather than with the screen **[I]**: a share names fields explicitly and never says "all"; and what is about to go is
shown in the same masking the page uses, so a hidden field being shared in full is visibly a decision.

## Where records live, and the choice I would not make

**Proposed:** `records/index.age` holding `{ kind: 'records-index', id: 'records', records: [{ id, kind, title }] }`,
and `records/<id>.age` holding one record each — the locker's pattern exactly **[I]**.

The alternative is one `records.age` holding all of them, which is simpler and smaller. I would not take it, for
four reasons: the per-file pattern is already in the codebase, so the store, the backup and the restore handle a
folder of sealed files today; rewriting one record touches one file, so a crash or a bug has a blast radius of one;
the 8 MiB limit then applies per record rather than to every record together; and an older build meeting a record
whose kind it does not know can leave that file completely alone.

That last point needs a rule either way, and it is the one most likely to be got wrong:

> **An index entry whose kind this build does not know is carried through untouched, never dropped.** A build that
> rewrites the index must write back every entry it read, including the ones it could not use.

Without that rule, opening a newer vault in an older build and changing one record silently deletes the rest. With
one file instead of many, the same rule is needed and is easier to forget.

**Versions.** Records keep the envelope's `version: 1`. A reader that meets a version it does not know refuses that
file and says so, as `EFOREIGN` already does **[V]** — it does not open it partially and guess. A version is raised
only when the meaning of an existing field changes; adding a kind, or a field to a kind, does not raise it **[I]**.

## What this does not change

- **Login passwords stay out.** They belong to the password manager. The vault holds what forms ask for, not what
  websites ask for. No kind here has a `password` field, and none should be added.
- **The privacy wall holds.** Nothing is uploaded, nothing is sent without a click, and the on-screen masking is the
  existing `masked()` rather than a second idea of hiding.
- **The profile stays as it is.** `profile.age` keeps the flat details that autofill uses, and records sit beside it.
  Folding the profile into a record of kind `person` would be tidier, and I would not do it in this slice **[I]**:
  autofill is the thing that works today, and this slice should not put it at risk to win an abstraction. Once
  records have been used in anger, that fold is a small separate change.

## What would prove it

From the proposal, with what each one is really testing:

1. A licence put in, backed up, restored on an empty machine, and still readable — that records ride the existing
   backup. They should, since a backup takes everything in the data folder **[V]**, but "should" is not "does".
2. The same licence shared three ways — number; number and expiry; with the scan — with the share showing exactly
   what it is about to give, each time.
3. A record whose kind the build does not know, read and written back, still there afterwards. This is the
   carry-through rule above, and it is the check most worth writing first, because its absence is silent.
4. A document removed while a record points at it: the page says which records lose their proof, before it happens.
5. A new field with no declared sensitivity: shown hidden, not shown plainly.

## Questions for the owner

- **Is `employment` one record per position, or one record holding a list?** Per position is proposed above. A list
  is fewer records to manage; separate records are easier to confirm, share and end one at a time.
- **Should a record be able to say which form fields it answers?** It would let the finder's forms fill from records
  directly. It would also tie the vault's shape to a form library that does not exist yet, which argues for leaving
  it out of version 1.
- **How much should the vault hold of somebody else's details** — a supervisor, an emergency contact, a spouse?
  Forms ask for them constantly. They are the one category where the person whose data it is cannot consent.
