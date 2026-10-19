import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import * as ds from "../scripts/ds_search.mjs";
import { capture, stub, syncStub, withDeps } from "./helpers.mjs";

const KEY = "test-secret-not-a-real-key";
const RESULT = { results: [{ title: "Official docs", url: "https://api-docs.deepseek.com/", snippet: "Search API",
                             summary: "API evidence", content: "", date: null, authority: -1, rerank_score: 1.5 }] };
const response = (body) => new Response(JSON.stringify(body), { status: 200 });
const httpError = (status, retryAfter) =>
  new Response(KEY, { status, headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter } });

describe("input", () => {
  test("unicode limit and operators preserved", () => {
    const query = '模型 "搜索" site:a.com OR site:b.com lang:zh,en after:2026';
    assert.equal(ds.searchPayload(query).query, query);
    assert.equal(Array.from(ds.searchPayload("中".repeat(128)).query).length, 128);
    for (const text of ["中".repeat(129), " ", ""]) assert.throws(() => ds.searchPayload(text), ds.SearchError);
  });

  test("count and original question", () => {
    for (const n of [0, 51, true]) assert.throws(() => ds.searchPayload("query", n), ds.SearchError);
    assert.equal(ds.searchPayload("query", 50).count, 50);
    assert.throws(() => ds.searchPayload("query", 5, false, "x".repeat(129)), ds.SearchError);
  });

  test("ip is explicit optional field", () => {
    assert.ok(!("localization" in ds.searchPayload("query")));
    assert.equal(ds.searchPayload("query", 5, false, null, "::1").localization, "::1");
    assert.throws(() => ds.searchPayload("query", 5, false, null, "China"), ds.SearchError);
  });

  test("fetch rejects credentials and malformed urls", () => {
    for (const url of ["file:///etc/passwd", "https://u:p@example.com", "https://@example.com", "https:///oops",
                       "https://example.com:bad", "https://example.com/\n", "x".repeat(8193)]) {
      assert.throws(() => ds.fetchPayload(url), ds.SearchError, url.slice(0, 50));
    }
    assert.equal(ds.fetchPayload("https://example.com/a?b=1").url, "https://example.com/a?b=1");
  });
});

describe("network", () => {
  test("official search body, no model", async () => {
    const fetchImpl = stub(response(RESULT));
    const [data, attempts] = await ds.requestApi("search", ds.searchPayload("test"), KEY, { fetchImpl });
    const [url, init] = fetchImpl.calls[0];
    assert.equal(url, "https://api.deepseek.com/v1/tools/search");
    assert.equal(init.headers.Authorization, "Bearer " + KEY);
    assert.equal(init.redirect, "manual");
    assert.ok(!("model" in JSON.parse(init.body)));
    assert.deepEqual(data, RESULT);
    assert.equal(attempts, 1);
  });

  test("fetch keeps markdown", async () => {
    const fetchImpl = stub(response({ title: "Title", content: "# Title\n\nText" }));
    const [data] = await ds.requestApi("fetch", ds.fetchPayload("https://example.com"), KEY, { fetchImpl });
    assert.equal(data.content, "# Title\n\nText");
    assert.ok(fetchImpl.calls[0][0].endsWith("/fetch"));
  });

  test("empty search is valid, not error", () => {
    ds.validateResponse("search", { results: [] });
    const data = ds.envelope("search", { query: "x" }, { results: [] }, 1);
    assert.ok(data.ok && data.empty);
  });

  test("unknown date preserved", () => {
    assert.equal(ds.envelope("search", {}, RESULT, 1).results[0].date, null);
  });

  test("permanent errors never retry or leak body", async () => {
    for (const code of [400, 401, 402, 403, 404, 413, 302]) {
      const fetchImpl = stub(() => httpError(code)), sleep = stub();
      await assert.rejects(ds.requestApi("search", {}, KEY, { fetchImpl, sleep }), (error) => {
        assert.equal(error.status, code);
        assert.ok(!error.message.includes(KEY));
        return true;
      });
      assert.equal(fetchImpl.calls.length, 1);
      assert.equal(sleep.calls.length, 0);
    }
  });

  test("retryable errors have bounded retries", async () => {
    for (const code of [408, 429, 500, 504]) {
      const fetchImpl = stub([httpError(code), httpError(code), response(RESULT)]), sleep = stub();
      const [, attempts] = await ds.requestApi("search", {}, KEY, { fetchImpl, sleep });
      assert.equal(attempts, 3);
      assert.equal(sleep.calls.length, 2);
    }
  });

  test("retry-after too long stops", async () => {
    const fetchImpl = stub(() => httpError(429, "30")), sleep = stub();
    await assert.rejects(ds.requestApi("search", {}, KEY, { fetchImpl, sleep }), { code: "retry_later" });
    assert.equal(sleep.calls.length, 0);
  });

  test("network failure stops after budget", async () => {
    const fetchImpl = stub(() => new TypeError("sensitive failure text " + KEY)), sleep = stub();
    await assert.rejects(ds.requestApi("search", {}, KEY, { fetchImpl, sleep }), (error) => {
      assert.equal(error.code, "network_error");
      assert.ok(!error.message.includes(KEY));
      return true;
    });
    assert.equal(fetchImpl.calls.length, 3);
  });

  test("malformed response is not a silent empty", () => {
    for (const [operation, data] of [["search", {}], ["search", { results: [{}] }], ["search", { results: null }],
                                     ["fetch", { title: "x" }]]) {
      assert.throws(() => ds.validateResponse(operation, data), ds.SearchError);
    }
  });

  test("non-JSON body is an invalid response", async () => {
    const fetchImpl = stub(new Response("<html>", { status: 200 }));
    await assert.rejects(ds.requestApi("search", {}, KEY, { fetchImpl }), { code: "invalid_response" });
  });

  test("doctor does not claim empty search success", async () => {
    const result = await withDeps({ requestApi: stub([[{ results: [] }, 1]]) }, () => ds.doctor(KEY, "test"));
    assert.equal(result.search_verified, false);
    assert.equal(result.http_200, true);
  });
});

describe("config", () => {
  let tmp, saved;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "double-search-"));
    saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY };
    process.env.XDG_CONFIG_HOME = tmp;
    process.env.DEEPSEEK_API_KEY = "";
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("private atomic save and env priority", () => {
    const file = ds.saveKey(KEY);
    assert.deepEqual(ds.loadKey(), [KEY, "config_file"]);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    }
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["credentials.json"]);
    process.env.DEEPSEEK_API_KEY = "test-env-key";
    assert.deepEqual(ds.loadKey(), ["test-env-key", "environment"]);
  });

  test("symlink target unchanged", { skip: process.platform === "win32" && "symlinks need elevated rights on Windows" }, () => {
    const target = path.join(tmp, "keep.txt");
    fs.writeFileSync(target, "keep");
    const file = ds.configPath();
    fs.mkdirSync(path.dirname(file));
    fs.symlinkSync(target, file);
    assert.throws(() => ds.saveKey(KEY), ds.SearchError);
    assert.throws(() => ds.loadKey(), ds.SearchError);
    assert.equal(fs.readFileSync(target, "utf8"), "keep");
  });

  test("insecure config rejected", { skip: process.platform === "win32" && "POSIX permission contract" }, () => {
    fs.chmodSync(ds.saveKey(KEY), 0o644);
    assert.throws(() => ds.loadKey(), { code: "unsafe_config" });
  });

  test("corrupt config is reported", () => {
    const file = ds.saveKey(KEY);
    fs.writeFileSync(file, "[]");
    assert.throws(() => ds.loadKey(), { code: "invalid_config" });
  });

  test("missing key is actionable without network", async () => {
    const requestApi = stub();
    const { result, err } = await withDeps({ requestApi }, () => capture(() => ds.main(["search", "test"])));
    assert.equal(result, 2);
    assert.ok(err.includes(ds.KEYS_URL));
    assert.equal(requestApi.calls.length, 0);
  });

  test("status does not reveal key or claim verified", async () => {
    ds.saveKey(KEY);
    const { result, out } = await capture(() => ds.main(["status"]));
    assert.equal(result, 0);
    assert.ok(!out.includes(KEY));
    assert.equal(JSON.parse(out).search_verified, false);
  });

  test("noninteractive setup refuses secret input", async () => {
    await withDeps({ isInteractive: () => false }, () =>
      capture(() => assert.rejects(ds.setup({ noBrowser: true }), { code: "interactive_required" })));
    assert.ok(!fs.existsSync(ds.configPath()));
  });

  test("setup saves but does not claim success on 402", async () => {
    const { out } = await withDeps({ isInteractive: () => true, readHidden: stub(KEY), doctor: stub(ds.errorForStatus(402)) },
      () => capture(() => assert.rejects(ds.setup({ noBrowser: true }), { status: 402 })));
    assert.equal(ds.loadKey()[0], KEY);
    assert.ok(out.includes("联网验证未通过"));
    assert.ok(!out.includes(KEY));
  });

  test("guide opens official page without saving", async () => {
    const openBrowser = syncStub(true);
    const { result } = await withDeps({ openBrowser }, () => capture(() => ds.setup({ guideOnly: true })));
    assert.equal(result, 0);
    assert.deepEqual(openBrowser.calls, [[ds.KEYS_URL]]);
    assert.ok(!fs.existsSync(ds.configPath()));
  });
});

describe("cli", () => {
  test("argument errors exit 2 before any request", async () => {
    const requestApi = stub();
    for (const argv of [["research", "x", "--max-searches", "9"], ["search", "x", "--retries", "3"], ["nope"],
                        ["search"], ["search", "x", "--profile", "other"], ["fetch", "u", "--unknown"]]) {
      const { result } = await withDeps({ requestApi }, () => capture(() => ds.main(argv)));
      assert.equal(result, 2, argv.join(" "));
    }
    assert.equal(requestApi.calls.length, 0);
  });

  test("help exits 0", async () => {
    for (const argv of [[], ["--help"], ["research", "--help"]]) {
      const { result, out } = await capture(() => ds.main(argv));
      assert.equal(result, 0);
      assert.ok(out.includes("usage:"));
    }
  });
});
