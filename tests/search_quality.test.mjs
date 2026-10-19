// Regression cases from the Dou Wei run plus unrelated boundary cases.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as ds from "../scripts/ds_search.mjs";
import { processResults } from "../scripts/search_quality.mjs";
import { stub, withDeps } from "./helpers.mjs";

const row = (url, title, text, authority = 3) =>
  ({ url, title, summary: text, snippet: text.slice(0, 100), content: text, date: null, authority, rerank_score: 2.0 });
const review = (rows, query = "窦唯的简历", options = {}) => processResults(rows, query, { profile: "auto", ...options });

describe("quality", () => {
  test("observed duplicate and gossip failure", () => {
    const out = review([
      row("https://baike.baidu.com/item/窦唯/156394#1", "窦唯", "1989年，窦唯加入黑豹乐队。"),
      row("https://baike.baidu.com/item/竇唯/156394?bst=123", "窦唯", "1989年，窦唯加入黑豹乐队。"),
      row("https://wapbaike.baidu.com/item/窦唯/156394?uid=123", "窦唯", "1989年，窦唯加入黑豹乐队。"),
      row("https://example.com/gossip", "王菲前夫窦唯近况曝光 两人为何离婚", "窦唯，1988年加入黑豹乐队。", 4),
    ]);
    assert.equal(out.results.length, 1);
    assert.equal(out.quality.duplicate_count, 2);
    assert.equal(out.quality.excluded_count, 1);
    assert.equal(out.quality.profile, "biography");
  });

  test("tracking removed but meaningful parameters preserved", () => {
    const rows = [row("https://example.com/a?id=1&utm_source=x#top", "文档", "A"),
                  row("https://example.com/a?id=1", "文档", "A"),
                  row("https://example.com/a?id=2", "文档", "B")];
    assert.equal(review(rows, "文档").results.length, 2);
  });

  test("wiki mirror is same origin", () => {
    const out = review([row("https://zh.wikipedia.org/wiki/窦唯", "窦唯", "1988年，窦唯加入黑豹乐队。"),
                        row("https://www.wikiwand.com/zh-cn/窦唯#1", "窦唯", "1988年，窦唯加入黑豹乐队。")]);
    assert.equal(out.quality.source_family_count, 1);
    assert.equal(out.results.length, 1);
  });

  test("percent-encoded wiki mirror matches the raw title", () => {
    const out = review([row("https://zh.wikipedia.org/wiki/窦唯", "窦唯", "A"),
                        row("https://www.wikiwand.com/zh/%E7%AA%A6%E5%94%AF", "窦唯", "B")]);
    assert.equal(out.results.length, 1);
  });

  test("copies do not count as corroboration", () => {
    const text = "林青的音乐经历。" + "1988年，林青加入晨光乐队，担任主唱并创作歌曲。".repeat(6);
    const out = review([row("https://a.example/a", "林青", text), row("https://b.example/b", "林青", text)], "林青的简历");
    assert.equal(out.results.length, 1);
    assert.equal(out.quality.source_family_count, 1);
  });

  test("different numbers in similar pages are not erased", () => {
    const text = "林青的音乐经历。" + "他学习音乐并持续创作，发行了多部作品。".repeat(12);
    const out = review([row("https://a.example/a", "林青", text + "1988年，林青加入晨光乐队。"),
                        row("https://b.example/b", "林青", text + "1989年，林青加入晨光乐队。")], "林青的简历");
    assert.equal(out.results.length, 2);
    assert.equal(out.conflicts.length, 1);
  });

  test("changed negation and reordered years are not near copies", () => {
    const base = "林青的音乐经历。" + "他学习音乐并持续创作，发行了多部作品。".repeat(12);
    for (const [a, b] of [["1988年林青加入晨光乐队。", "1988年林青没加入晨光乐队。"],
                          ["1988年加入晨光乐队，1989年离开。", "1989年加入晨光乐队，1988年离开。"]]) {
      const out = review([row("https://a.example/a", "林青", base + a), row("https://b.example/b", "林青", base + b)], "林青的简历");
      assert.equal(out.results.length, 2);
    }
  });

  test("duplicate versions keep conflicting evidence", () => {
    const out = review([row("https://a.example/a", "窦唯", "1988年，窦唯加入黑豹乐队。"),
                        row("https://a.example/a?utm_source=x", "窦唯", "1989年，窦唯加入黑豹乐队。")]);
    assert.equal(out.results.length, 1);
    assert.equal(out.conflicts[0].status, "unresolved");
    assert.deepEqual(new Set(out.conflicts[0].values), new Set(["1988", "1989"]));
  });

  test("subject filter does not keep same surname", () => {
    assert.deepEqual(review([row("https://example.com/a", "窦靖童简历", "窦靖童演艺经历")]).results, []);
  });

  test("alias supports translated names", () => {
    const out = review([row("https://example.com/a", "Dou Wei biography", "Dou Wei is a musician.")], undefined, { aliases: ["Dou Wei"] });
    assert.equal(out.results.length, 1);
  });

  test("gossip filter is intent scoped", () => {
    assert.equal(review([row("https://example.com/a", "窦唯为何离婚", "窦唯个人生活")], "窦唯为何离婚").results.length, 1);
    assert.equal(review([row("https://example.com/b", "窦唯访谈：婚姻与音乐生涯", "窦唯谈创作")]).results.length, 1);
  });

  test("score never decides conflicting year", () => {
    const conflict = review([row("https://a.example/a", "窦唯", "1988年，窦唯加入黑豹乐队。", 4),
                             row("https://b.example/b", "窦唯", "1989年，窦唯加入黑豹乐队。", 1)]).conflicts[0];
    assert.equal(conflict.status, "unresolved");
    assert.ok(conflict.verification_query);
    assert.ok(conflict.evidence.every((e) => e.evidence_level === "page_content"));
  });

  test("other people, negation and different events not conflated", () => {
    const out = review([row("https://a.example/a", "窦唯", "1988年，李明加入黑豹乐队。1989年，窦唯并未加入黑豹乐队。"),
                        row("https://b.example/b", "窦唯", "1994年，窦唯发行《黑梦》。1995年，窦唯发行《艳阳天》。")]);
    assert.equal(out.conflicts.length, 0);
    assert.ok(!out.facts.some((f) => f.event === "加入黑豹乐队"));
  });

  test("english unknown scope does not claim verified", () => {
    const out = review([row("https://example.com", "Product specs", "Weight is 20 kg, others say 25 kg.")], "product comparison");
    assert.equal(out.facts_verified, false);
    assert.ok(out.quality.fact_check_scope.includes("manual"));
  });

  test("bad urls are filtered without crash", () => {
    const out = review([row("javascript:alert(1)", "窦唯", "窦唯简历"), row("https://[oops", "窦唯", "窦唯简历")]);
    assert.equal(out.results.length, 0);
  });

  test("spa routes and ordered repeated query values remain distinct", () => {
    const urls = ["https://example.com/#/one", "https://example.com/#/two",
                  "https://example.com/?sort=a&sort=b", "https://example.com/?sort=b&sort=a"];
    assert.equal(review(urls.map((u) => row(u, "docs", "")), "docs").results.length, 4);
  });

  test("title alone does not deduplicate", () => {
    const out = review([row("https://a.example/a", "窦唯", "音乐生涯"), row("https://b.example/b", "窦唯", "作品目录")]);
    assert.equal(out.results.length, 2);
  });

  test("summary evidence and absence of conflict are not verification", () => {
    const r = row("https://example.com/a", "窦唯", "1988年，窦唯加入黑豹乐队。");
    r.content = "";
    const out = review([r]);
    assert.equal(out.facts[0].status, "unverified");
    assert.equal(out.facts[0].evidence[0].evidence_level, "search_summary");
    assert.equal(out.facts_verified, false);
  });

  test("mentions do not change the event subject", () => {
    assert.equal(review([row("https://example.com/a", "窦唯", "1988年，窦唯介绍李明加入黑豹乐队。")]).facts.length, 0);
  });

  test("year of signing is not year of later album release", () => {
    const out = review([row("https://example.com/a", "窦唯", "1993年，窦唯签约公司，先后推出了《黑梦》。1994年，窦唯发行《黑梦》。")]);
    assert.deepEqual(out.facts[0].values, ["1994"]);
    assert.equal(out.conflicts.length, 0);
  });

  test("clickbait and gossip index are filtered only in biography", () => {
    const rows = [row("https://example.com/a", "窦唯新闻_窦唯八卦", "窦唯生平"),
                  row("https://example.com/b", "采访说窦唯一唱歌分分钟都是钱", "窦唯")];
    assert.equal(review(rows).results.length, 0);
    assert.equal(review(rows, "窦唯的新闻").results.length, 2);
  });
});

describe("research", () => {
  test("explicit biography adapter retains conflicts without resolving", async () => {
    const a = row("https://a.example/a", "窦唯", "1988年，窦唯加入黑豹乐队。");
    const b = row("https://b.example/b", "窦唯", "1989年，窦唯加入黑豹乐队。");
    const requestApi = stub([[{ results: [a] }, 1], [{ results: [b] }, 1], [{ results: [a] }, 1]]);
    const out = await withDeps({ requestApi }, () => ds.research("窦唯的简历", "unit-test-key",
      { profile: "biography", queries: ["窦唯主要经历", "窦唯加入黑豹乐队时间采访"] }));
    assert.equal(requestApi.calls.length, 3);
    assert.equal(out.conflicts[0].status, "unresolved");
    assert.equal(out.facts_verified, false);
    assert.equal(out.complete, true);
  });

  test("partial failure keeps evidence and reports incomplete", async () => {
    const a = row("https://a.example/a", "窦唯", "音乐生涯");
    const requestApi = stub([[{ results: [a] }, 1], new ds.SearchError("network", "network_error")]);
    const out = await withDeps({ requestApi }, () => ds.research("窦唯的简历", "unit-test-key", { queries: ["窦唯作品"] }));
    assert.equal(out.ok, false);
    assert.equal(out.complete, false);
    assert.equal(out.results.length, 1);
    assert.equal(out.errors[0].code, "network_error");
  });

  test("executes single query when only one was supplied", async () => {
    const rows = [0, 1, 2].map((n) => row(`https://${n}.example/a`, "doc", String(n)));
    let requestApi = stub(() => [{ results: rows }, 1]);
    await withDeps({ requestApi }, () => ds.research("docs", "unit-test-key"));
    assert.equal(requestApi.calls.length, 1);
    requestApi = stub(() => [{ results: rows.slice(0, 1) }, 1]);
    await withDeps({ requestApi }, () => ds.research("docs", "unit-test-key", { maxSearches: 1 }));
    assert.equal(requestApi.calls.length, 1);
  });

  test("long query never silently truncates or repeats", async () => {
    const requestApi = stub(() => [{ results: [row("https://a.example/a", "doc", "doc")] }, 1]);
    const out = await withDeps({ requestApi }, () => ds.research("字".repeat(128), "unit-test-key"));
    assert.equal(requestApi.calls.length, 1);
    assert.equal(out.searches[0].query, "字".repeat(128));
  });

  test("invalid options do not send paid requests", async () => {
    const requestApi = stub();
    await withDeps({ requestApi }, async () => {
      for (const limit of [0, 9, true]) {
        await assert.rejects(ds.research("docs", "unit-test-key", { maxSearches: limit }), ds.SearchError);
      }
    });
    assert.equal(requestApi.calls.length, 0);
  });
});
