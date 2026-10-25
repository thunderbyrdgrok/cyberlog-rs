# Project Memory — cyberlog-rs

## AI Mind Reference

- Active projects: @~/.commandcode/ai-mind/projects.md
- Skills & tools: @~/.commandcode/ai-mind/skills-tools.md
- Progress log: @~/.commandcode/ai-mind/progress.md
- Failed attempts: @~/.commandcode/ai-mind/failed-attempts.md

## Project Overview

cyberlog-rs is the Rust reimplementation of the Cyberlog server — a zero-dependency
local HTTP server that replaces `server.py`.

- **Server** (`src/server.rs`): manual HTTP/1.0 server over raw TCP (`TcpListener`/`TcpStream`)
  - Implements: GET/HEAD serving, `/api/health`, directory listing, 304 Not Modified,
    directory traversal prevention, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`
- **CLI entry** (`src/main.rs`): `--port`, `--web`, `--ping`, `--help` flags
- **Public API** (`src/lib.rs`): `serve()`, `spawn()`, `ping()`, `locate_web()`
- **Launcher** (`bin/cyberlog`): auto-builds with `cargo build --release` when binary is stale,
  then starts the server and opens Chromium
- **Frontend** (`web/`): shared with the Python cyberlog — identical UI

## Key Architecture Notes

- Default port: `47660` (override with `CYBERLOG_PORT` env var)
- Binary path: `target/release/cyberlog`
- The launcher rebuilds when `Cargo.toml`, `Cargo.lock`, or source files are newer than the binary
- `--ping` mode exits 0 if `/api/health` is already answering, exits 1 otherwise
- `locate_web()` walks up from the binary directory (up to 6 levels) to find `web/index.html`
- Shares the same `web/` frontend as the Python version at `~/Work/cyberlog/`
- Unit tests are in `src/server.rs` (`# [cfg(test)]` module); integration tests in `tests/serve.rs`
