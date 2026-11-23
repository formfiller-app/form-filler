// A vault store in this browser: IndexedDB, in a database of its own, one record per name. A put changes a name and
// its kept copy ("<name>.prev") in one transaction, so both change or neither does. The calls are the same as every
// store's (stores/memory.js says what they do). Where the browser keeps nothing (some private windows), every call
// fails, saying so. A connection that another tab needs closed (or that the browser closes) is let go, and the next
// call opens a new one; while another tab holds the database in the way of an upgrade, calls wait for it.
export function browserStore({ database = 'form-filler-vault', indexedDB = globalThis.indexedDB } = {}) {
  let opening = null;
  const opened = () => opening ??= new Promise((done, failed) => {
    if (!indexedDB) { failed(new Error('This browser keeps nothing here (it has no IndexedDB).')); return; }
    let request;
    try { request = indexedDB.open(database, 1); } catch (error) { failed(error); return; }
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      db.onclose = () => { opening = null; };
      done(db);
    };
    request.onerror = () => failed(request.error || new Error('This browser would not open its storage.'));
    request.onblocked = () => { /* another tab holds the database open: this one waits until it lets go */ };
  }).catch(error => { opening = null; throw error; });
  // One transaction: `work` makes its requests at once (and in their callbacks), and what it hands to `keep` is the
  // answer, given when the transaction has finished.
  const transaction = async (mode, work) => {
    const db = await opened();
    return new Promise((done, failed) => {
      let answer;
      const tx = db.transaction('files', mode);
      tx.oncomplete = () => done(answer);
      tx.onerror = () => failed(tx.error || new Error('This browser\'s storage refused the change.'));
      tx.onabort = () => failed(tx.error || new Error('This browser\'s storage refused the change.'));
      work(tx.objectStore('files'), value => { answer = value; });
    });
  };
  return {
    get: name => transaction('readonly', (files, keep) => { const request = files.get(name); request.onsuccess = () => keep(request.result === undefined ? null : new Uint8Array(request.result)); }),
    put: (name, bytes, { prev = true } = {}) => transaction('readwrite', files => {
      const before = files.get(name);
      before.onsuccess = () => {
        if (prev && before.result !== undefined) files.put(before.result, name + '.prev');
        if (!prev) files.delete(name + '.prev');
        files.put(new Uint8Array(bytes), name);
      };
    }),
    remove: name => transaction('readwrite', files => { files.delete(name); files.delete(name + '.prev'); }),
    list: (prefix = '') => transaction('readonly', (files, keep) => {
      const request = files.getAllKeys();
      request.onsuccess = () => keep(request.result.map(String).filter(name => name.startsWith(prefix) && !name.endsWith('.prev')).sort());
    }),
    clear: () => transaction('readwrite', files => { files.clear(); }),
  };
}
