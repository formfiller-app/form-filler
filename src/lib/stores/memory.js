// A vault store in memory: for tests, and for a browser that will not keep anything (nothing outlives the page).
//
// Every store has the same five calls: get(name) gives a file's bytes or null; put(name, bytes, { prev }) writes it
// whole, keeping the copy before as "<name>.prev" (with prev: false, keeping none, and dropping any kept before);
// remove(name) takes a file away with any copy kept of it, and says nothing if it was not there; list(prefix) gives
// the names under a prefix, not counting the kept copies; clear() forgets every file.
export function memoryStore() {
  const files = new Map();
  return {
    async get(name) { return files.has(name) ? files.get(name).slice() : null; },
    async put(name, bytes, { prev = true } = {}) {
      if (prev && files.has(name)) files.set(name + '.prev', files.get(name));
      if (!prev) files.delete(name + '.prev');
      files.set(name, new Uint8Array(bytes));
    },
    async remove(name) { files.delete(name); files.delete(name + '.prev'); },
    async list(prefix = '') { return [...files.keys()].filter(name => name.startsWith(prefix) && !name.endsWith('.prev')).sort(); },
    async clear() { files.clear(); },
    // The tests' own look at what is kept, kept copies included: name to bytes.
    dump() { return new Map([...files].map(([name, bytes]) => [name, bytes.slice()])); },
  };
}
