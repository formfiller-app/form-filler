# Restoring a Form Filler backup

Every backup holds this text as README.txt; src/lib/backup.js writes it and tests/backup.test.js checks the two agree.

```text
FORM FILLER BACKUP

This folder is one Form Filler backup, named for the minute it was made.

  snapshot.tar.age   everything: the archive, and the vault, templates and
                     settings from Form Filler's data folder, in one tar,
                     encrypted with age to your vault's key
  identity.age       the vault's key, locked with your passphrase
  snapshot.sha256    the fingerprints of those two files, to check a copy
  README.txt         this text

Nothing in it can be read without your passphrase or your recovery key.
Form Filler never deletes a backup: delete old ones yourself, when you like.


1. CHECK THE COPY

In this folder, on a Mac:

    shasum -a 256 -c snapshot.sha256

or on Linux:

    sha256sum -c snapshot.sha256

Both lines must say OK. FAILED means this copy is damaged: use another
backup.


2. RESTORE WITH FORM FILLER

In the Mac app: open Backups, press "Restore from a backup somewhere
else", and choose this folder. On a Mac where the app has no vault yet,
its first screen offers "Restore from a backup instead".

From the command line:

    form-filler backup restore "THIS FOLDER" --data "DATA" --archive "ARCHIVE"

DATA is Form Filler's data folder, and ARCHIVE is where the archive goes.

Either way it asks for the passphrase you had when this backup was made,
or your recovery key; checks every file before anything is moved; and
never overwrites anything: if an archive or a vault is there already,
the restored copy goes beside it, named "... (restored YYYY-MM-DD HHMM)"
for the minute this backup was made.


3. RESTORE WITHOUT FORM FILLER

You need age (age-encryption.org; on a Mac, brew install age; on Debian
or Ubuntu, sudo apt install age) and tar, which every Mac and Linux has.
In a copy of this folder on your computer, or in this folder itself, run
this one line. It needs room for about twice the size of snapshot.tar.age:
once unencrypted in snapshot.tar, and once unpacked in restored/.

    age -d -i identity.age -o snapshot.tar snapshot.tar.age && mkdir restored && tar -x -f snapshot.tar -C restored

age asks for the passphrase you had when this backup was made. With only
your recovery key: write it into a file named key.txt, on one line, in
capitals, without the spaces; then run the same line with -i key.txt in
place of -i identity.age.

If age prints an error, stop, and delete snapshot.tar if it is there: age
may have written part of the backup into it, unencrypted, before it found
the problem. The passphrase or the key is wrong, or there was not room
enough, or this backup is damaged; the && kept tar from running.

age checks every byte, so what tar unpacks after age has finished cleanly
is the snapshot exactly as it was sealed. It cannot say who sealed it:
anyone who has your vault's public key could seal one. So keep your
backups on drives you control.

What you get:

  restored/archive         your archive: move it to where you keep it, and
                           name it as you like
  restored/data            Form Filler's data folder, with vault/,
                           templates/ and settings.json
  restored/manifest.json   every file, with its size and SHA-256

The vault's own files stay encrypted, to the same key; with only your
recovery key, use -i key.txt in place of -i identity.age here too. This
shows your details:

    age -d -i identity.age restored/data/vault/profile.age

restored/data/vault/locker/index.age is the locker's list, and each
document is restored/data/vault/locker/<its id>.age. This writes one to
a file named NAME:

    age -d -i identity.age -o NAME restored/data/vault/locker/<its id>.age

Then delete snapshot.tar, and key.txt if you made one: snapshot.tar holds
everything unencrypted, and key.txt opens everything.

File names come back as they were: tar carries each whole name, accents,
spaces and long names included. On a Mac, the stock tar writes an
accented letter in its other encoding (an e and then an accent, for é),
which the Mac shows and opens as the same name.


Form Filler's own restore is the safer way: it also checks every file
against the manifest, and that the vault opens, before anything is moved.
```
