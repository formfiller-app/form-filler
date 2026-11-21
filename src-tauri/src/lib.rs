// Form Filler's Mac app: the page (../dist, built by Vite) in a window of its own, served by the app itself, with
// real folders. What decides anything stays in JavaScript (src/lib and src/app), where the tests are. The page reads
// and writes files through Tauri's file plugin; this file adds only what that plugin cannot do:
//
//   places       where things are: the app's data folder, and the folder that holds the archive by default (home)
//   grant_home   lets the page use one of Form Filler's own folders in your home folder, by name, and nothing else
//                there: "Form Filler Archive", a copy a restore put beside it, or a restore's hidden staging folder
//   home_names   which of those names are in your home folder now; of anything else there, the page learns nothing
//   settle       a file written through to the disk, before it is given its name (the plugin never syncs)
//   name_file    a file given a name that must not be taken yet: as a second name, and then the first one goes
//                (the plugin's rename would silently replace whatever had the name)
//   real_path    a path with every link followed, so the page can refuse a folder that leads out of its place
//   whoami, alive   for the archive's lock: this program's process and computer, and whether another still runs
//   reveal       a file or folder shown in Finder
//   print_page   the page printed
//
// Every command that takes a path refuses one outside the folders the page has been granted, as the plugin's own
// commands do: the app's data folder (granted here, at the start), a folder you picked in a dialog (granted by the
// dialog), or one of the names grant_home takes. Nothing else on the disk can be reached.
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Error, ErrorKind};
use std::path::{Path, PathBuf};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

const ARCHIVE: &str = "Form Filler Archive";

// Errors go to the page as text, written as the file plugin writes its own, so the page reads both the same way:
// "… (os error 17)" for the system's, and a bare code ("EEXIST", "ENOLINK") where the page must tell which it was.
fn said(doing: &str, path: &Path, error: Error) -> String {
    format!("failed to {doing} at path: {} with error: {error}", path.display())
}
fn forbidden(path: &Path) -> String {
    format!("forbidden path: {}", path.display())
}
fn text(path: PathBuf) -> Result<String, String> {
    path.into_os_string().into_string().map_err(|_| "a path that is not text".to_string())
}

// A path the page may use, as the disk has it with every link followed, or a refusal.
fn allowed(app: &AppHandle, real: PathBuf, asked: &Path) -> Result<PathBuf, String> {
    let scope = app.fs_scope();
    if scope.is_allowed(&real) && !scope.is_forbidden(&real) {
        Ok(real)
    } else {
        Err(forbidden(asked))
    }
}
// What is at `path` now, with every link followed.
fn granted(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(forbidden(path));
    }
    let real = fs::canonicalize(path).map_err(|error| said("find what is", path, error))?;
    allowed(app, real, path)
}
// The folder of a name that may not be there yet, with every link followed, and the name: the name itself is never
// followed, so a link standing at it is something that has the name, not a way to somewhere else.
fn folder_and_name(path: &Path) -> Result<PathBuf, String> {
    let (Some(folder), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(forbidden(path));
    };
    if !path.is_absolute() {
        return Err(forbidden(path));
    }
    Ok(fs::canonicalize(folder).map_err(|error| said("find the folder", folder, error))?.join(name))
}

// The names Form Filler itself makes in the folder that holds the archive: the archive; a copy a restore put beside
// it, "Form Filler Archive (restored 2026-11-17 1530)", then " (2)" to " (999)"; and a restore's staging folder,
// ".ff-staging-" and 16 hex digits (src/lib/backup.js writes both shapes).
fn own_name(name: &str) -> bool {
    if let Some(digits) = name.strip_prefix(".ff-staging-") {
        return digits.len() == 16 && digits.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));
    }
    let Some(rest) = name.strip_prefix(ARCHIVE) else { return false };
    if rest.is_empty() {
        return true;
    }
    let Some(rest) = rest.strip_prefix(" (restored ") else { return false };
    let shape = b"dddd-dd-dd dddd)";
    let stamped = rest.len() >= shape.len()
        && shape.iter().zip(rest.bytes()).all(|(want, got)| if *want == b'd' { got.is_ascii_digit() } else { *want == got });
    if !stamped {
        return false;
    }
    let rest = &rest[shape.len()..];
    if rest.is_empty() {
        return true;
    }
    match rest.strip_prefix(" (").and_then(|counted| counted.strip_suffix(')')) {
        Some(count) => (1..=3).contains(&count.len()) && count.bytes().all(|byte| byte.is_ascii_digit()) && !count.starts_with('0'),
        None => false,
    }
}

// A second name for a file is refused on some disks (many USB drives); the page then holds the name another way.
fn no_second_names(error: &Error) -> bool {
    matches!(error.raw_os_error(), Some(code) if [libc::EPERM, libc::ENOTSUP, libc::EOPNOTSUPP, libc::ENOSYS, libc::EMLINK, libc::EXDEV].contains(&code))
}
// The file at `source` given the name `target`, which must not be taken: a second name first (the system refuses
// that in one step if anything has the name, a link too), and then the first name goes.
fn give_name(source: &Path, target: &Path) -> Result<(), String> {
    match fs::hard_link(source, target) {
        Ok(()) => fs::remove_file(source).map_err(|error| said("remove the first name", source, error)),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Err("EEXIST".into()),
        Err(error) if no_second_names(&error) => Err("ENOLINK".into()),
        Err(error) => Err(said("name the file", target, error)),
    }
}

fn data_folder(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(feature = "testing")]
    if let Ok(folder) = std::env::var("FF_TEST_DATA") {
        return Ok(PathBuf::from(folder));
    }
    app.path().app_data_dir().map_err(|error| error.to_string())
}
fn home_folder(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(feature = "testing")]
    if let Ok(folder) = std::env::var("FF_TEST_HOME") {
        return Ok(PathBuf::from(folder));
    }
    app.path().home_dir().map_err(|error| error.to_string())
}

#[derive(Serialize)]
struct Places {
    data: String,
    home: String,
    archive: String,
}
#[tauri::command]
fn places(app: AppHandle) -> Result<Places, String> {
    let home = home_folder(&app)?;
    Ok(Places { data: text(data_folder(&app)?)?, archive: text(home.join(ARCHIVE))?, home: text(home)? })
}

// A place that is a plain folder, or free for one to be made. Not a link: granting a link would grant the folder it
// leads to. (A link put there after the grant gets nothing: the file plugin checks the real path of what it touches.)
fn folder_or_free(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(found) => found.file_type().is_dir(),
        Err(error) => error.kind() == ErrorKind::NotFound,
    }
}
#[tauri::command]
fn grant_home(app: AppHandle, name: String) -> Result<String, String> {
    if !own_name(&name) {
        return Err(format!("forbidden name: {name}"));
    }
    let folder = home_folder(&app)?.join(&name);
    // There, and not a plain folder: the name is taken, by something the page gets no way through.
    if !folder_or_free(&folder) {
        return Err("EEXIST".into());
    }
    app.fs_scope().allow_directory(&folder, true).map_err(|error| error.to_string())?;
    text(folder)
}

#[derive(Serialize, Debug, PartialEq)]
struct Named {
    name: String,
    kind: &'static str,
}
// Form Filler's own names in a folder, each with what it is; a link is "other", and is never followed.
fn own_names_in(folder: &Path) -> Result<Vec<Named>, String> {
    let mut found = Vec::new();
    for entry in fs::read_dir(folder).map_err(|error| said("read directory", folder, error))? {
        let Ok(entry) = entry else { continue };
        let Ok(name) = entry.file_name().into_string() else { continue };
        if !own_name(&name) {
            continue;
        }
        let kind = match entry.file_type() {
            Ok(kind) if kind.is_dir() => "folder",
            Ok(kind) if kind.is_file() => "file",
            _ => "other",
        };
        found.push(Named { name, kind });
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(found)
}
#[tauri::command]
fn home_names(app: AppHandle) -> Result<Vec<Named>, String> {
    own_names_in(&home_folder(&app)?)
}

#[tauri::command]
fn settle(app: AppHandle, path: String) -> Result<(), String> {
    let real = granted(&app, Path::new(&path))?;
    File::open(&real).and_then(|file| file.sync_all()).map_err(|error| said("write through to the disk the file", &real, error))
}

#[tauri::command]
fn name_file(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let (from, to) = (Path::new(&from), Path::new(&to));
    let kind = fs::symlink_metadata(from).map_err(|error| said("find the file", from, error))?.file_type();
    if !kind.is_file() {
        return Err(format!("only a plain file is given a name, and this is not one: {}", from.display()));
    }
    let source = granted(&app, from)?;
    let target = folder_and_name(to)?;
    // Taken already, by anything at all: said before the scope is asked, which would follow a link standing there.
    if fs::symlink_metadata(&target).is_ok() {
        allowed(&app, target.parent().unwrap_or(&target).to_path_buf(), to)?;
        return Err("EEXIST".into());
    }
    let target = allowed(&app, target, to)?;
    give_name(&source, &target)
}

// The home folder's own real path is given too (`places` names the folder already), so the page can tell that one of
// Form Filler's names in it has not been swapped for a link that leads elsewhere. Nothing in it is read for that.
#[tauri::command]
fn real_path(app: AppHandle, path: String) -> Result<String, String> {
    let asked = Path::new(&path);
    if let (Ok(real), Ok(home)) = (fs::canonicalize(asked), home_folder(&app).and_then(|home| fs::canonicalize(home).map_err(|error| error.to_string()))) {
        if asked.is_absolute() && real == home {
            return text(real);
        }
    }
    text(granted(&app, asked)?)
}

#[derive(Serialize)]
struct Who {
    pid: u32,
    host: String,
}
// As Node's process.pid and os.hostname() give them, so the command line and the app read each other's lock.
#[tauri::command]
fn whoami() -> Who {
    let mut name = [0u8; 256];
    let host = if unsafe { libc::gethostname(name.as_mut_ptr().cast(), name.len()) } == 0 {
        let end = name.iter().position(|&byte| byte == 0).unwrap_or(name.len());
        String::from_utf8_lossy(&name[..end]).into_owned()
    } else {
        String::new()
    };
    Who { pid: std::process::id(), host }
}
// Whether a process is still running on this computer (a signal of 0 asks, and sends nothing).
#[tauri::command]
fn alive(pid: i32) -> bool {
    pid > 0 && (unsafe { libc::kill(pid, 0) } == 0 || Error::last_os_error().raw_os_error() == Some(libc::EPERM))
}

#[tauri::command]
fn reveal(app: AppHandle, path: String) -> Result<(), String> {
    let real = granted(&app, Path::new(&path))?;
    match std::process::Command::new("/usr/bin/open").arg("-R").arg(&real).status() {
        Ok(status) if status.success() => Ok(()),
        Ok(_) => Err("Finder would not show it.".into()),
        Err(error) => Err(said("show in Finder what is", &real, error)),
    }
}

#[tauri::command]
fn print_page(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}

// The window shows Form Filler's own page and goes nowhere else: no web address is ever opened in it.
fn own_page(url: &Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || url.as_str() == "about:blank"
        || (cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(5173))
}

fn throttling() -> Option<BackgroundThrottlingPolicy> {
    // A test build can be told to leave macOS's own behaviour, to measure what it costs.
    #[cfg(feature = "testing")]
    if std::env::var("FF_TEST_THROTTLING").as_deref() == Ok("default") {
        return None;
    }
    Some(BackgroundThrottlingPolicy::Disabled)
}

#[cfg(feature = "testing")]
mod testing;

#[cfg(not(feature = "testing"))]
macro_rules! commands {
    () => {
        tauri::generate_handler![places, grant_home, home_names, settle, name_file, real_path, whoami, alive, reveal, print_page]
    };
}
#[cfg(feature = "testing")]
macro_rules! commands {
    () => {
        tauri::generate_handler![
            places, grant_home, home_names, settle, name_file, real_path, whoami, alive, reveal, print_page,
            testing::test_report, testing::test_done, testing::test_grant, testing::test_fixture, testing::test_setting,
            testing::test_window, testing::test_wait
        ]
    };
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(commands!())
        .setup(|app| {
            #[cfg(feature = "testing")]
            testing::quiet(app);
            let handle = app.handle().clone();
            // The app's own data folder (the vault, the remembered forms, the settings) is the one place it may use
            // without being told: made if missing, and granted here, not in the capability file, so the commands
            // above and the plugin's check a path against the same list.
            let data = data_folder(&handle)?;
            fs::create_dir_all(&data)?;
            handle.fs_scope().allow_directory(&data, true)?;
            let title = app.config().product_name.clone().unwrap_or_else(|| "Form Filler".into());
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(title)
                .inner_size(1180.0, 900.0)
                .min_inner_size(420.0, 560.0)
                // A form dropped on the window goes to the page itself, as it does in a browser.
                .disable_drag_drop_handler()
                .on_navigation(own_page);
            // A backup, a check or a restore goes on at full speed while the window is hidden or covered: left to
            // itself, macOS slows the page of a window nobody can see (a check of 512 MB took 8 s seen and far
            // longer hidden; docs/PHASE2_PROPOSAL.md).
            let window = match throttling() {
                Some(policy) => window.background_throttling(policy),
                None => window,
            };
            #[cfg(feature = "testing")]
            let window = testing::watch(window);
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Form Filler did not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_form_fillers_own_names_are_granted_in_the_home_folder() {
        for name in [
            "Form Filler Archive",
            "Form Filler Archive (restored 2026-11-17 1530)",
            "Form Filler Archive (restored 2026-11-17 1530) (2)",
            "Form Filler Archive (restored 2026-11-17 1530) (999)",
            ".ff-staging-0123456789abcdef",
        ] {
            assert!(own_name(name), "{name}");
        }
        for name in [
            "", ".", "..", "Documents", ".ssh", "Form Filler Archive ", "Form Filler Archive/x", "Form Filler Archive/..",
            "Form Filler Archives", "form filler archive", "Form Filler Archive (restored)",
            "Form Filler Archive (restored 2026-11-17 1530", "Form Filler Archive (restored 2026-11-17 1530) ",
            "Form Filler Archive (restored 2026-11-17 1530) (0)", "Form Filler Archive (restored 2026-11-17 1530) (01)",
            "Form Filler Archive (restored 2026-11-17 1530) (1000)", "Form Filler Archive (restored 2026-11-17 1530)/x",
            "Form Filler Archive (restored 2026/11/17 1530)", "Form Filler Archive (restored 2026-11-17 15:30)",
            ".ff-staging-0123456789abcde", ".ff-staging-0123456789abcdef0", ".ff-staging-0123456789ABCDEF",
            ".ff-staging-0123456789abcdeg", ".ff-staging-0123456789abcdef/x", "x/.ff-staging-0123456789abcdef",
        ] {
            assert!(!own_name(name), "{name}");
        }
    }

    fn scratch(tag: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("form-filler-shell-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        fs::canonicalize(folder).unwrap()
    }

    #[test]
    fn of_a_folder_only_form_fillers_own_names_are_told() {
        let folder = scratch("names");
        for name in ["Documents", "Form Filler Archive", "Form Filler Archive (restored 2026-11-17 1530)", ".ff-staging-0123456789abcdef", ".ssh"] {
            fs::create_dir(folder.join(name)).unwrap();
        }
        fs::write(folder.join("notes.txt"), b"mine").unwrap();
        fs::write(folder.join(".ff-staging-00000000000000aa"), b"a file with a staging folder's name").unwrap();
        std::os::unix::fs::symlink(folder.join("Documents"), folder.join("Form Filler Archive (restored 2026-11-17 1530) (2)")).unwrap();
        let told: Vec<(String, &str)> = own_names_in(&folder).unwrap().into_iter().map(|entry| (entry.name, entry.kind)).collect();
        assert_eq!(told, [
            (".ff-staging-00000000000000aa".to_string(), "file"),
            (".ff-staging-0123456789abcdef".to_string(), "folder"),
            ("Form Filler Archive".to_string(), "folder"),
            ("Form Filler Archive (restored 2026-11-17 1530)".to_string(), "folder"),
            ("Form Filler Archive (restored 2026-11-17 1530) (2)".to_string(), "other"),
        ]);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn only_a_plain_folder_or_a_free_name_is_granted() {
        let folder = scratch("grant");
        fs::create_dir(folder.join("a folder")).unwrap();
        fs::write(folder.join("a file"), b"x").unwrap();
        std::os::unix::fs::symlink(folder.join("a folder"), folder.join("a link to a folder")).unwrap();
        std::os::unix::fs::symlink("nowhere", folder.join("a link to nowhere")).unwrap();
        assert!(folder_or_free(&folder.join("a folder")));
        assert!(folder_or_free(&folder.join("nothing here yet")));
        for refused in ["a file", "a link to a folder", "a link to nowhere"] {
            assert!(!folder_or_free(&folder.join(refused)), "{refused}");
        }
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_file_is_given_a_free_name_and_never_a_taken_one() {
        let folder = scratch("name");
        let (hidden, name) = (folder.join(".ff-new-1.tmp"), folder.join("filled - form.pdf"));
        fs::write(&hidden, b"the filled form").unwrap();
        give_name(&hidden, &name).unwrap();
        assert_eq!(fs::read(&name).unwrap(), b"the filled form");
        assert!(!hidden.exists(), "the first name is gone");

        // A taken name is refused, whatever has it (a file, a folder, a link that leads nowhere), and nothing changes.
        let again = folder.join(".ff-new-2.tmp");
        fs::write(&again, b"another").unwrap();
        fs::create_dir(folder.join("a folder")).unwrap();
        std::os::unix::fs::symlink("nowhere", folder.join("a link")).unwrap();
        for taken in ["filled - form.pdf", "a folder", "a link"] {
            assert_eq!(give_name(&again, &folder.join(taken)), Err("EEXIST".to_string()), "{taken}");
        }
        assert_eq!(fs::read(&name).unwrap(), b"the filled form", "what had the name is untouched");
        assert_eq!(fs::read(&again).unwrap(), b"another", "what was to be named is still there");
        // A Mac's disk takes two names that differ only in case for one.
        if folder.join("FILLED - FORM.PDF").exists() {
            assert_eq!(give_name(&again, &folder.join("FILLED - FORM.PDF")), Err("EEXIST".to_string()));
        }
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_name_is_never_followed_but_its_folder_is() {
        let folder = scratch("links");
        fs::create_dir(folder.join("real")).unwrap();
        std::os::unix::fs::symlink(folder.join("real"), folder.join("way in")).unwrap();
        std::os::unix::fs::symlink(folder.join("real"), folder.join("real").join("a link")).unwrap();
        // The folder's links are followed: the file would really be made in "real".
        assert_eq!(folder_and_name(&folder.join("way in").join("new.txt")).unwrap(), folder.join("real").join("new.txt"));
        // The name's own link is not: it stays the thing that has the name.
        assert_eq!(folder_and_name(&folder.join("real").join("a link")).unwrap(), folder.join("real").join("a link"));
        assert!(folder_and_name(Path::new("relative/name")).is_err());
        assert!(folder_and_name(&folder.join("missing").join("name")).is_err(), "a folder that is not there");
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn this_process_is_alive_and_nothing_at_zero_is() {
        assert!(alive(std::process::id() as i32));
        assert!(!alive(0));
        assert!(!alive(-1));
        let who = whoami();
        assert_eq!(who.pid, std::process::id());
        assert!(!who.host.is_empty());
    }

    #[test]
    fn the_window_stays_on_form_fillers_own_page() {
        for url in ["tauri://localhost", "tauri://localhost/index.html", "tauri://localhost/#details-panel", "about:blank"] {
            assert!(own_page(&Url::parse(url).unwrap()), "{url}");
        }
        for url in ["https://example.org/", "http://localhost/", "tauri://example.org/", "file:///etc/hosts", "https://tauri.localhost/"] {
            assert!(!own_page(&Url::parse(url).unwrap()), "{url}");
        }
    }
}
