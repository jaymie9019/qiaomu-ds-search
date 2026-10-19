// General-purpose, caller-planned research contracts (no model API fixtures).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import * as ds from "../scripts/ds_search.mjs";
import { processResults } from "../scripts/search_quality.mjs";
import { capture, stub, syncStub, withDeps } from "./helpers.mjs";

const row = (url, text, title = "Source") => ({ url, title, snippet: text, summary: text, content: text });
const queriesOf = (requestApi) => requestApi.calls.map((c) => c[1].query);

function withResultFile(contents, fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "double-search-"));
  const file = path.join(directory, "results.json");
  fs.writeFileSync(file, contents);
  return Promise.resolve(fn(file)).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

describe("agent workflow", () => {
  test("default does not guess a person filter or truth verdict", () => {
    const out = processResults([row("https://example.com/a", "竇唯 biography", "采访与婚姻")], "窦唯的简历");
    assert.equal(out.results.length, 1);
    assert.equal(out.quality.profile, "generic");
    assert.equal(out.facts_verified, false);
  });

  test("only caller queries execute even after three sources", async () => {
    const rows = [0, 1, 2].map((n) => row(`https://${n}.example/a`, String(n)));
    const requestApi = stub(() => [{ results: rows }, 1]);
    const out = await withDeps({ requestApi }, () =>
      ds.research("What is X?", "fixture", { queries: ["X limitations", "X first party examples"] }));
    assert.deepEqual(queriesOf(requestApi), ["What is X?", "X limitations", "X first party examples"]);
    assert.equal(out.planning.owner, "calling_agent");
    assert.equal(out.planning.automatic_query_expansion, false);
    assert.equal(out.budget.used, 3);
  });

  test("bare keyword does not trigger hidden expansion", async () => {
    const requestApi = stub(() => [{ results: [] }, 1]);
    const out = await withDeps({ requestApi }, () => ds.research("苹果", "fixture"));
    assert.equal(requestApi.calls.length, 1);
    assert.equal(out.planning.stop_reason, "plan_completed");
  });

  test("all queries validated before any paid request", async () => {
    const requestApi = stub();
    await withDeps({ requestApi }, async () => {
      for (const [queries, maxSearches] of [[["x".repeat(129)], 8], [["b", "c"], 2]]) {
        await assert.rejects(ds.research("a", "fixture", { queries, maxSearches }), ds.SearchError);
      }
    });
    assert.equal(requestApi.calls.length, 0);
  });

  test("duplicate queries do not consume budget twice", async () => {
    const requestApi = stub(() => [{ results: [] }, 1]);
    const out = await withDeps({ requestApi }, () => ds.research("a", "fixture", { queries: ["a", " b ", "b"], maxSearches: 2 }));
    assert.equal(requestApi.calls.length, 2);
    assert.deepEqual(out.planning.planned_queries, ["a", "b"]);
  });

  test("partial failure exposes remaining plan and spent budget", async () => {
    const requestApi = stub([[{ results: [row("https://a.example", "A")] }, 1], new ds.SearchError("failed", "network_error")]);
    const out = await withDeps({ requestApi }, () => ds.research("a", "fixture", { queries: ["b", "c"] }));
    assert.equal(out.complete, false);
    assert.deepEqual(out.planning.remaining_queries, ["b", "c"]);
    assert.equal(out.budget.used, 2);
  });

  test("generic duplicate keeps changed numeric and text evidence", () => {
    const a = row("https://example.com/a", "v2 supports 12 requests; released worldwide.");
    const b = row("https://example.com/a?utm_source=x", "v2 supports 8 requests; limited preview.");
    const out = processResults([a, b], "product limits");
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].alternates[0].variant.content, b.content);
  });

  test("merge is offline and preserves changed variants", () => {
    const merged = ds.mergeOutputs([{ results: [row("https://example.com/a", "API limit 12")] },
                                    { results: [row("https://example.com/a?utm_source=x", "API limit 8")] }], "API limits");
    const again = ds.mergeOutputs([merged], "API limits");
    assert.equal(again.results[0].alternates[0].variant.content, "API limit 8");
    assert.equal(again.quality.duplicate_count, 1);
  });

  test("merge cli needs no credentials or network", async () => {
    const loadKey = syncStub(), requestApi = stub();
    await withResultFile(JSON.stringify({ results: [row("https://example.com/a", "A")] }), async (file) => {
      const { result, out } = await withDeps({ loadKey, requestApi }, () => capture(() => ds.main(["merge", "topic", file])));
      assert.equal(result, 0);
      assert.equal(JSON.parse(out).operation, "merge");
    });
    assert.equal(loadKey.calls.length, 0);
    assert.equal(requestApi.calls.length, 0);
  });

  test("repeated merge does not hide upstream failure", () => {
    const partial = { results: [row("https://example.com/a", "A")], ok: false, complete: false, errors: [{ code: "network_error" }] };
    assert.equal(ds.mergeOutputs([ds.mergeOutputs([partial], "topic")], "topic").upstream_complete, false);
  });

  test("cli passes expansions without overwriting original", async () => {
    const requestApi = stub(() => [{ results: [] }, 1]);
    const { result } = await withDeps({ loadKey: syncStub(["fixture", "test"]), requestApi }, () =>
      capture(() => ds.main(["research", "original", "--query", "expanded", "--max-searches", "2"])));
    assert.equal(result, 0);
    assert.deepEqual(queriesOf(requestApi), ["original", "expanded"]);
  });

  test("bad merge input is reported without reading credentials", async () => {
    const loadKey = syncStub();
    await withResultFile("not-json", async (file) => {
      const { result, err } = await withDeps({ loadKey }, () => capture(() => ds.main(["merge", "topic", file])));
      assert.equal(result, 1);
      assert.equal(JSON.parse(err).error.code, "invalid_input");
    });
    assert.equal(loadKey.calls.length, 0);
  });

  test("missing merge file is a local io error", async () => {
    const { result, err } = await capture(() => ds.main(["merge", "topic", path.join(os.tmpdir(), "double-search-missing.json")]));
    assert.equal(result, 1);
    assert.equal(JSON.parse(err).error.code, "local_io_error");
  });

  test("malformed query metadata is rejected before merge", () => {
    const bad = { ...row("https://example.com/a", "A"), matched_queries: "wrong-type" };
    assert.throws(() => ds.mergeOutputs([{ results: [bad] }], "topic"), ds.SearchError);
  });

  test("queries are preserved as data", async () => {
    const query = "x; $(echo unsafe) `echo unsafe`";
    const requestApi = stub(() => [{ results: [] }, 1]);
    await withDeps({ requestApi }, () => ds.research("topic", "fixture", { queries: [query] }));
    assert.equal(requestApi.calls[1][1].query, query);
  });
});
