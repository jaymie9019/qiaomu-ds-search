import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ds_search", ROOT / "scripts/ds_search.py")
ds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ds)
KEY = "test-secret-not-a-real-key"
RESULT = {"results": [{"title": "Official docs", "url": "https://api-docs.deepseek.com/",
                        "snippet": "Search API", "summary": "API evidence", "content": "",
                        "date": None, "authority": -1, "rerank_score": 1.5}]}


def response(body):
    result = Mock()
    result.status = 200
    result.read.return_value = json.dumps(body).encode()
    result.__enter__ = Mock(return_value=result)
    result.__exit__ = Mock(return_value=False)
    return result


def http_error(status, retry_after=None):
    headers = {} if retry_after is None else {"Retry-After": retry_after}
    return urllib.error.HTTPError(ds.API_BASE, status, "error", headers,
                                  io.BytesIO(KEY.encode()))


class InputTests(unittest.TestCase):
    def test_unicode_limit_and_operators_preserved(self):
        query = '模型 "搜索" site:a.com OR site:b.com lang:zh,en after:2026'
        self.assertEqual(ds.search_payload(query)["query"], query)
        self.assertEqual(len(ds.search_payload("中" * 128)["query"]), 128)
        for text in ("中" * 129, " ", ""):
            with self.assertRaises(ds.SearchError):
                ds.search_payload(text)

    def test_count_and_original_question(self):
        for n in (0, 51, True):
            with self.assertRaises(ds.SearchError):
                ds.search_payload("query", n)
        self.assertEqual(ds.search_payload("query", 50)["count"], 50)
        with self.assertRaises(ds.SearchError):
            ds.search_payload("query", ori_question="x" * 129)

    def test_ip_is_explicit_optional_field(self):
        self.assertNotIn("localization", ds.search_payload("query"))
        self.assertEqual(ds.search_payload("query", localization="::1")["localization"], "::1")
        with self.assertRaises(ds.SearchError):
            ds.search_payload("query", localization="China")

    def test_fetch_rejects_credentials_and_malformed_urls(self):
        for url in ("file:///etc/passwd", "https://u:p@example.com", "https://@example.com",
                    "https:///oops", "https://example.com:bad", "https://example.com/\n", "x" * 8193):
            with self.subTest(url=url[:50]), self.assertRaises(ds.SearchError):
                ds.fetch_payload(url)
        self.assertEqual(ds.fetch_payload("https://example.com/a?b=1")["url"], "https://example.com/a?b=1")


class NetworkTests(unittest.TestCase):
    def test_official_search_body_no_model(self):
        opener = Mock()
        opener.open.return_value = response(RESULT)
        data, attempts = ds.request_api("search", ds.search_payload("test"), KEY, opener=opener)
        req = opener.open.call_args.args[0]
        self.assertEqual(req.full_url, "https://api.deepseek.com/v1/tools/search")
        self.assertEqual(req.get_header("Authorization"), "Bearer " + KEY)
        self.assertNotIn("model", json.loads(req.data))
        self.assertEqual(data, RESULT)
        self.assertEqual(attempts, 1)

    def test_fetch_keeps_markdown(self):
        opener = Mock()
        opener.open.return_value = response({"title": "Title", "content": "# Title\n\nText"})
        data, _ = ds.request_api("fetch", ds.fetch_payload("https://example.com"), KEY, opener=opener)
        self.assertEqual(data["content"], "# Title\n\nText")
        self.assertTrue(opener.open.call_args.args[0].full_url.endswith("/fetch"))

    def test_empty_search_is_valid_not_error(self):
        ds.validate_response("search", {"results": []})
        data = ds.envelope("search", {"query": "x"}, {"results": []}, 1)
        self.assertTrue(data["ok"] and data["empty"])

    def test_unknown_date_preserved(self):
        result = ds.envelope("search", {}, RESULT, 1)
        self.assertIsNone(result["results"][0]["date"])

    def test_permanent_errors_never_retry_or_leak_body(self):
        for code in (400, 401, 402, 403, 404, 413, 302):
            opener, sleep = Mock(), Mock()
            opener.open.side_effect = http_error(code)
            with self.subTest(code=code), self.assertRaises(ds.SearchError) as caught:
                ds.request_api("search", {}, KEY, opener=opener, sleep=sleep)
            self.assertEqual(caught.exception.status, code)
            self.assertNotIn(KEY, str(caught.exception))
            self.assertEqual(opener.open.call_count, 1)
            sleep.assert_not_called()

    def test_retryable_errors_have_bounded_retries(self):
        for code in (408, 429, 500, 504):
            opener, sleep = Mock(), Mock()
            opener.open.side_effect = [http_error(code), http_error(code), response(RESULT)]
            _, attempts = ds.request_api("search", {}, KEY, opener=opener, sleep=sleep)
            self.assertEqual(attempts, 3)
            self.assertEqual(sleep.call_count, 2)

    def test_retry_after_too_long_stops(self):
        opener, sleep = Mock(), Mock()
        opener.open.side_effect = http_error(429, "30")
        with self.assertRaises(ds.SearchError) as caught:
            ds.request_api("search", {}, KEY, opener=opener, sleep=sleep)
        self.assertEqual(caught.exception.code, "retry_later")
        sleep.assert_not_called()

    def test_network_failure_stops_after_budget(self):
        opener, sleep = Mock(), Mock()
        opener.open.side_effect = urllib.error.URLError("sensitive failure text " + KEY)
        with self.assertRaises(ds.SearchError) as caught:
            ds.request_api("search", {}, KEY, opener=opener, sleep=sleep)
        self.assertEqual(opener.open.call_count, 3)
        self.assertNotIn(KEY, str(caught.exception))

    def test_malformed_response_not_silent_empty(self):
        for operation, data in (("search", {}), ("search", {"results": [{}]}),
                                ("search", {"results": None}), ("fetch", {"title": "x"})):
            with self.assertRaises(ds.SearchError):
                ds.validate_response(operation, data)

    def test_redirect_cannot_forward_bearer(self):
        self.assertIsNone(ds.NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil.example"))

    def test_doctor_does_not_claim_empty_search_success(self):
        with patch.object(ds, "request_api", return_value=({"results": []}, 1)):
            result = ds.doctor(KEY, "test")
        self.assertFalse(result["search_verified"])
        self.assertTrue(result["http_200"])


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"XDG_CONFIG_HOME": self.tmp.name, "DEEPSEEK_API_KEY": ""})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_private_atomic_save_and_env_priority(self):
        path = ds.save_key(KEY)
        self.assertEqual(ds.load_key(), (KEY, "config_file"))
        if os.name == "posix":
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-env-key"}):
            self.assertEqual(ds.load_key(), ("test-env-key", "environment"))

    def test_symlink_target_unchanged(self):
        target = Path(self.tmp.name) / "keep.txt"
        target.write_text("keep")
        path = ds.config_path()
        path.parent.mkdir()
        path.symlink_to(target)
        with self.assertRaises(ds.SearchError):
            ds.save_key(KEY)
        with self.assertRaises(ds.SearchError):
            ds.load_key()
        self.assertEqual(target.read_text(), "keep")

    @unittest.skipUnless(os.name == "posix", "POSIX permission contract")
    def test_insecure_config_rejected(self):
        path = ds.save_key(KEY)
        path.chmod(0o644)
        with self.assertRaises(ds.SearchError):
            ds.load_key()

    def test_missing_key_is_actionable_without_network(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), patch.object(ds, "request_api") as request:
            code = ds.main(["search", "test"])
        self.assertEqual(code, 2)
        self.assertIn(ds.KEYS_URL, err.getvalue())
        request.assert_not_called()

    def test_status_does_not_reveal_key_or_claim_verified(self):
        ds.save_key(KEY)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(ds.main(["status"]), 0)
        self.assertNotIn(KEY, out.getvalue())
        self.assertFalse(json.loads(out.getvalue())["search_verified"])

    def test_noninteractive_setup_refuses_secret_input(self):
        with patch.object(ds.sys.stdin, "isatty", return_value=False), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(ds.SearchError):
                ds.setup(no_browser=True)
        self.assertFalse(ds.config_path().exists())

    def test_setup_saves_but_does_not_claim_success_on_402(self):
        output = io.StringIO()
        with patch.object(ds.sys.stdin, "isatty", return_value=True), \
                patch.object(ds.getpass, "getpass", return_value=KEY), \
                patch.object(ds, "doctor", side_effect=ds.error_for_status(402)), \
                contextlib.redirect_stdout(output):
            with self.assertRaises(ds.SearchError):
                ds.setup(no_browser=True)
        self.assertEqual(ds.load_key()[0], KEY)
        self.assertIn("联网验证未通过", output.getvalue())
        self.assertNotIn(KEY, output.getvalue())

    def test_guide_opens_official_page_without_saving(self):
        with patch.object(ds.webbrowser, "open", return_value=True) as browser, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ds.setup(guide_only=True), 0)
        browser.assert_called_once_with(ds.KEYS_URL)
        self.assertFalse(ds.config_path().exists())


if __name__ == "__main__":
    unittest.main()
