//! Loopback server for the Cyberlog journal.
//!
//! The journal client in `web/` is the same field-journal UI as the Python
//! edition. This crate replaces `server.py`: it binds to 127.0.0.1, serves
//! those files with `Cache-Control: no-store`, and answers `/api/health`.

mod server;

pub use server::{locate_web, ping, serve, spawn};
