# The shell spike: what it found

Slice 1 of [PHASE2_PROPOSAL.md](PHASE2_PROPOSAL.md), run 2026-11-20. A throwaway Tauri app (`spike/shell`, kept on a
local `spike-shell` branch, not merged and not pushed) that loads this repository's built page and runs each check by
itself, reporting to the terminal. Tauri 2.12.7 with `tauri-plugin-fs` 2.7.1, `-dialog` 2.8.4 and `-persisted-scope`
2.4.3; Rust 1.94.1; `age-encryption` 0.3.1; macOS 26.7.2 on Apple silicon. **[V]** means run here, or read here in the
code a row names (the row says which); **[I]** means inferred.

## What it found

| The question | The answer |
| --- | --- |
| Rust | 1.94.1 was already installed through `rustup`. **[V]** |
| The page in a Tauri window | Yes. Built with plain `cargo`, the page (`dist/`) is embedded in the program and served by it at `tauri://localhost`, with no server. The footer reads the page's version. **[V]** That the page's own files need no network there is **[V]** from Tauri's code, not from a run: the network was on and not watched. |
| Which webview | WebKit (`AppleWebKit/605.1.15`), so WKWebView. **[V]** |
| A PDF in the real webview | The invented `form.pdf` gives "13 blanks found" in about a second, with every label as on the web page. So the text reader's worker and its WebAssembly load from `tauri://` (they have no fallback), and pdf.js works there. Forms are remembered across restarts, in the app's own WebKit storage. **[V]** Whether pdf.js ran its worker as a worker, or in its fallback on the page, was not checked: the fallback only warns in the console, and the spike reported errors only. |
| A service worker | It does not register: WebKit wants an http or https address for one. The page tries, and carries on without it. **[V]** |
| A folder, kept after a restart | Writing in a folder is refused until it is granted. Once granted it works, and after a restart it still works with no new grant: `persisted-scope` saved it in the app's data folder (`.persisted-scope`) and read it back. **[V]** Only files directly in the folder were written. |
| The same for a folder picked in the dialog | The dialog plugin grants a picked folder with the same `allow_directory`, on the same app-wide file scope, as the spike's grant. But it lets in subfolders only when the page asks, with `open({ directory: true, recursive: true })`; by default only what sits directly in the folder. The spike's grant passed `true`. **[V]** in the dialog plugin's `commands.rs`; a real click was not run. |
| `age` in the webview | 16 MB sealed with a passphrase in 564 ms and opened in 526 ms (scrypt at its default work factor). With a key pair: 69 ms and 72 ms. A 64 MB stream sealed and opened again in 566 ms. The 16 MB came back byte for byte; the stream's bytes were sampled, after `age` had checked each piece. **[V]** |
| `age` against the stock `age` tool | Not run: the tool is on hold. |
| A program with no developer's signature | The bare program, built here, runs from the terminal. It carries only the ad-hoc signature the linker adds (`codesign -dv`: `Signature=adhoc`, `TeamIdentifier=not set`). **[V]** A bundled `.app` opened from the Finder was not tried. |
| 2 GB through the shell (optimised build) | See below. **[V]** |

## The 2 GB stream

Each test sends one 8 MB piece of random bytes 256 times, to and from a folder on this Mac's own disk.

| Through the shell | 2 GB took | Speed |
| --- | --- | --- |
| Written with `FileHandle.write`, 8 MB at a time | 135 s | 15 MB/s |
| Written with `writeFile` and `{ append: true }`, 8 MB at a time | 1.0 s | 1,973 MB/s |
| Read back with `FileHandle.read` | 0.7 s | 2,821 MB/s |
| Read again and sealed with `age` in the webview | 9.1 s | 224 MB/s |
| Made in the page, sealed with `age`, written with `writeFile` appends: the backup's loop without `tar` or hashing | 9.8 s | 208 MB/s |
| Read back and opened with `age`, which checks every piece: the restore's loop without `tar` or the manifest check | 9.2 s | 223 MB/s |

`FileHandle.write` sends its bytes inside an object, which Tauri's IPC script turns into JSON, a list of numbers.
`writeFile` given bytes (a `Uint8Array`) sends them alone, as the request's raw body. **[V]** in the code: the fs
plugin's JavaScript and Rust, and Tauri's `process-ipc-message-fn.js`.

Memory was watched only in the run behind the last two rows, sampled from outside every half second
(`watch-memory.mjs`). The highest readings were 350 MB in the page's WebKit process (the one that appeared with the
program) and 126 MB in the program, while 2 GB went through. **[V]**; a peak shorter than half a second could be
missed.

So the backup loop can stay in JavaScript, as proposed, if it gathers what `age` gives out (64 KB pieces) into byte
arrays and writes each with a `writeFile` append, as the spike did 8 MB at a time. Never `FileHandle.write`, and never
`age`'s stream handed to `writeFile` as it is: given a stream, `writeFile` writes each piece with `FileHandle.write`
(**[V]** in the plugin's code; not run). `age` in JavaScript, at a little over 200 MB/s, sets the pace. At 2 GB the
Rust fallback is needed neither for speed nor for memory. **[I]** for much larger archives, a backup drive and smaller
appends; and since every read was of a file just written, and no write was synced to disk, the speeds may include the
operating system's cache.

## Found in the plugins' code, not run

These matter for phase 2. **[V]** in the code named; none was run.

- Names that start with a dot: on macOS the file scope does not let `*` or `**` match them, so a granted folder does
  not reach the archive's `.formfiller/` unless the fs plugin is set to `requireLiteralLeadingDot: false` (`tauri`
  2.12.7 `scope/fs.rs`; `tauri-plugin-fs` `config.rs`).
- A content-security policy must allow `ipc:` (for example `connect-src ipc: http://ipc.localhost`). If Tauri's `ipc:`
  request fails, it switches to `postMessage` for good, and that sends everything as JSON, bytes included
  (`ipc-protocol.js`).
- The dialog's subfolder rule above: the archive keeps its files in subfolders, so its pick needs `recursive: true`.

## Not checked

Slice 5's groundwork has since checked several of these in the app itself: see "Slice 5, as built, part 1" in
[PHASE2_PROPOSAL.md](PHASE2_PROPOSAL.md).

- Whether pdf.js runs its worker as a worker in the shell, or in its fallback on the page.
- The handwriting reader in the shell: its worker, its ONNX WebAssembly, and the 64 MB model it downloads.
- A real folder pick, by a click in the dialog; and files in a granted folder's subfolders.
- `age` against the stock tool (on hold).
- A bundled `.app` opened from the Finder; only the bare program was run, from the terminal.
- A strict content-security policy; the spike ran with none.
- `tar`, hashing, archives much larger than 2 GB, and a backup drive.

## What it changed on this Mac

- `~/.cargo` grew from 11 MB to 674 MB: cargo's downloads.
- Four of the app's own folders: `~/Library/Application Support/io.github.swixixle.formfiller.spike` (the saved
  scope), `~/Library/WebKit/form-filler-shell-spike`, `~/Library/Caches/form-filler-shell-spike`, and
  `form-filler-shell-spike` in the system's temporary folder (empty WebKit folders). All under 1 MB.
- `age-encryption` 0.3.1 and its seven dependencies (6 MB) were installed with npm into the session's scratch folder.
  npm's own cache, `~/.npm`, gained six of those packages (under 2 MB) and its usual log files.
- A 2 GB file was made three times, in the session's scratch folder, and deleted each time. Checked afterwards.
- The build (2.9 GB) is in the session's scratch folder. Nothing else was installed.
