use std::fs;
use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const HEALTH: &[u8] = br#"{"ok":true,"app":"cyberlog"}"#;
const SERVER: &str = "Cyberlog/1.0";

/// Bind to loopback and serve `web` until the process exits.
pub fn serve(port: u16, web: &Path) -> io::Result<()> {
    let web = prepare_web(web)?;
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))?;
    serve_listener(listener, web)
}

/// Bind an ephemeral loopback port and serve `web` on a background thread.
pub fn spawn(web: &Path) -> io::Result<u16> {
    let web = prepare_web(web)?;
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))?;
    let port = listener.local_addr()?.port();
    thread::Builder::new()
        .name("cyberlog".into())
        .spawn(move || {
            let _ = serve_listener(listener, web);
        })?;
    Ok(port)
}

/// Exit condition for the launcher: `/api/health` returned the Cyberlog body.
pub fn ping(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_secs(1)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let request =
        format!("GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    let mut chunk = [0u8; 512];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > 8192 {
                    break;
                }
            }
            Err(error)
                if error.kind() == io::ErrorKind::WouldBlock
                    || error.kind() == io::ErrorKind::TimedOut =>
            {
                break;
            }
            Err(_) => return false,
        }
    }
    let Ok(text) = std::str::from_utf8(&buf) else {
        return false;
    };
    let Some((head, body)) = text.split_once("\r\n\r\n") else {
        return false;
    };
    head.starts_with("HTTP/1.") && head.contains(" 200 ") && body.as_bytes() == HEALTH
}

/// Walk up from the running binary to a directory that contains `web/index.html`.
pub fn locate_web() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?.to_path_buf();
    for _ in 0..6 {
        let index = dir.join("web/index.html");
        if index.is_file() {
            return Some(dir.join("web"));
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn prepare_web(web: &Path) -> io::Result<PathBuf> {
    let web = web.canonicalize()?;
    if !web.join("index.html").is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("index.html is missing in {}", web.display()),
        ));
    }
    Ok(web)
}

fn serve_listener(listener: TcpListener, web: PathBuf) -> io::Result<()> {
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                let web = web.clone();
                let _ = thread::Builder::new()
                    .name("cyberlog-conn".into())
                    .spawn(move || {
                        let _ = handle(stream, &web);
                    });
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn handle(mut stream: TcpStream, web: &Path) -> io::Result<()> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(8)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(8)));
    let request = match read_request(&mut stream) {
        Ok(Some(request)) => request,
        Ok(None) => return Ok(()),
        Err(error) => {
            let response = error_response(400, &error, explain(400), false);
            return write_response(&mut stream, &response);
        }
    };
    let response = route(&request, web);
    write_response(&mut stream, &response)
}

struct Request {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
}

struct Response {
    status: u16,
    reason: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

fn route(request: &Request, web: &Path) -> Response {
    let head = request.method == "HEAD";
    let target = collapse_double_slash(&request.target);
    let (path, _) = split_query(&target);
    // The Python handler only special-cases these inside do_GET.
    if request.method == "GET" && path == "/api/health" {
        return health_response();
    }
    if request.method != "GET" && request.method != "HEAD" {
        let message = format!("Unsupported method ('{}')", request.method);
        return error_response(501, &message, explain(501), head);
    }
    let target = if request.method == "GET" && path == "/favicon.ico" {
        "/favicon.svg".to_string()
    } else {
        target
    };
    serve_path(&target, web, head, &request.headers)
}

fn health_response() -> Response {
    Response {
        status: 200,
        reason: "OK".into(),
        headers: vec![
            ("Content-Type".into(), "application/json".into()),
            ("Content-Length".into(), HEALTH.len().to_string()),
            ("Cache-Control".into(), "no-store".into()),
            ("X-Content-Type-Options".into(), "nosniff".into()),
        ],
        body: HEALTH.to_vec(),
    }
}

fn serve_path(target: &str, web: &Path, head: bool, headers: &[(String, String)]) -> Response {
    let (raw_path, query) = split_query(target);
    let raw_path = raw_path.split('#').next().unwrap_or(raw_path);
    let Some(decoded) = percent_decode(raw_path) else {
        return error_response(400, "Bad request syntax", explain(400), head);
    };
    let trailing =
        raw_path.ends_with('/') || raw_path.ends_with("%2f") || raw_path.ends_with("%2F");
    let parts = normalize_segments(&decoded);
    let mut full = web.to_path_buf();
    for segment in &parts {
        full.push(segment);
    }

    if full.is_dir() {
        if !inside(web, &full) {
            return error_response(404, "File not found", explain(404), head);
        }
        if !trailing {
            let location = if query.is_empty() {
                format!("{raw_path}/")
            } else {
                format!("{raw_path}/?{query}")
            };
            return Response {
                status: 301,
                reason: "Moved Permanently".into(),
                headers: vec![
                    ("Location".into(), location),
                    ("Content-Length".into(), "0".into()),
                    ("Cache-Control".into(), "no-store".into()),
                    ("X-Content-Type-Options".into(), "nosniff".into()),
                ],
                body: Vec::new(),
            };
        }
        if let Some(index) = ["index.html", "index.htm"]
            .into_iter()
            .map(|name| full.join(name))
            .find(|path| path.is_file())
        {
            return serve_file(&index, web, head, headers);
        }
        return list_directory(&full, raw_path, head);
    }

    if trailing || !full.is_file() || !inside(web, &full) {
        return error_response(404, "File not found", explain(404), head);
    }
    serve_file(&full, web, head, headers)
}

fn serve_file(path: &Path, web: &Path, head: bool, headers: &[(String, String)]) -> Response {
    if !inside(web, path) {
        return error_response(404, "File not found", explain(404), head);
    }
    let Ok(bytes) = fs::read(path) else {
        return error_response(404, "File not found", explain(404), head);
    };
    let modified = fs::metadata(path).and_then(|meta| meta.modified()).ok();
    if let Some(modified) = modified {
        if header(headers, "if-none-match").is_none() {
            if let Some(since) = header(headers, "if-modified-since").and_then(parse_http_date) {
                if let Ok(age) = modified.duration_since(UNIX_EPOCH) {
                    if (age.as_secs() as i64) <= since {
                        return Response {
                            status: 304,
                            reason: "Not Modified".into(),
                            headers: vec![
                                ("Cache-Control".into(), "no-store".into()),
                                ("X-Content-Type-Options".into(), "nosniff".into()),
                            ],
                            body: Vec::new(),
                        };
                    }
                }
            }
        }
    }
    let mut file_headers = vec![
        ("Content-type".into(), content_type(path).into()),
        ("Content-Length".into(), bytes.len().to_string()),
    ];
    if let Some(modified) = modified {
        file_headers.push(("Last-Modified".into(), http_date(modified)));
    }
    file_headers.push(("Cache-Control".into(), "no-store".into()));
    file_headers.push(("X-Content-Type-Options".into(), "nosniff".into()));
    Response {
        status: 200,
        reason: "OK".into(),
        headers: file_headers,
        body: if head { Vec::new() } else { bytes },
    }
}

fn list_directory(dir: &Path, display_path: &str, head: bool) -> Response {
    let mut names = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => {
            return error_response(404, "No permission to list directory", explain(404), head);
        }
    };
    for entry in entries.flatten() {
        names.push(entry.file_name());
    }
    names.sort_by(|left, right| {
        left.to_string_lossy()
            .to_lowercase()
            .cmp(&right.to_string_lossy().to_lowercase())
    });
    let display =
        html_escape(&percent_decode(display_path).unwrap_or_else(|| display_path.to_string()));
    let mut lines = vec![
        "<!DOCTYPE HTML>".to_string(),
        "<html lang=\"en\">".to_string(),
        "<head>".to_string(),
        "<meta charset=\"utf-8\">".to_string(),
        "<style type=\"text/css\">\n:root {\ncolor-scheme: light dark;\n}\n</style>".to_string(),
        format!("<title>Directory listing for {display}</title>\n</head>"),
        format!("<body>\n<h1>Directory listing for {display}</h1>"),
        "<hr>\n<ul>".to_string(),
    ];
    for name in names {
        let name = name.to_string_lossy();
        let child = dir.join(name.as_ref());
        let mut link = name.to_string();
        let mut label = name.to_string();
        if child.is_dir() {
            link.push('/');
            label.push('/');
        }
        if child
            .symlink_metadata()
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(false)
        {
            label = format!("{name}@");
        }
        lines.push(format!(
            "<li><a href=\"{}\">{}</a></li>",
            url_encode(&link),
            html_escape(&label)
        ));
    }
    lines.push("</ul>\n<hr>\n</body>\n</html>\n".to_string());
    let body = lines.join("\n").into_bytes();
    let len = body.len();
    Response {
        status: 200,
        reason: "OK".into(),
        headers: vec![
            ("Content-type".into(), "text/html; charset=utf-8".into()),
            ("Content-Length".into(), len.to_string()),
            ("Cache-Control".into(), "no-store".into()),
            ("X-Content-Type-Options".into(), "nosniff".into()),
        ],
        body: if head { Vec::new() } else { body },
    }
}

fn error_response(status: u16, message: &str, explain: &str, head: bool) -> Response {
    let html = error_html(status, message, explain);
    let len = html.len();
    Response {
        status,
        reason: message.to_string(),
        headers: vec![
            ("Connection".into(), "close".into()),
            ("Content-Type".into(), "text/html;charset=utf-8".into()),
            ("Content-Length".into(), len.to_string()),
            ("Cache-Control".into(), "no-store".into()),
            ("X-Content-Type-Options".into(), "nosniff".into()),
        ],
        body: if head { Vec::new() } else { html },
    }
}

fn explain(status: u16) -> &'static str {
    match status {
        400 => "Bad request syntax or unsupported method",
        404 => "Nothing matches the given URI",
        501 => "Server does not support this operation",
        _ => "???",
    }
}

fn error_html(code: u16, message: &str, explain: &str) -> Vec<u8> {
    let message = html_escape(message);
    let explain = html_escape(explain);
    format!(
        "\
<!DOCTYPE HTML>
<html lang=\"en\">
    <head>
        <meta charset=\"utf-8\">
        <style type=\"text/css\">
            :root {{
                color-scheme: light dark;
            }}
        </style>
        <title>Error response</title>
    </head>
    <body>
        <h1>Error response</h1>
        <p>Error code: {code}</p>
        <p>Message: {message}.</p>
        <p>Error code explanation: {code} - {explain}.</p>
    </body>
</html>
"
    )
    .into_bytes()
}

fn write_response(stream: &mut TcpStream, response: &Response) -> io::Result<()> {
    let mut out = format!(
        "HTTP/1.0 {} {}\r\nServer: {SERVER}\r\nDate: {}\r\n",
        response.status,
        response.reason,
        http_date(SystemTime::now())
    );
    for (name, value) in &response.headers {
        if value.bytes().any(|byte| byte == b'\r' || byte == b'\n') {
            continue;
        }
        out.push_str(name);
        out.push_str(": ");
        out.push_str(value);
        out.push_str("\r\n");
    }
    out.push_str("\r\n");
    stream.write_all(out.as_bytes())?;
    if !response.body.is_empty() {
        stream.write_all(&response.body)?;
    }
    stream.flush()
}

fn read_request(stream: &mut TcpStream) -> Result<Option<Request>, String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 512];
    loop {
        if buf.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 16 * 1024 {
            return Err("Request header fields too large".into());
        }
        match stream.read(&mut chunk) {
            Ok(0) => {
                if buf.is_empty() {
                    return Ok(None);
                }
                return Err("Bad request syntax".into());
            }
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(error)
                if error.kind() == io::ErrorKind::WouldBlock
                    || error.kind() == io::ErrorKind::TimedOut =>
            {
                return if buf.is_empty() {
                    Ok(None)
                } else {
                    Err("Bad request syntax".into())
                };
            }
            Err(_) => return Ok(None),
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let Some((head, _)) = text.split_once("\r\n\r\n") else {
        return Err("Bad request syntax".into());
    };
    let mut lines = head.split("\r\n");
    let Some(request_line) = lines.next() else {
        return Err("Bad request syntax".into());
    };
    if request_line.len() > 65536 {
        return Err("Request URI too long".into());
    }
    let words: Vec<&str> = request_line.split_whitespace().collect();
    if words.len() < 2 || words.len() > 3 {
        return Err("Bad request syntax".into());
    }
    let method = words[0];
    if !is_method_token(method) {
        return Err("Bad request syntax".into());
    }
    if words.len() == 3 {
        let version = words[2];
        let Some(number) = version.strip_prefix("HTTP/") else {
            return Err(format!("Bad request version ({version:?})"));
        };
        let mut parts = number.split('.');
        let (Some(major), Some(minor), None) = (parts.next(), parts.next(), parts.next()) else {
            return Err(format!("Bad request version ({version:?})"));
        };
        if major.parse::<u64>().is_err() || minor.parse::<u64>().is_err() {
            return Err(format!("Bad request version ({version:?})"));
        }
        if major != "1" || (minor != "0" && minor != "1") {
            return Err(format!("Bad request version ({version:?})"));
        }
    } else if method != "GET" {
        return Err(format!("Bad HTTP/0.9 request type ({method:?})"));
    }
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err("Bad request syntax".into());
        };
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
    Ok(Some(Request {
        method: method.to_string(),
        target: words[1].to_string(),
        headers,
    }))
}

fn is_method_token(method: &str) -> bool {
    !method.is_empty()
        && method.len() <= 32
        && method.bytes().all(|byte| {
            matches!(
                byte,
                b'!' | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'.'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'|'
                    | b'~'
                    | b'0'..=b'9'
                    | b'A'..=b'Z'
                    | b'a'..=b'z'
            )
        })
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

fn split_query(target: &str) -> (&str, &str) {
    target.split_once('?').unwrap_or((target, ""))
}

fn collapse_double_slash(target: &str) -> String {
    if target.starts_with("//") {
        format!("/{}", target.trim_start_matches('/'))
    } else {
        target.to_string()
    }
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let high = from_hex(bytes[index + 1])?;
            let low = from_hex(bytes[index + 2])?;
            out.push((high << 4) | low);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn normalize_segments(decoded: &str) -> Vec<String> {
    let mut parts = Vec::new();
    for segment in decoded.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            parts.pop();
            continue;
        }
        if segment.contains('\0') {
            continue;
        }
        parts.push(segment.to_string());
    }
    parts
}

fn inside(root: &Path, path: &Path) -> bool {
    path.canonicalize()
        .map(|canon| canon.starts_with(root))
        .unwrap_or(false)
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("html" | "htm") => "text/html",
        Some("css") => "text/css",
        Some("js" | "mjs") => "application/javascript",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    }
}

fn html_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

fn url_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn http_date(time: SystemTime) -> String {
    match time.duration_since(UNIX_EPOCH) {
        Ok(age) => http_date_from_unix(age.as_secs() as i64),
        Err(error) => http_date_from_unix(-(error.duration().as_secs() as i64)),
    }
}

fn http_date_from_unix(secs: i64) -> String {
    const WEEKDAY: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
    const MONTH: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let days = secs.div_euclid(86400);
    let tod = secs.rem_euclid(86400) as u32;
    let hour = tod / 3600;
    let minute = (tod % 3600) / 60;
    let second = tod % 60;
    let (year, month, day) = civil_from_days(days);
    let weekday = WEEKDAY[days.rem_euclid(7) as usize];
    format!(
        "{weekday}, {day:02} {} {year:04} {hour:02}:{minute:02}:{second:02} GMT",
        MONTH[(month - 1) as usize]
    )
}

fn parse_http_date(value: &str) -> Option<i64> {
    let value = value.trim();
    let (weekday, rest) = value.split_once(", ")?;
    if weekday.len() != 3 {
        return None;
    }
    let mut parts = rest.split(' ');
    let day: u32 = parts.next()?.parse().ok()?;
    let month = month_index(parts.next()?)?;
    let year: i32 = parts.next()?.parse().ok()?;
    let clock = parts.next()?;
    let zone = parts.next()?;
    if parts.next().is_some() || zone != "GMT" {
        return None;
    }
    let mut hms = clock.split(':');
    let hour: u32 = hms.next()?.parse().ok()?;
    let minute: u32 = hms.next()?.parse().ok()?;
    let second: u32 = hms.next()?.parse().ok()?;
    if hms.next().is_some() || day == 0 || day > 31 || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some(days * 86400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64)
}

fn month_index(name: &str) -> Option<u32> {
    match name {
        "Jan" => Some(1),
        "Feb" => Some(2),
        "Mar" => Some(3),
        "Apr" => Some(4),
        "May" => Some(5),
        "Jun" => Some(6),
        "Jul" => Some(7),
        "Aug" => Some(8),
        "Sep" => Some(9),
        "Oct" => Some(10),
        "Nov" => Some(11),
        "Dec" => Some(12),
        _ => None,
    }
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month as u32, day as u32)
}

fn days_from_civil(mut year: i32, month: u32, day: u32) -> i64 {
    year -= if month <= 2 { 1 } else { 0 };
    let year = year as i64;
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = (year - era * 400) as u64;
    let month_prime = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * month_prime as u64 + 2) / 5 + day as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_dates_match_the_wire_format() {
        assert_eq!(http_date_from_unix(0), "Thu, 01 Jan 1970 00:00:00 GMT");
        assert_eq!(http_date_from_unix(1), "Thu, 01 Jan 1970 00:00:01 GMT");
        assert_eq!(http_date_from_unix(86400), "Fri, 02 Jan 1970 00:00:00 GMT");
        assert_eq!(
            http_date_from_unix(1700000000),
            "Tue, 14 Nov 2023 22:13:20 GMT"
        );
        assert_eq!(
            http_date_from_unix(1791846653),
            "Mon, 12 Oct 2026 23:10:53 GMT"
        );
    }

    #[test]
    fn http_dates_round_trip() {
        for stamp in [0, 1, 86400, 1700000000, 1791846653] {
            let text = http_date_from_unix(stamp);
            assert_eq!(parse_http_date(&text), Some(stamp));
        }
    }

    #[test]
    fn path_segments_stay_inside_the_root() {
        assert_eq!(normalize_segments("/js/app.js"), vec!["js", "app.js"]);
        assert_eq!(
            normalize_segments("/js/../../etc/passwd"),
            vec!["etc", "passwd"]
        );
        assert_eq!(normalize_segments("/"), Vec::<String>::new());
        assert_eq!(normalize_segments("/js/../styles.css"), vec!["styles.css"]);
    }

    #[test]
    fn error_pages_match_python_lengths() {
        let missing = error_html(404, "File not found", "Nothing matches the given URI");
        assert_eq!(missing.len(), 460, "{}", String::from_utf8_lossy(&missing));
        let method = error_html(
            501,
            "Unsupported method ('POST')",
            "Server does not support this operation",
        );
        assert_eq!(method.len(), 482, "{}", String::from_utf8_lossy(&method));
    }
}
