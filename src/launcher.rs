//! Windows app launcher: no console window. Starts `cyberlog.exe` from the
//! same folder if the server is not answering, then opens the app window.
#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
fn main() {
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;

    let port: u16 = std::env::var("CYBERLOG_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|port| *port != 0)
        .unwrap_or(47660);
    let state = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("cyberlog");
    let profile = state.join("profile");
    let _ = std::fs::create_dir_all(&profile);

    if !cyberlog::ping(port) {
        let exe = std::env::current_exe().ok();
        let server = exe
            .as_ref()
            .and_then(|exe| exe.parent())
            .map(|dir| dir.join("cyberlog.exe"))
            .unwrap_or_else(|| PathBuf::from("cyberlog.exe"));
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(state.join("server.log"));
        let (out, err) = match log.and_then(|file| Ok((file.try_clone()?, file))) {
            Ok((a, b)) => (Stdio::from(a), Stdio::from(b)),
            Err(_) => (Stdio::null(), Stdio::null()),
        };
        let _ = Command::new(server)
            .args(["--port", &port.to_string()])
            .stdin(Stdio::null())
            .stdout(out)
            .stderr(err)
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn();
        for _ in 0..50 {
            if cyberlog::ping(port) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    let url = format!("http://127.0.0.1:{port}/");
    let mut candidates = Vec::new();
    for (var, rel) in [
        ("ProgramFiles(x86)", r"Microsoft\Edge\Application\msedge.exe"),
        ("ProgramFiles", r"Microsoft\Edge\Application\msedge.exe"),
        ("ProgramFiles", r"Google\Chrome\Application\chrome.exe"),
        ("ProgramFiles(x86)", r"Google\Chrome\Application\chrome.exe"),
        ("LOCALAPPDATA", r"Google\Chrome\Application\chrome.exe"),
    ] {
        if let Some(base) = std::env::var_os(var) {
            candidates.push(PathBuf::from(base).join(rel));
        }
    }
    if let Some(browser) = candidates.into_iter().find(|path| path.is_file()) {
        let launched = Command::new(browser)
            .arg(format!("--app={url}"))
            .arg(format!("--user-data-dir={}", profile.display()))
            .args(["--no-first-run", "--no-default-browser-check"])
            .spawn();
        if launched.is_ok() {
            return;
        }
    }
    let _ = Command::new("cmd")
        .args(["/c", "start", "", &url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("cyberlog-launcher is for Windows. Use bin/cyberlog on Linux.");
    std::process::exit(1);
}
