"""Self-check for the clip share endpoints. Run: python test_receiver.py"""
import http.client
import json
import os
import tempfile
import threading
import time
import unittest

tmp = tempfile.mkdtemp()
os.environ["CLIPS_DIR"] = os.path.join(tmp, "clips")
os.environ["INBOX_DIR"] = os.path.join(tmp, "inbox")
os.environ["MAX_CLIP_BYTES"] = "4096"
os.environ["MAX_STORE_BYTES"] = "10000"
os.environ["CLIP_TTL_SECONDS"] = "3600"
os.environ["CLIP_PER_IP_PER_HOUR"] = "6"

import receiver  # noqa: E402

MP4 = b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * 4  # 1048 bytes


def call(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request(method, path, body=body, headers=headers or {})
    res = conn.getresponse()
    data = res.read()
    conn.close()
    return res.status, dict(res.getheaders()), data


class ClipTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = receiver.make_server(0)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        receiver.clip_limit.by_ip.clear()
        receiver.clip_limit.all.clear()

    def upload(self, body=MP4):
        return call(self.port, "POST", "/flash-clips", body, {"Content-Type": "video/mp4"})

    def test_upload_then_download(self):
        status, _, data = self.upload()
        self.assertEqual(status, 201)
        info = json.loads(data)
        self.assertRegex(info["path"], r"^/c/[A-Za-z0-9_-]{12}\.mp4$")
        status, headers, body = call(self.port, "GET", info["path"])
        self.assertEqual(status, 200)
        self.assertEqual(body, MP4)
        self.assertEqual(headers["Content-Type"], "video/mp4")
        self.assertEqual(headers["Accept-Ranges"], "bytes")

    def test_range_requests(self):
        info = json.loads(self.upload()[2])
        status, headers, body = call(self.port, "GET", info["path"], headers={"Range": "bytes=10-19"})
        self.assertEqual((status, body), (206, MP4[10:20]))
        self.assertEqual(headers["Content-Range"], "bytes 10-19/%d" % len(MP4))
        status, _, body = call(self.port, "GET", info["path"], headers={"Range": "bytes=-5"})
        self.assertEqual((status, body), (206, MP4[-5:]))
        status, _, _ = call(self.port, "GET", info["path"], headers={"Range": "bytes=99999-"})
        self.assertEqual(status, 416)
        status, _, body = call(self.port, "HEAD", info["path"])
        self.assertEqual((status, body), (200, b""))

    def test_rejects_non_mp4(self):
        self.assertEqual(self.upload(b"not a video at all, just some text bytes here!!!")[0], 400)

    def test_rejects_oversize_and_tiny(self):
        self.assertEqual(self.upload(MP4 + b"\0" * 4096)[0], 413)
        self.assertEqual(self.upload(b"abc")[0], 400)

    def test_bad_ids_are_404(self):
        for path in ("/c/short.mp4", "/c/../../etc/passwd", "/c/AAAAAAAAAAAA.mp4", "/c/AAAAAAAAAAAA"):
            self.assertEqual(call(self.port, "GET", path)[0], 404, path)

    def test_expired_clip_is_gone(self):
        info = json.loads(self.upload()[2])
        path = os.path.join(receiver.CLIPS_DIR, info["path"].split("/")[-1])
        old = time.time() - 7200
        os.utime(path, (old, old))
        self.assertEqual(call(self.port, "GET", info["path"])[0], 404)
        self.assertFalse(os.path.exists(path))

    def test_cleanup_removes_old_and_partial(self):
        info = json.loads(self.upload()[2])
        name = info["path"].split("/")[-1]
        old = time.time() - 7200
        os.utime(os.path.join(receiver.CLIPS_DIR, name), (old, old))
        part = os.path.join(receiver.CLIPS_DIR, ".abandoned.part")
        with open(part, "wb") as f:
            f.write(b"x")
        os.utime(part, (old, old))
        receiver.cleanup()
        self.assertFalse(os.path.exists(os.path.join(receiver.CLIPS_DIR, name)))
        self.assertFalse(os.path.exists(part))

    def clear_store(self):
        for p in os.listdir(receiver.CLIPS_DIR):
            os.remove(os.path.join(receiver.CLIPS_DIR, p))

    def test_rate_limit(self):
        self.clear_store()
        codes = [self.upload()[0] for _ in range(8)]
        self.assertEqual(codes[:6], [201] * 6)
        self.assertEqual(codes[6:], [429, 429])

    def test_forged_forwarded_for_does_not_dodge_the_limit(self):
        self.clear_store()
        codes = []
        for i in range(8):
            headers = {"Content-Type": "video/mp4", "X-Forwarded-For": "10.9.9.%d, 203.0.113.7" % i}
            codes.append(call(self.port, "POST", "/flash-clips", MP4, headers)[0])
        self.assertEqual(codes[6:], [429, 429])

    def test_inflight_uploads_count_against_the_cap(self):
        self.clear_store()
        original = receiver.MAX_STORE_BYTES
        receiver.MAX_STORE_BYTES = 2500
        try:
            self.assertTrue(receiver.reserve(2000))
            self.assertEqual(self.upload()[0], 507)
            receiver.release(2000)
            self.assertEqual(self.upload()[0], 201)
        finally:
            receiver.MAX_STORE_BYTES = original

    def test_too_many_uploads_in_flight(self):
        self.clear_store()
        taken = 0
        while receiver.uploads_slots.acquire(blocking=False):
            taken += 1
        try:
            self.assertEqual(self.upload()[0], 503)
        finally:
            for _ in range(taken):
                receiver.uploads_slots.release()
        self.assertEqual(self.upload()[0], 201)

    def test_storage_cap(self):
        self.clear_store()
        original = receiver.MAX_STORE_BYTES
        receiver.MAX_STORE_BYTES = 2500
        try:
            codes = [self.upload()[0] for _ in range(3)]
        finally:
            receiver.MAX_STORE_BYTES = original
        self.assertEqual(codes, [201, 201, 507])

    def test_feedback_still_works(self):
        body = json.dumps({"message": "hello there", "version": "1", "os": "win32"}).encode()
        self.assertEqual(call(self.port, "POST", "/flash-feedback", body)[0], 204)

    def test_feedback_metadata_cannot_add_front_matter_fields(self):
        self.assertNotIn("\n", receiver.clean("1\nadmin: true", 32))

    def test_feedback_proxy_key_uses_forwarded_client_ip(self):
        body = json.dumps({"message": "hello there"}).encode()
        original = receiver.PROXY_KEY
        receiver.PROXY_KEY = "secret"
        receiver.feedback_limit.by_ip.clear()
        receiver.feedback_limit.all.clear()
        try:
            headers = {"X-Flash-Proxy-Key": "secret", "X-Flash-Client-IP": "192.0.2.1"}
            self.assertEqual([call(self.port, "POST", "/flash-feedback", body, headers)[0]
                              for _ in range(6)], [204] * 5 + [429])
            headers["X-Flash-Client-IP"] = "192.0.2.2"
            self.assertEqual(call(self.port, "POST", "/flash-feedback", body, headers)[0], 204)
            headers["X-Flash-Proxy-Key"] = "wrong"
            self.assertEqual([call(self.port, "POST", "/flash-feedback", body, headers)[0]
                              for _ in range(6)], [204] * 5 + [429])
        finally:
            receiver.PROXY_KEY = original
            receiver.feedback_limit.by_ip.clear()
            receiver.feedback_limit.all.clear()


if __name__ == "__main__":
    unittest.main()
