// What the page keeps of you, and how. Your details and a saved signature are kept in this browser in a vault
// (src/lib/vault.js) locked with a passphrase you choose, never in plain text. The passphrase is never kept; while the
// vault is open your details are in this page's memory, and they leave it when you lock the vault, close the page,
// or leave it alone for 15 minutes (counted on the clock, so a computer that slept comes back locked).
//
// What this does and does not stop. The browser's storage belongs to the whole web address the page is served from,
// shared with every other page published there. The vault keeps such pages from reading your details out of that
// storage, but not from scripting this page while it is open. Only an address of its own closes that off, and since
// 2026-11-21 the page has one: formfiller-app.github.io, where nothing else is published (it was swixixle.github.io,
// which other pages could share). The page also refuses to run inside another page or in a window another page there
// opened and still holds (main.js), and its offline copy is checked against the fingerprints its build wrote (sw.js).
//
// The keeper's state is one of:
//   'checking'     at the start, until the browser's storage has answered
//   'none'         no vault yet: saving your details makes one, with a passphrase
//   'locked'       a vault is here; unlock it with the passphrase (or the recovery key) to use your details
//   'open'         unlocked: your details are in memory and each save is locked away at once
//   'unavailable'  this browser keeps nothing here (some private windows): your details last as long as the page
// `legacy` is true while there is no vault yet and details or a signature an earlier version kept in plain text are
// still there: they are used as before until you lock them away (make a vault with them) or forget them. Plain copies
// found beside a vault were not left by an earlier version (this one never writes them): they are `stray`, never used
// or merged, only offered for forgetting. `recoveryKey` is set once, just after a vault is made, until you say you
// have kept it; neither the idle lock nor Lock now takes it away before then.
export const MIN_PASSPHRASE = 8;   // the vault's own rule (vault.js; a test checks they agree), said here without loading it

export function makeKeeper({ store, legacy = null, onChange = () => {}, onLock = () => {}, idleMinutes = 15, clock = () => Date.now(),
  timer = { set: (run, ms) => setTimeout(run, ms), clear: id => clearTimeout(id) }, library = () => import('../lib/vault.js'), workFactor,
  channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('form-filler-vault') : null } = {}) {
  let vault = null, idle = null, lastActive = clock();
  const idleMs = idleMinutes * 60000;
  channel?.unref?.();   // in Node (the tests), a channel left open would keep the process from ending
  const keeper = { state: 'checking', details: {}, signature: null, legacy: false, stray: null, recoveryKey: null };
  const changed = () => onChange(keeper);
  const arm = () => { timer.clear(idle); idle = keeper.state === 'open' ? timer.set(() => keeper.check(), Math.max(1000, idleMs - (clock() - lastActive))) : null; };
  const hasAny = ({ details, signature }) => Object.keys(details).length > 0 || Boolean(signature);
  // Other tabs of this page hear when the vault is made, changed, locked or forgotten, and look again for themselves
  // (a message says only that something changed, never what).
  const tell = kind => { try { channel?.postMessage({ formFiller: 'vault', kind }); } catch { /* no other tabs to tell */ } };
  const recipientNow = async () => { const bytes = await store.get('vault.json'); if (!bytes) return null; try { return JSON.parse(new TextDecoder().decode(bytes)).recipient || null; } catch { return null; } };
  const shut = () => { timer.clear(idle); idle = null; vault?.lock(); vault = null; };
  const forcedLock = () => {
    const was = keeper.state;
    shut();
    if (was === 'open') { Object.assign(keeper, { state: 'locked', details: {}, signature: null, recoveryKey: null }); onLock(keeper); }
  };

  keeper.start = async () => {
    let found = false;
    try { found = Boolean(await store.get('vault.json')); keeper.state = found ? 'locked' : 'none'; } catch { keeper.state = 'unavailable'; }
    const old = legacy?.read() || { details: {}, signature: null };
    if (hasAny(old)) { if (found) keeper.stray = old; else Object.assign(keeper, { legacy: true, details: old.details, signature: old.signature }); }
    channel?.addEventListener?.('message', event => { if (event.data?.formFiller === 'vault') void keeper.recheck(event.data.kind); });
    changed();
  };
  // A new vault, locked with this passphrase, holding what the page has now. The vault and its recovery key are the
  // page's as soon as the vault is made, so the key is shown even if saving the details into it then fails (that
  // error is thrown after). Returns the recovery key.
  keeper.create = async passphrase => {
    const { createVault } = await library();
    const made = await createVault(store, passphrase, { workFactor });
    vault = made.vault; lastActive = clock();
    Object.assign(keeper, { state: 'open', recoveryKey: made.recoveryKey, stray: null });
    arm(); changed(); tell('changed');
    try {
      await vault.writeProfile({ details: keeper.details, signature: keeper.signature });
      if (keeper.legacy) { legacy?.drop(); keeper.legacy = false; }
    } finally { changed(); }
    return made.recoveryKey;
  };
  // Unlocking. If your saved details cannot be read (damaged, or put there by something else), the vault still opens,
  // empty, and the answer says why, so they can be saved again.
  keeper.unlock = async secret => {
    const { unlockVault } = await library();
    const opened = await unlockVault(store, secret);
    let kept, unreadable = null;
    try { kept = await opened.readProfile(); } catch (error) { if (error.code !== 'EFOREIGN') throw error; kept = { details: {}, signature: null }; unreadable = error.message; }
    vault = opened; lastActive = clock();
    Object.assign(keeper, { state: 'open', details: kept.details, signature: kept.signature });
    arm(); changed();
    return unreadable;
  };
  // A change to your details or signature, kept: locked away at once if the vault is open; otherwise only remembered
  // for this page, and the answer says why ('none': a passphrase is needed; 'locked'; 'unavailable').
  keeper.save = async (change = {}) => {
    if ('details' in change) keeper.details = change.details;
    if ('signature' in change) keeper.signature = change.signature;
    try {
      if (keeper.state !== 'open') return keeper.state;
      const now = await vault.writeProfile(change);
      Object.assign(keeper, { details: now.details, signature: now.signature });
      lastActive = clock(); arm(); tell('changed');
      return 'kept';
    } catch (error) { if (error.code === 'ECHANGED') forcedLock(); throw error; }
    finally { changed(); }
  };
  // The saved signature forgotten: out of the vault, and out of any plain copy an earlier version left.
  keeper.forgetSignature = async () => {
    if (keeper.legacy) { legacy?.drop('signature'); if (!Object.keys(keeper.details).length) keeper.legacy = false; }
    return keeper.save({ signature: null });
  };
  // Locked now; false (and nothing done) while a new recovery key has not yet been kept, unless forced.
  keeper.lock = ({ force = false } = {}) => {
    if (keeper.recoveryKey && !force) return false;
    const was = keeper.state;
    forcedLock();
    changed();
    if (was === 'open') tell('locked');
    return true;
  };
  // Everything gone from this browser: the vault, and any plain copies. It cannot be undone.
  keeper.forget = async () => {
    shut();
    if (keeper.state !== 'unavailable') { const { forgetVault } = await library(); await forgetVault(store); }
    legacy?.drop();
    Object.assign(keeper, { state: keeper.state === 'unavailable' ? 'unavailable' : 'none', details: {}, signature: null, legacy: false, stray: null, recoveryKey: null });
    changed(); tell('changed');
  };
  // Only the stray plain copies forgotten; the vault is left as it is.
  keeper.forgetStray = () => { legacy?.drop(); keeper.stray = null; changed(); };
  keeper.changePassphrase = async passphrase => {
    if (keeper.state !== 'open') throw new Error('Unlock your details first.');
    try { await vault.changePassphrase(passphrase, { workFactor }); } catch (error) { if (error.code === 'ECHANGED') { forcedLock(); changed(); } throw error; }
    lastActive = clock(); arm();
  };
  keeper.keptKey = () => { keeper.recoveryKey = null; changed(); };
  // The open vault itself, for what it holds besides your details (the Mac app's locker), or null while it is not
  // open. Locking forgets the key in it, so a vault taken from here and kept reads nothing once the keeper has locked.
  keeper.vault = () => keeper.state === 'open' ? vault : null;
  // 15 minutes left alone: locked (but never while a new recovery key is on show). Called by the timer, and by the page
  // whenever it comes back into view, since a timer does not run while a computer sleeps.
  keeper.check = () => {
    if (keeper.state !== 'open') return;
    if (clock() - lastActive < idleMs || keeper.recoveryKey) { arm(); return; }
    forcedLock(); changed();
  };
  // Something was done on the page: after a check for time already gone, the 15 minutes start again.
  keeper.touch = () => { keeper.check(); if (keeper.state === 'open') { lastActive = clock(); arm(); } };
  // Another tab said the vault changed or locked: look again. If it was forgotten or made again, lock here too; if it
  // is the same vault, take what that tab saved.
  keeper.recheck = async kind => {
    let recipient;
    try { recipient = await recipientNow(); } catch { return; }
    if (keeper.state === 'open') {
      if (kind === 'locked' || recipient !== vault?.recipient) { forcedLock(); if (!recipient) keeper.state = 'none'; changed(); return; }
      try { const kept = await vault.readProfile(); Object.assign(keeper, { details: kept.details, signature: kept.signature }); changed(); } catch { /* left as it is */ }
    } else if (keeper.state === 'locked' && !recipient) { keeper.state = 'none'; changed(); }
    else if (keeper.state === 'none' && recipient) {
      const old = legacy?.read() || { details: {}, signature: null };
      Object.assign(keeper, { state: 'locked', stray: hasAny(old) ? old : null, legacy: false, details: {}, signature: null });
      changed();
    }
  };
  return keeper;
}
