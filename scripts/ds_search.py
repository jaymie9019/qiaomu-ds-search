#!/usr/bin/env python3
"""DeepSeek Search / Fetch CLI. Python standard library; no chat model calls."""
from __future__ import annotations

import argparse
import getpass
import ipaddress
import json
import os
from pathlib import Path
import random
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

API_BASE = "https://api.deepseek.com/v1/tools"
KEYS_URL = "https://platform.deepseek.com/api_keys"
DOCS_URL = "https://api-docs.deepseek.com/guides/search/"


class SearchError(Exception):
    def __init__(self, message, code="request_failed", status=None):
        super().__init__(message)
        self.code, self.status = code, status


def config_path():
    base = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    if not base.is_absolute():
        raise SearchError("XDG_CONFIG_HOME 必须为绝对路径。", "invalid_config")
    return base / "qiaomu-ds-search" / "credentials.json"


def validate_key(key):
    key = key.strip()
    if not key or any(c.isspace() for c in key) or not key.isascii():
        raise SearchError("API Key 为空或含非法空白/字符，请重新复制。", "invalid_key")
    return key


def load_key():
    if os.environ.get("DEEPSEEK_API_KEY", "").strip():
        return validate_key(os.environ["DEEPSEEK_API_KEY"]), "environment"
    path = config_path()
    if path.is_symlink() or path.parent.is_symlink():
        raise SearchError("凭据文件或专用目录不能是符号链接。", "unsafe_config")
    if not path.exists():
        raise SearchError(f"尚未配置 API Key。运行 setup 引导创建与配置：{KEYS_URL}", "missing_api_key")
    if os.name == "posix" and stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise SearchError(f"凭据权限过宽，请运行 chmod 600 '{path}'。", "unsafe_config")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return validate_key(data["api_key"]), "config_file"
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        raise SearchError("凭据文件损坏，请重新运行 setup。", "invalid_config") from None


def save_key(key):
    key = validate_key(key)
    path = config_path()
    if path.is_symlink() or path.parent.is_symlink():
        raise SearchError("拒绝向符号链接保存凭据。", "unsafe_config")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == "posix":
        path.parent.chmod(0o700)
    fd, temporary = tempfile.mkstemp(prefix=".credentials-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"api_key": key}, stream)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path


def validate_text(value, field):
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise SearchError(f"{field} 必须为 1–128 个 Unicode 字符，且不能全为空白。", "invalid_input")
    return value


def search_payload(query, count=5, need_content=False, ori_question=None, localization=None):
    validate_text(query, "query")
    if type(count) is not int or not 1 <= count <= 50:
        raise SearchError("count 必须为 1–50 的整数。", "invalid_input")
    data = {"query": query, "count": count, "need_content": need_content}
    if ori_question is not None:
        data["ori_question"] = validate_text(ori_question, "ori_question")
    if localization is not None:
        try:
            ipaddress.ip_address(localization)
        except ValueError:
            raise SearchError("localization 必须为 IP 地址；不要填国家名称。", "invalid_input") from None
        data["localization"] = localization
    return data


def fetch_payload(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        valid = (len(url) <= 8192 and parsed.scheme in ("http", "https")
                 and parsed.hostname and parsed.username is None and parsed.password is None
                 and not any(c.isspace() or ord(c) < 32 for c in url))
        parsed.port  # Validate malformed ports before sending a paid request.
    except ValueError:
        valid = False
    if not valid:
        raise SearchError("URL 必须是最多 8192 字符、含主机且不含账号密码的 HTTP(S) 地址。", "invalid_input")
    return {"url": url}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward Bearer credentials to a redirect destination.


def error_for_status(status):
    messages = {
        400: "请求参数无效，请核对 query/count/URL。",
        401: "API Key 无效或已撤销；运行 setup 重新配置。环境变量优先于配置文件。",
        402: "DeepSeek 账户余额不足；请在官方平台检查余额，充值由用户自行决定。",
        403: "Fetch 被安全策略拒绝；请更换公开来源，不要绕过限制。",
        404: "Fetch 未取得可用正文；页面可能不可用、受站点限制或无可提取内容。",
        408: "请求超时。",
        413: "请求体过大，请缩短输入。",
        429: "达到 Search/Fetch 限流；请稍后重试，多个进程共享账户限额。",
    }
    return SearchError(messages.get(status, "DeepSeek 服务暂时不可用或返回了意外 HTTP 状态。"),
                       "http_error", status)


def request_api(operation, payload, key, timeout=30, retries=2, opener=None, sleep=time.sleep):
    if operation not in ("search", "fetch"):
        raise SearchError("不支持的操作。", "invalid_input")
    opener = opener or urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(
        API_BASE + "/" + operation,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": "Bearer " + validate_key(key), "Content-Type": "application/json",
                 "User-Agent": "qiaomu-ds-search/1.0.0"}, method="POST")
    for attempt in range(retries + 1):
        delay = min(2 ** attempt + random.random(), 10)
        try:
            with opener.open(request, timeout=timeout) as response:
                status = response.status
                if status != 200:
                    raise error_for_status(status)
                raw = response.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                raise SearchError("响应超过 16 MiB 安全上限，请减少结果或关闭 need_content。", "response_too_large")
            try:
                result = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                raise SearchError("API 返回的内容不是有效 JSON。", "invalid_response") from None
            validate_response(operation, result)
            return result, attempt + 1
        except urllib.error.HTTPError as exc:
            status = exc.code
            retry_after = exc.headers.get("Retry-After", "") if exc.headers else ""
            exc.close()  # Do not echo provider error bodies: they may contain sensitive input.
            if status not in (408, 429) and not 500 <= status <= 599:
                raise error_for_status(status) from None
            if attempt == retries:
                raise error_for_status(status) from None
            try:
                wait = float(retry_after)
                if wait > 10:
                    raise SearchError("服务要求等待超过 10 秒；本次停止，请稍后重试。", "retry_later", status)
                delay = max(delay, wait)
            except ValueError:
                pass
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == retries:
                raise SearchError("网络或 TLS 连接失败/超时，请检查网络后重试。", "network_error") from None
        sleep(delay)


def validate_response(operation, result):
    valid = isinstance(result, dict)
    if operation == "search":
        valid = valid and isinstance(result.get("results"), list)
        if valid:
            valid = all(isinstance(r, dict) and all(isinstance(r.get(k), str)
                        for k in ("title", "url", "snippet", "summary", "content"))
                        for r in result["results"])
    else:
        valid = valid and isinstance(result.get("title"), str) and isinstance(result.get("content"), str)
    if not valid:
        raise SearchError("API 响应结构与官方 Search/Fetch 契约不符。", "invalid_response")


def envelope(operation, payload, response, attempts):
    from datetime import datetime, timezone
    empty = not response["results"] if operation == "search" else not response["content"].strip()
    return {"ok": True, "provider": "deepseek", "operation": operation,
            "retrieved_at": datetime.now(timezone.utc).isoformat(), "request": payload,
            "attempts": attempts, "empty": empty, **response}


def doctor(key, source, timeout=30):
    payload = search_payload("DeepSeek site:api-docs.deepseek.com", count=1)
    response, attempts = request_api("search", payload, key, timeout=timeout, retries=0)
    nonempty = bool(response["results"])
    return {"ok": nonempty, "configured": True, "credential_source": source,
            "search_verified": nonempty, "http_200": True, "result_count": len(response["results"]),
            "attempts": attempts, "message": "搜索实测成功。" if nonempty else "接口已响应，但结果为空；尚未验证有效搜索结果。"}


def setup(no_browser=False, guide_only=False):
    print(f"1. 打开 DeepSeek 官方 API Keys 页面：{KEYS_URL}")
    print("2. 登录/注册，进入 API keys，选择创建新密钥，名称可填 qiaomu-ds-search。")
    print("3. 复制新生成的 Key，仅粘贴到下方本机隐藏输入；不要发到聊天或提交到 Git。")
    print(f"4. 保存后执行一次 Search 验证。可能产生 API 费用，现价以 {DOCS_URL} 为准。")
    print("若遇 402，请自行在平台查看余额并决定是否充值；ChatGPT 等会员不含 DeepSeek API 额度。")
    if not no_browser:
        try:
            opened = webbrowser.open(KEYS_URL)
        except webbrowser.Error:
            opened = False
        if not opened:
            print("浏览器未能自动打开，请手动访问上面的官方链接。")
    if guide_only:
        return 0
    if not sys.stdin.isatty():
        raise SearchError("请在用户自己的可见终端运行 setup；禁止通过聊天、参数或管道传入密钥。", "interactive_required")
    with __import__("warnings").catch_warnings():
        __import__("warnings").simplefilter("error", getpass.GetPassWarning)
        try:
            key = validate_key(getpass.getpass("DeepSeek API Key（输入不回显）: "))
        except getpass.GetPassWarning:
            raise SearchError("此终端无法安全隐藏输入，请换用本机终端。", "interactive_required") from None
    path = save_key(key)
    print(f"已保存到 {path}（POSIX 目录 700 / 文件 600）。")
    if os.environ.get("DEEPSEEK_API_KEY", "").strip():
        print("提醒：后续搜索优先使用 DEEPSEEK_API_KEY；若旧环境变量无效，请在使用 skill 的进程中清除/更新。")
    try:
        checked = doctor(key, "newly_saved_config")
    except SearchError:
        print("配置已保存，联网验证未通过。处理下面的错误后重新运行 doctor，无需重复输入密钥。")
        raise
    print(json.dumps(checked, ensure_ascii=False, indent=2))
    return 0 if checked["ok"] else 4


def parser():
    root = argparse.ArgumentParser(description="DeepSeek 官方搜索与网页抓取；缺少密钥时运行 setup。")
    sub = root.add_subparsers(dest="command", required=True)
    configure = sub.add_parser("setup", help="引导创建 API Key、隐藏输入、保存并验证")
    configure.add_argument("--no-browser", action="store_true", help="只显示官方链接")
    configure.add_argument("--guide-only", action="store_true", help="打开页面并说明步骤，不读写密钥")
    sub.add_parser("status", help="只检查本地配置，不联网、不显示密钥")
    sub.add_parser("doctor", help="一次真实搜索验证，可能计费")
    search = sub.add_parser("search", help="搜索公开网页")
    search.add_argument("query")
    search.add_argument("--count", type=int, default=5)
    search.add_argument("--need-content", action="store_true")
    search.add_argument("--ori-question")
    search.add_argument("--localization", help="可选 IP 地址；不会自动采集用户 IP")
    fetch = sub.add_parser("fetch", help="抓取指定 URL 的 Markdown 正文")
    fetch.add_argument("url")
    for cmd in (search, fetch):
        cmd.add_argument("--timeout", type=int, choices=range(1, 121), metavar="1..120", default=30)
        cmd.add_argument("--retries", type=int, choices=range(3), default=2)
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "setup":
            return setup(args.no_browser, args.guide_only)
        if args.command == "search":
            payload = search_payload(args.query, args.count, args.need_content, args.ori_question, args.localization)
        elif args.command == "fetch":
            payload = fetch_payload(args.url)
        key, source = load_key()
        if args.command == "status":
            result = {"ok": True, "configured": True, "credential_source": source, "search_verified": False,
                      "message": "配置存在；运行 doctor 才能验证真实搜索。"}
        elif args.command == "doctor":
            result = doctor(key, source)
        else:
            response, attempts = request_api(args.command, payload, key, args.timeout, args.retries)
            result = envelope(args.command, payload, response, attempts)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 4
    except SearchError as exc:
        print(json.dumps({"ok": False, "error": {"code": exc.code, "message": str(exc), "http_status": exc.status}},
                         ensure_ascii=False), file=sys.stderr)
        return 2 if exc.code == "missing_api_key" else 1
    except (KeyboardInterrupt, EOFError):
        print("已取消。", file=sys.stderr)
        return 130
    except OSError:
        print('{"ok":false,"error":{"code":"local_io_error","message":"本地文件操作失败，请检查目录权限。"}}', file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
