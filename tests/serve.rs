use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

fn port() -> u16 {
    static PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
    *PORT.get_or_init(|| {
        let web = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web");
        cyberlog::spawn(&web).expect("server")
    })
}

struct Reply {
    status: u16,
    reason: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

fn exchange(method: &str, target: &str, extra: &str) -> Reply {
    let port = port();
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = None;
    for _ in 0..50 {
        if let Ok(connected) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) {
            stream = Some(connected);
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    let mut stream = stream.expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let request = format!(
        "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n{extra}\r\n"
    );
    stream.write_all(request.as_bytes()).unwrap();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                break;
            }
            Err(error) => panic!("{error}"),
        }
    }
    let split = buf
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("headers");
    let head = std::str::from_utf8(&buf[..split]).unwrap();
    let body = buf[split + 4..].to_vec();
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap();
    let mut parts = status_line.splitn(3, ' ');
    let _version = parts.next().unwrap();
    let status: u16 = parts.next().unwrap().parse().unwrap();
    let reason = parts.next().unwrap_or("").to_string();
    let headers = lines
        .filter(|line| !line.is_empty())
        .map(|line| {
            let (name, value) = line.split_once(':').unwrap();
            (name.trim().to_ascii_lowercase(), value.trim().to_string())
        })
        .collect();
    Reply {
        status,
        reason,
        headers,
        body,
    }
}

fn header<'a>(reply: &'a Reply, name: &str) -> &'a str {
    reply
        .headers
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
        .unwrap_or("")
}

#[test]
fn health_is_the_cyberlog_body() {
    let reply = exchange("GET", "/api/health", "");
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, br#"{"ok":true,"app":"cyberlog"}"#);
    assert_eq!(header(&reply, "content-type"), "application/json");
    assert_eq!(header(&reply, "cache-control"), "no-store");
    assert_eq!(header(&reply, "x-content-type-options"), "nosniff");
    assert!(cyberlog::ping(port()));
}

#[test]
fn static_client_matches_the_files_on_disk() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web");
    for (url, file, mime) in [
        ("/", "index.html", "text/html"),
        ("/index.html?cache=0", "index.html", "text/html"),
        ("/styles.css", "styles.css", "text/css"),
        ("/js/app.js", "js/app.js", "application/javascript"),
        ("/js/format.js", "js/format.js", "application/javascript"),
        ("/favicon.svg", "favicon.svg", "image/svg+xml"),
        (
            "/fonts/orbitron-500.woff2",
            "fonts/orbitron-500.woff2",
            "font/woff2",
        ),
    ] {
        let reply = exchange("GET", url, "");
        let disk = std::fs::read(root.join(file)).unwrap();
        assert_eq!(reply.status, 200, "{url}");
        assert_eq!(reply.body, disk, "{url}");
        assert_eq!(header(&reply, "content-type"), mime, "{url}");
        assert_eq!(header(&reply, "cache-control"), "no-store", "{url}");
        assert_eq!(header(&reply, "x-content-type-options"), "nosniff", "{url}");
        assert_eq!(
            header(&reply, "content-length"),
            disk.len().to_string(),
            "{url}"
        );
    }
}

#[test]
fn favicon_ico_is_the_svg() {
    let reply = exchange("GET", "/favicon.ico", "");
    let svg =
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web/favicon.svg")).unwrap();
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, svg);
    assert_eq!(header(&reply, "content-type"), "image/svg+xml");
}

#[test]
fn head_omits_the_body_and_health_is_get_only() {
    let reply = exchange("HEAD", "/", "");
    assert_eq!(reply.status, 200);
    assert!(reply.body.is_empty());
    let index =
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web/index.html")).unwrap();
    assert_eq!(header(&reply, "content-length"), index.len().to_string());

    let health = exchange("HEAD", "/api/health", "");
    assert_eq!(health.status, 404);
    assert_eq!(health.reason, "File not found");
}

#[test]
fn missing_post_and_traversal_do_not_leave_the_client_tree() {
    let missing = exchange("GET", "/nope", "");
    assert_eq!(missing.status, 404);
    assert_eq!(missing.reason, "File not found");
    assert_eq!(header(&missing, "content-length"), "460");
    assert!(missing
        .body
        .windows(15)
        .any(|window| window == b"File not found."));

    let post = exchange("POST", "/", "");
    assert_eq!(post.status, 501);
    assert_eq!(post.reason, "Unsupported method ('POST')");
    assert_eq!(header(&post, "content-length"), "482");

    let escaped = exchange("GET", "/js/../../Cargo.toml", "");
    assert_eq!(escaped.status, 404);
    assert!(!escaped.body.windows(9).any(|window| window == b"[package]"));

    let encoded = exchange("GET", "/js/%2e%2e/%2e%2e/Cargo.toml", "");
    assert_eq!(encoded.status, 404);
}

#[test]
fn directory_without_a_slash_redirects() {
    let reply = exchange("GET", "/js", "");
    assert_eq!(reply.status, 301);
    assert_eq!(reply.reason, "Moved Permanently");
    assert_eq!(header(&reply, "location"), "/js/");
    assert!(reply.body.is_empty());

    let with_query = exchange("GET", "/fonts?x=1", "");
    assert_eq!(with_query.status, 301);
    assert_eq!(header(&with_query, "location"), "/fonts/?x=1");

    let listing = exchange("GET", "/js/", "");
    assert_eq!(listing.status, 200);
    let text = String::from_utf8(listing.body).unwrap();
    assert!(text.contains("app.js"));
    assert!(text.contains("format.js"));
}

#[test]
fn if_modified_since_matches_python() {
    let fresh = exchange(
        "GET",
        "/styles.css",
        "If-Modified-Since: Tue, 14 Nov 2023 22:13:20 GMT\r\n",
    );
    assert_eq!(fresh.status, 200);
    let future = exchange(
        "GET",
        "/styles.css",
        "If-Modified-Since: Fri, 01 Jan 2100 00:00:00 GMT\r\n",
    );
    assert_eq!(future.status, 304);
    assert!(future.body.is_empty());
    assert_eq!(header(&future, "cache-control"), "no-store");
    let tagged = exchange(
        "GET",
        "/styles.css",
        "If-Modified-Since: Fri, 01 Jan 2100 00:00:00 GMT\r\nIf-None-Match: \"x\"\r\n",
    );
    assert_eq!(tagged.status, 200);
}
