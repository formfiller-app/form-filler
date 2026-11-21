// Only in a test build (the cargo feature "testing"; the app itself is never built with it). scripts/mac-check.mjs
// starts such a build with the folders it may use named in the environment, and a script to run once the page has
// loaded (tests/shell, bundled into one file). The script's checks run inside the real window, against the real file
// plugin, and report to the terminal through these commands.
//
//   FF_TEST_ROOT      the one folder a check may be granted (test_grant), and everything in it
//   FF_TEST_DATA      stands in for the app's data folder; FF_TEST_HOME for your home folder (lib.rs)
//   FF_TEST_SCRIPT    the script to run in the page; FF_TEST_FIXTURES, the invented forms (tests/fixtures)
//   FF_TEST_RUN       which checks to run, for the script to read (test_setting)
//   FF_TEST_THROTTLING=default   leaves macOS free to slow a hidden window's page, to measure what that costs
//   FF_TEST_QUIET=1   the app does not come to the front or show in the Dock, so a run does not take the keyboard
//                     from whoever is at the Mac; FF_TEST_WINDOW=corner makes the window small, in a corner, and
//                     keeps it above other windows, so it stays in view while something is timed
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Instant;
use tauri::webview::PageLoadEvent;
use tauri::{ipc::Response, AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

static STARTED: OnceLock<Instant> = OnceLock::new();
// Before any of the page's own scripts: what goes wrong while the page loads is kept for the checks to read.
const EARLY: &str = r#"
  window.__ffEarly = [];
  addEventListener('securitypolicyviolation', event => window.__ffEarly.push('content policy: ' + event.violatedDirective + ' blocked ' + (event.blockedURI || 'inline') + ' at ' + (event.sourceFile || '?') + ':' + event.lineNumber));
  addEventListener('error', event => window.__ffEarly.push('error: ' + (event.message || ('loading ' + (event.target && (event.target.src || event.target.href))))), true);
  addEventListener('unhandledrejection', event => window.__ffEarly.push('unhandled: ' + (event.reason && event.reason.message || event.reason)));
  for (const level of ['error', 'warn']) { const plain = console[level].bind(console); console[level] = (...said) => { window.__ffEarly.push('console.' + level + ': ' + said.map(String).join(' ')); plain(...said); }; }
"#;

#[tauri::command]
pub fn test_report(what: String) {
    let ms = STARTED.get().map(|at| at.elapsed().as_millis()).unwrap_or(0);
    println!("[{ms:>7} ms] {what}");
}

#[tauri::command]
pub fn test_done(app: AppHandle, code: i32) {
    app.exit(code);
}

#[tauri::command]
pub fn test_setting(name: String) -> Option<String> {
    match name.as_str() {
        "root" | "run" | "home" | "data" | "throttling" => std::env::var(format!("FF_TEST_{}", name.to_uppercase())).ok(),
        _ => None,
    }
}

// The window hidden, minimized or shown again, to time the page's work while nobody can see it.
#[tauri::command]
pub fn test_window(window: WebviewWindow, state: String) -> Result<(), String> {
    match state.as_str() {
        "hide" => window.hide(),
        "show" => window.show(),
        "minimize" => window.minimize(),
        "unminimize" => window.unminimize(),
        _ => return Err("not a window state".into()),
    }
    .map_err(|error| error.to_string())
}

// A wait kept by the app, not by the page: a hidden page's own timers are among the things macOS slows.
#[tauri::command]
pub async fn test_wait(ms: u64) {
    std::thread::sleep(std::time::Duration::from_millis(ms.min(600_000)));
}

// What the folder dialog does once a folder is picked (allow_directory on the file scope, with its subfolders), done
// without the dialog so a run needs no click. Only FF_TEST_ROOT and what is in it can be granted.
#[tauri::command]
pub fn test_grant(app: AppHandle, path: String) -> Result<(), String> {
    let root = std::env::var("FF_TEST_ROOT").map_err(|_| "FF_TEST_ROOT is not set".to_string())?;
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    // A file that a save dialog would name is not there yet: its folder is looked at, and its name kept.
    let asked = Path::new(&path);
    let real = match fs::canonicalize(asked) {
        Ok(real) => real,
        Err(_) => match (asked.parent(), asked.file_name()) {
            (Some(folder), Some(name)) => fs::canonicalize(folder).map_err(|error| error.to_string())?.join(name),
            _ => return Err("not a path".into()),
        },
    };
    if !real.starts_with(&root) {
        return Err("only FF_TEST_ROOT may be granted".into());
    }
    app.fs_scope().allow_directory(&path, true).map_err(|error| error.to_string())
}

// One of the repository's invented fixtures, by its plain name only.
#[tauri::command]
pub fn test_fixture(name: String) -> Result<Response, String> {
    let plain = !name.is_empty() && !name.starts_with('.') && !name.contains("..") && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
    if !plain {
        return Err("not a fixture name".into());
    }
    let folder = PathBuf::from(std::env::var("FF_TEST_FIXTURES").map_err(|_| "FF_TEST_FIXTURES is not set".to_string())?);
    let path: &Path = &folder.join(&name);
    fs::read(path).map(Response::new).map_err(|error| format!("{}: {error}", path.display()))
}

// Before the window is made: a quiet run stays out of the Dock and does not come to the front.
pub fn quiet<R: Runtime>(app: &mut tauri::App<R>) {
    if std::env::var("FF_TEST_QUIET").is_ok() {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
}

pub fn watch<'a, R: Runtime, M: Manager<R>>(window: WebviewWindowBuilder<'a, R, M>) -> WebviewWindowBuilder<'a, R, M> {
    STARTED.get_or_init(Instant::now);
    let window = window.initialization_script(EARLY);
    let window = if std::env::var("FF_TEST_QUIET").is_ok() { window.focused(false) } else { window };
    let window = if std::env::var("FF_TEST_WINDOW").as_deref() == Ok("corner") {
        window.inner_size(420.0, 560.0).position(20.0, 60.0).always_on_top(true)
    } else {
        window
    };
    let Some(script) = std::env::var("FF_TEST_SCRIPT").ok().and_then(|path| fs::read_to_string(path).ok()) else {
        return window;
    };
    window.on_page_load(move |page, payload| {
        if payload.event() == PageLoadEvent::Finished {
            let _ = page.eval(script.as_str());
        }
    })
}
