// Form Filler as a library: everything the page does that needs no browser. Import it from another program:
//
//   import { readTemplate, placeAnswers, buildPdf } from 'form-filler';
//
// blanks.js needs the page's pixels (gray, one byte per pixel); the rest work on JSON and PDF bytes alone.
export { threshold, skewOf, rotate, findBlanks, findOptions, nameOptions, order, labelFor, labelBlanks, cleanWords } from './blanks.js';
export { headerCells, headerLabel, headerLabels, cropOf } from './headers.js';
export { TICK, splitAnswers, placeAnswers, numberedLines } from './answers.js';
export { readFields, readableName, pickOption, withFound } from './fields.js';
export { plain, fitSize, wrap, isSignature, buildPdf, joinPdfs } from './output.js';
export { KINDS, makeTemplate, readTemplate } from './templates.js';
export { DETAILS, MASKED, masked, detailFor, detailValue, isDate, isSignatureLabel, formatDate, autofill } from './profile.js';
export { parseCsv, matchColumns, columnIds, columnsNow, rowValues } from './merge.js';
export { segmentLines } from './handwriting.js';
export { HANDWRITING_MODELS } from './models.js';
export { sha256 } from './hash.js';
// The archive works through a file interface it is handed: for Node, `nodeFiles` from 'form-filler/files/node'.
export { INBOX, UNSORTED, FILING_THRESHOLD, cleanName, matterPath, localTime, readRecord, checkItem, itemsWithFile, openArchive } from './archive.js';
// The vault keeps its files in a store it is handed: 'form-filler/stores/node', '…/browser' or '…/memory'.
export { MIN_PASSPHRASE, checkPassphrase, cleanDetails, cleanSignature, vaultInfo, createVault, unlockVault, unlockKey, forgetVault } from './vault.js';
// The kinds of record the vault can hold, and what each of their fields gives away: docs/VAULT_RECORDS.md.
export { RECORD_KINDS, KIND_NAMES, isKnownKind, fieldsOf, labelOf, sensitivity, shownValue, cleanRecordFields, shareOf } from './record-kinds.js';
// Backups work through the same file interfaces as the archive: for Node, `nodeFiles` from 'form-filler/files/node'.
export { BACKUPS, README_TEXT, makeBackup, listBackups, verifyBackup, restoreBackup } from './backup.js';
