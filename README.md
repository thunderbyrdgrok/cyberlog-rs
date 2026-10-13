# Cyberlog

A futuristic local field journal for text and video logs. Cyberlog is a small Rust server that serves the journal's web client on `127.0.0.1`. Your entries stay in your browser's local storage (IndexedDB) and never leave your machine.

<p align="center"><img src="assets/icon-256.png" width="128" alt="Cyberlog icon"></p>

## Features

- Text journal entries and recorded video logs
- Optional GPS, weather, and elevation stamps (weather data from [Open-Meteo](https://open-meteo.com)) when location access is allowed
- Runs fully local on a loopback-only server, with no account and no cloud
- Opens in its own app window through Chromium-based browsers

## Requirements

- Rust (`cargo`)
- A Chromium-based browser for the app window (Chromium, Chrome, Edge, Brave, or Vivaldi). Without one, it falls back to your default browser.

## Getting started

```bash
git clone https://github.com/thunderbyrdgrok/cyberlog-rs
cd cyberlog-rs
./bin/cyberlog
```

The launcher builds the release binary on the first run (or whenever the sources change), starts the server in the background, and opens Cyberlog in its own window.

To run the server directly:

```bash
cargo run --release -- [--port PORT] [--web DIR] [--ping]
```

- `--port` sets the port. The default is `47660`, and the launcher also reads `CYBERLOG_PORT`.
- `--web` points to the web client folder (`web/` by default).
- `--ping` exits with 0 if a server is already answering `/api/health`.

Server logs and the app's browser profile live in `~/.local/state/cyberlog`.

## Windows

1. Download `Cyberlog-Setup-vX.Y.Z.exe` from [Releases](https://github.com/thunderbyrdgrok/cyberlog-rs/releases).
2. Run it. That's it: Cyberlog is installed in `Program Files\Cyberlog` with a Start menu shortcut and an optional desktop shortcut, and it shows up in Apps & Features to uninstall.

The shortcut starts the local server in the background (no console window) and opens Cyberlog as an app window in Edge or Chrome, or in your default browser. Your entries live in the browser profile at `%LOCALAPPDATA%\cyberlog\profile`, which updates and uninstalls leave alone.

The installer is unsigned, so Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.

### Portable (USB stick)

Prefer no install, or want Cyberlog to travel on a USB stick? Download `cyberlog-vX.Y.Z-windows-x64.zip`, unzip it onto the drive, and double-click **`Start Cyberlog.exe`**.

The zip ships with a `portable.txt` marker. When `portable.txt` or a `data` folder sits next to the launcher, Cyberlog runs in portable mode:

- Journal entries (the browser profile) live in `data\profile` and the server log in `data\server.log`, both next to the launcher, so they move with the drive.
- The default port is `47661`, so a portable copy never shares a server or data with an installed copy on `47660`. Keep the port the same between runs (`CYBERLOG_PORT` overrides it): the browser keys stored entries by address, port included.
- When you close the Cyberlog window, the launcher stops the server it started, so you can eject the drive. If the server was already running (for example, you opened a second window), it is left alone; close all Cyberlog windows and quit `cyberlog.exe` in Task Manager if it lingers. `cyberlog.bat` also uses portable mode but does not stop its server.

FAT32 and exFAT drives work, but browser profiles write many small files, so a slow stick makes Cyberlog sluggish and wears the drive. Always close Cyberlog and use **Safely Remove Hardware** before unplugging, or recent entries may be lost.

To build from source, install Rust with [rustup](https://rustup.rs), then:

```bat
git clone https://github.com/thunderbyrdgrok/cyberlog-rs
cd cyberlog-rs
cargo run --release
```

Or double-click `bin\cyberlog.bat` in the clone; it builds the release binary on the first run. The launcher honors `CYBERLOG_PORT`, and keeps its log and browser profile in `%LOCALAPPDATA%\cyberlog`.

## Desktop entry

`cyberlog.desktop` adds Cyberlog to your app launcher. Edit its `Exec` and `Icon` paths to match where you cloned the repo, then copy it to `~/.local/share/applications/`.

## Tests

```bash
cargo test                       # server tests
node --test test/format.test.mjs # client formatting tests
```
