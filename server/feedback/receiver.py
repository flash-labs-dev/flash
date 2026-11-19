#!/usr/bin/env python3
"""Flash home-server receiver. Stdlib only.

POST /flash-feedback  JSON {"message": str, "version": str, "os": str}
  Each accepted message is written as one markdown file in INBOX_DIR.
  Guards: 4 KB body cap, 2000 char message cap, per-IP and global rate limits.

POST /flash-clips     raw MP4 body
  Stores the clip under a random id and answers 201 with
  {"id", "path", "expiresAt"}. Guards: size cap per clip, a cap on total
  storage, per-IP and global rate limits, and the body must start like an MP4.
GET|HEAD /c/<id>.mp4  serves the clip, with Range support so players can seek.
  A clip older than CLIP_TTL_SECONDS is deleted and answers 404.

Nothing from the client is trusted: fields are length-capped and stripped of
control characters, and file names are generated server-side.
"""
import json
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

INBOX_DIR = os.environ.get("INBOX_DIR", "/data/inbox")
CLIPS_DIR = os.environ.get("CLIPS_DIR", "/data/clips")
PORT = int(os.environ.get("PORT", "8796"))
MAX_BODY = 4096
MAX_MESSAGE = 2000
PER_IP_PER_HOUR = 5
GLOBAL_PER_HOUR = 100
PATH = "/flash-feedback"

CLIP_PATH = "/flash-clips"
MAX_CLIP_BYTES = int(os.environ.get("MAX_CLIP_BYTES", str(100 * 1024 * 1024)))
MAX_STORE_BYTES = int(os.environ.get("MAX_STORE_BYTES", str(20 * 1024 * 1024 * 1024)))
CLIP_TTL_SECONDS = int(os.environ.get("CLIP_TTL_SECONDS", str(7 * 24 * 3600)))
CLIP_PER_IP_PER_HOUR = int(os.environ.get("CLIP_PER_IP_PER_HOUR", "10"))
CLIP_GLOBAL_PER_HOUR = int(os.environ.get("CLIP_GLOBAL_PER_HOUR", "60"))
CLEANUP_EVERY_SECONDS = 600
MAX_INFLIGHT_UPLOADS = int(os.environ.get("MAX_INFLIGHT_UPLOADS", "4"))
UPLOAD_DEADLINE_SECONDS = int(os.environ.get("UPLOAD_DEADLINE_SECONDS", "600"))
uploads_slots = threading.BoundedSemaphore(MAX_INFLIGHT_UPLOADS)
# One upload at a time per client address.
active_ips = set()
active_lock = threading.Lock()
CLIP_NAME = re.compile(r"^[A-Za-z0-9_-]{12}\.mp4$")
CLIP_URL = re.compile(r"^/c/([A-Za-z0-9_-]{12}\.mp4)$")
CHUNK = 1024 * 1024

CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class RateLimiter:
    def __init__(self, per_ip, total):
        self.per_ip = per_ip
        self.total = total
        self.by_ip = defaultdict(deque)
        self.all = deque()
        self.lock = threading.Lock()

    def allow(self, ip):
        now = time.time()
        with self.lock:
            for q in (self.by_ip[ip], self.all):
                while q and now - q[0] > 3600:
                    q.popleft()
            # Forget addresses with no recent hits so the table cannot grow
            # without bound.
            for stale in [k for k, q in self.by_ip.items() if not q and k != ip]:
                del self.by_ip[stale]
            if len(self.by_ip[ip]) >= self.per_ip or len(self.all) >= self.total:
                return False
            self.by_ip[ip].append(now)
            self.all.append(now)
            return True


# Bytes promised to uploads still in flight, so two large uploads that start
# together cannot both pass a cap that only one of them fits under.
reserved = 0
reserved_lock = threading.Lock()


def reserve(length):
    global reserved
    with reserved_lock:
        if store_bytes() + reserved + length > MAX_STORE_BYTES:
            return False
        reserved += length
        return True


def release(length):
    global reserved
    with reserved_lock:
        reserved -= length


feedback_limit = RateLimiter(PER_IP_PER_HOUR, GLOBAL_PER_HOUR)
clip_limit = RateLimiter(CLIP_PER_IP_PER_HOUR, CLIP_GLOBAL_PER_HOUR)


def clean(value, limit):
    if not isinstance(value, str):
        return ""
    return CTRL.sub("", value).strip()[:limit]


def allowed(ip):
    return feedback_limit.allow(ip)


def clip_files():
    """(name, size, mtime) for every stored clip; temp uploads are skipped."""
    try:
        names = os.listdir(CLIPS_DIR)
    except FileNotFoundError:
        return []
    out = []
    for name in names:
        if not CLIP_NAME.match(name):
            continue
        try:
            st = os.stat(os.path.join(CLIPS_DIR, name))
        except OSError:
            continue
        out.append((name, st.st_size, st.st_mtime))
    return out


def store_bytes():
    total = 0
    try:
        names = os.listdir(CLIPS_DIR)
    except FileNotFoundError:
        return 0
    for name in names:
        try:
            total += os.stat(os.path.join(CLIPS_DIR, name)).st_size
        except OSError:
            pass
    return total


def cleanup(now=None):
    """Delete expired clips and abandoned partial uploads."""
    now = time.time() if now is None else now
    try:
        names = os.listdir(CLIPS_DIR)
    except FileNotFoundError:
        return
    for name in names:
        path = os.path.join(CLIPS_DIR, name)
        try:
            age = now - os.stat(path).st_mtime
            if CLIP_NAME.match(name) and age > CLIP_TTL_SECONDS:
                os.remove(path)
            elif name.startswith(".") and age > 3600:
                os.remove(path)
        except OSError:
            pass


def cleanup_loop():
    while True:
        time.sleep(CLEANUP_EVERY_SECONDS)
        cleanup()


def parse_range(header, size):
    """Returns (start, end) inclusive, None for no range, False if unsatisfiable."""
    if not header:
        return None
    m = re.match(r"^bytes=(\d*)-(\d*)$", header.strip())
    if not m or (m.group(1) == "" and m.group(2) == ""):
        return None
    if m.group(1) == "":
        n = int(m.group(2))
        if n == 0:
            return False
        return (max(0, size - n), size - 1)
    start = int(m.group(1))
    end = int(m.group(2)) if m.group(2) else size - 1
    end = min(end, size - 1)
    if start >= size or start > end:
        return False
    return (start, end)


class Handler(BaseHTTPRequestHandler):
    server_version = "flash-feedback"
    # A stalled upload must not hold a thread forever.
    timeout = 60

    def log_message(self, fmt, *args):
        pass

    def client_ip(self):
        # The proxy in front appends the address it saw to the right of whatever
        # the client sent, so the right-most entry is the only one that cannot be
        # forged. The left-most is the client's own claim.
        forwarded = self.headers.get("X-Forwarded-For", "")
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        return parts[-1] if parts else self.client_address[0]

    def reply(self, code, body=b"", content_type=None):
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if content_type:
            self.send_header("Content-Type", content_type)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_POST(self):
        if self.path == CLIP_PATH:
            return self.upload_clip()
        if self.path != PATH:
            return self.reply(404)
        ip = self.client_ip()
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.reply(400)
        if length <= 0 or length > MAX_BODY:
            return self.reply(413)
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except ValueError:
            return self.reply(400)
        if not isinstance(data, dict):
            return self.reply(400)
        message = clean(data.get("message"), MAX_MESSAGE)
        if len(message) < 3:
            return self.reply(400)
        if not allowed(ip):
            return self.reply(429)
        version = clean(data.get("version"), 32)
        osname = clean(data.get("os"), 64)
        now = datetime.now()
        name = "%s_%s.md" % (now.strftime("%Y-%m-%d_%H-%M-%S"), os.urandom(3).hex())
        os.makedirs(INBOX_DIR, exist_ok=True)
        body = "---\nreceived: %s\nversion: %s\nos: %s\n---\n\n%s\n" % (
            now.isoformat(timespec="seconds"), version, osname, message)
        tmp = os.path.join(INBOX_DIR, "." + name)
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(body)
        os.replace(tmp, os.path.join(INBOX_DIR, name))
        self.reply(204)

    def upload_clip(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.reply(400)
        if length < 32:
            return self.reply(400)
        if length > MAX_CLIP_BYTES:
            return self.reply(413)
        if not clip_limit.allow(self.client_ip()):
            return self.reply(429)
        os.makedirs(CLIPS_DIR, exist_ok=True)
        cleanup()
        # Only a few uploads may be in flight at once, so slow senders cannot
        # pin the whole storage budget with reservations.
        ip = self.client_ip()
        with active_lock:
            if ip in active_ips:
                return self.reply(429)
            active_ips.add(ip)
        if not uploads_slots.acquire(blocking=False):
            with active_lock:
                active_ips.discard(ip)
            return self.reply(503)
        try:
            if not reserve(length):
                return self.reply(507)
            try:
                return self.store_clip(length)
            finally:
                release(length)
        finally:
            uploads_slots.release()
            with active_lock:
                active_ips.discard(ip)

    def store_clip(self, length):
        clip_id = secrets.token_urlsafe(9)
        name = clip_id + ".mp4"
        tmp = os.path.join(CLIPS_DIR, "." + clip_id + ".part")
        remaining = length
        first = True
        deadline = time.time() + UPLOAD_DEADLINE_SECONDS
        try:
            with open(tmp, "wb") as f:
                while remaining > 0:
                    left = deadline - time.time()
                    if left <= 0:
                        raise ValueError("upload too slow")
                    # The deadline binds the socket itself, so a sender that
                    # trickles bytes cannot outlast it.
                    self.connection.settimeout(min(60, left))
                    chunk = self.rfile.read1(min(CHUNK, remaining))
                    if not chunk:
                        raise ValueError("short body")
                    if first:
                        # An MP4 starts with a box whose type is at bytes 4-8.
                        if chunk[4:8] not in (b"ftyp", b"moov", b"mdat", b"free", b"skip", b"wide"):
                            raise ValueError("not an mp4")
                        first = False
                    f.write(chunk)
                    remaining -= len(chunk)
            os.replace(tmp, os.path.join(CLIPS_DIR, name))
        except (ValueError, OSError):
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.close_connection = True
            return self.reply(400)
        expires = datetime.now(timezone.utc) + timedelta(seconds=CLIP_TTL_SECONDS)
        body = json.dumps({
            "id": clip_id,
            "path": "/c/" + name,
            "expiresAt": expires.isoformat(timespec="seconds"),
        }).encode()
        self.reply(201, body, "application/json")

    def do_HEAD(self):
        self.serve_clip(head=True)

    def do_GET(self):
        self.serve_clip(head=False)

    def serve_clip(self, head):
        m = CLIP_URL.match(self.path.split("?", 1)[0])
        if not m:
            return self.reply(404)
        path = os.path.join(CLIPS_DIR, m.group(1))
        try:
            st = os.stat(path)
        except OSError:
            return self.reply(404)
        if time.time() - st.st_mtime > CLIP_TTL_SECONDS:
            try:
                os.remove(path)
            except OSError:
                pass
            return self.reply(404)
        size = st.st_size
        rng = parse_range(self.headers.get("Range"), size)
        if rng is False:
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        start, end = rng if rng else (0, size - 1)
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if rng:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Disposition", "inline")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        if head:
            return
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(CHUNK, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (OSError, ConnectionError):
            pass


def make_server(port=PORT):
    return ThreadingHTTPServer(("0.0.0.0", port), Handler)


if __name__ == "__main__":
    threading.Thread(target=cleanup_loop, daemon=True).start()
    make_server().serve_forever()
