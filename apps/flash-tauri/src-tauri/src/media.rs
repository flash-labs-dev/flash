//! Clips for <video> and <img> over HTTP on 127.0.0.1.
//!
//! WebKitGTK's media player sends a custom-scheme URL one probe request and
//! then stalls, so a custom protocol cannot play video. Its HTTP source
//! streams and seeks properly. The server listens on loopback only, every URL
//! carries a random per-launch token, and only media inside the clips folder
//! is served.
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;

/// Starts the server; returns the base URL the UI prefixes clip paths with.
pub fn start(root: impl Fn() -> String + Send + Sync + 'static) -> std::io::Result<String> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let mut token = [0u8; 16];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut token)?;
    let token: String = token.iter().map(|b| format!("{b:02x}")).collect();
    let base = format!("http://127.0.0.1:{}/{token}", listener.local_addr()?.port());
    let root = Arc::new(root);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (root, token) = (root.clone(), token.clone());
            std::thread::spawn(move || { handle(stream, &token, &*root).ok(); });
        }
    });
    Ok(base)
}

fn handle(mut stream: TcpStream, token: &str, root: &dyn Fn() -> String) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut range = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header == "\r\n" || header == "\n" { break }
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("range") { range = Some(value.trim().to_owned()) }
        }
    }
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    let reply = |stream: &mut TcpStream, status: &str| write!(stream, "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");

    let Some(path) = target.strip_prefix('/').and_then(|t| t.strip_prefix(token)).filter(|p| p.starts_with('/')) else { return reply(&mut stream, "403 Forbidden") };
    let path = crate::decode(path);
    let file = Path::new(&path);
    let kind = match file.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("mp4") => "video/mp4", Some("png") => "image/png", _ => return reply(&mut stream, "404 Not Found"),
    };
    if !matches!(method, "GET" | "HEAD") { return reply(&mut stream, "405 Method Not Allowed") }
    if !crate::library::is_inside(&root(), file) { return reply(&mut stream, "403 Forbidden") }
    let Ok(mut f) = std::fs::File::open(file) else { return reply(&mut stream, "404 Not Found") };
    let size = f.metadata()?.len();

    let (status, start, end) = match range.as_deref().and_then(|r| r.strip_prefix("bytes=")).and_then(|r| r.split(',').next()).and_then(|r| r.split_once('-')) {
        None => ("200 OK", 0, size.saturating_sub(1)),
        Some((s, e)) => {
            let (start, end) = match (s.trim().parse::<u64>().ok(), e.trim().parse::<u64>().ok()) {
                (Some(s), Some(e)) => (s, e.min(size.saturating_sub(1))),
                (Some(s), None) => (s, size.saturating_sub(1)),
                (None, Some(n)) => (size.saturating_sub(n), size.saturating_sub(1)),
                (None, None) => (1, 0),
            };
            if size == 0 || start > end || start >= size {
                return write!(stream, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{size}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
            ("206 Partial Content", start, end)
        }
    };
    let length = if size == 0 { 0 } else { end - start + 1 };
    let mut head = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\n\
        Access-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: content-range\r\nCache-Control: no-cache\r\nConnection: close\r\n");
    if status.starts_with("206") { head += &format!("Content-Range: bytes {start}-{end}/{size}\r\n") }
    stream.write_all(format!("{head}\r\n").as_bytes())?;
    if method == "HEAD" || length == 0 { return Ok(()) }
    f.seek(SeekFrom::Start(start))?;
    // A closed connection (the player seeking elsewhere) just ends the copy.
    std::io::copy(&mut f.take(length), &mut stream).map(|_| ())
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};

    fn get(base: &str, path: &str, range: Option<&str>) -> String {
        let url = base.strip_prefix("http://").unwrap();
        let (host, token) = url.split_once('/').unwrap();
        let mut stream = std::net::TcpStream::connect(host).unwrap();
        let range = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
        write!(stream, "GET /{token}{} HTTP/1.1\r\nHost: x\r\n{range}\r\n", crate::encode(path)).unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn serves_ranges_inside_the_library_only() {
        let root = std::env::temp_dir().join(format!("flash-media-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let clip = root.join("a b.mp4");
        std::fs::write(&clip, b"0123456789").unwrap();
        let r = root.to_string_lossy().into_owned();
        let base = super::start(move || r.clone()).unwrap();
        let clip = clip.to_string_lossy().into_owned();

        let full = get(&base, &clip, None);
        assert!(full.starts_with("HTTP/1.1 200") && full.ends_with("0123456789"));
        let part = get(&base, &clip, Some("bytes=2-4"));
        assert!(part.starts_with("HTTP/1.1 206") && part.contains("Content-Range: bytes 2-4/10") && part.ends_with("234"));
        assert!(get(&base, "/etc/passwd.mp4", None).starts_with("HTTP/1.1 403"));
        let wrong_token = base.rsplit_once('/').unwrap().0.to_owned() + "/nope";
        assert!(get(&wrong_token, &clip, None).starts_with("HTTP/1.1 403"));
        std::fs::remove_dir_all(root).ok();
    }
}
