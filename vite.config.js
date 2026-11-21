import { defineConfig, defaultClientConditions } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

// Which version this is, shown at the foot of the page, so an old copy on a phone is easy to tell from the new one.
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
const COMMIT = (process.env.GITHUB_SHA || (() => { try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return ''; } })()).trim().slice(0, 7);

// ONNX Runtime's "extern wasm" build: it does not pull its own 27 MB WebAssembly into the bundle; the worker points
// it at the copy in ort/ instead (scripts/prepare-assets.mjs).
const conditions = ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions];

// After a build, a service worker that keeps the page's files so it opens with no connection. The page itself and
// the printed-text reader are kept at install; the handwriting runtime (ort/, 14 MB) is kept the first time it is used.
// The version is the fingerprint of everything listed, so a new build replaces the old cache.
function serviceWorker() {
  let out;
  return {
    name: 'form-filler-service-worker', apply: 'build',
    configResolved(config) { out = config.build.outDir; },
    closeBundle() {
      const files = [], walk = dir => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else files.push(relative(out, path).split('\\').join('/')); } };
      walk(out);
      const keep = files.filter(file => file !== 'sw.js' && !file.startsWith('ort/') && !file.endsWith('.txt')).sort();
      const hash = createHash('sha256'); for (const file of keep) hash.update(file).update(readFileSync(join(out, file)));
      // Every file's SHA-256, so the worker serves a kept copy only while it is still the one built (src/app/sw.js).
      const print = file => createHash('sha256').update(readFileSync(join(out, file))).digest('hex');
      const prints = Object.fromEntries(files.filter(file => file !== 'sw.js' && !file.endsWith('.txt')).sort().map(file => ['./' + file, print(file)]));
      prints['./'] = prints['./index.html'];
      const version = hash.digest('hex').slice(0, 16), source = readFileSync('src/app/sw.js', 'utf8').replace('__VERSION__', version).replace('[/*__FILES__*/]', JSON.stringify(['./', ...keep.map(file => './' + file)]))
        .replace('{/*__PRINTS__*/}', JSON.stringify(prints));
      writeFileSync(join(out, 'sw.js'), source);
    },
  };
}

export default defineConfig({
  base: './',
  // The Mac app's own folder (src-tauri) is cargo's to watch, not the page's: a build there writes thousands of files.
  server: { host: '127.0.0.1', watch: { ignored: ['**/src-tauri/**'] } },
  resolve: { conditions },
  worker: { format: 'es' },
  define: { __APP_VERSION__: JSON.stringify(VERSION), __APP_COMMIT__: JSON.stringify(COMMIT) },
  plugins: [serviceWorker()],
});
