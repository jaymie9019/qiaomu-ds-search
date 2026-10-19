// Conservative result cleanup and candidate conflicts; never a truth oracle.
import { isIPv6 } from "node:net";

export const SCRIPT_INTERFACE = "internal-module";
const TRACKING = new Set(["fbclid", "gclid", "spm", "ref_src", "ref_url"]);
const BIO_QUERY = /^(.{1,40}?)(?:的)?(?:个人简历|简历|人物简介|个人简介|简介|生平|个人资料|年谱)[？?。 ]*$/u;
const GOSSIP = /前夫|前妻|离婚|绯闻|恋情|小三|情史|私生|出轨|八卦/u;
const CLICKBAIT = /你们不知道|分分钟都是钱|震惊|惊呆|万万没想到/u;
const CAREER = /简历|简介|生平|年谱|生涯|作品|访谈|采访|创作/u;
const YEAR = /(?<!\d)((?:18|19|20)\d{2})年(?:\d{1,2}月)?(?:\d{1,2}日)?/gu;
const JOIN = /加入(?:了)?[“"「]?([^，。；;！？\n《》“”"「」]{2,20}?(?:乐队|公司|团队|大学|实验室))[”"」]?/u;
const RELEASE = /(?:发行|推出|出版)[^，。；;！？\n]{0,25}?《([^》\n]{1,40})》/u;
const NEGATION = /未|没|不|无|非|否认/u;
const NEGATION_ALL = /未|没|不|无|非|否认/gu;
const SCHEME_CHARS = /^[A-Za-z][A-Za-z0-9+.-]*$/;
const ALWAYS_SAFE = /[A-Za-z0-9_.~-]/;

// Truncate by Unicode code points, not UTF-16 units.
const head = (text, n) => Array.from(text).slice(0, n).join("");

export function normalized(text) {
  // Approximates Unicode casefold (e.g. ß -> ss) on top of NFKC.
  return text.normalize("NFKC").toUpperCase().toLowerCase();
}

export function unquote(text) {
  // Decode valid %XX runs as UTF-8, replacing invalid bytes like Python's unquote.
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = Uint8Array.from(run.match(/%[0-9A-Fa-f]{2}/g), (h) => parseInt(h.slice(1), 16));
    return new TextDecoder("utf-8").decode(bytes);
  });
}

function quotePlus(text) {
  let out = "";
  for (const byte of new TextEncoder().encode(text)) {
    const c = String.fromCharCode(byte);
    out += byte === 0x20 ? "+" : byte < 0x80 && ALWAYS_SAFE.test(c) ? c : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function parseQsl(query) {
  const pairs = [];
  for (const part of query.split("&")) {
    if (!part) continue;
    const at = part.indexOf("=");
    const [k, v] = at < 0 ? [part, ""] : [part.slice(0, at), part.slice(at + 1)];
    pairs.push([unquote(k.replace(/\+/g, " ")), unquote(v.replace(/\+/g, " "))]);
  }
  return pairs;
}

/** RFC 3986-style split mirroring Python's urllib.parse.urlsplit; throws on malformed authority. */
export function urlsplit(url) {
  let scheme = "", rest = url;
  const colon = url.indexOf(":");
  if (colon > 0 && SCHEME_CHARS.test(url.slice(0, colon))) {
    scheme = url.slice(0, colon).toLowerCase();
    rest = url.slice(colon + 1);
  }
  let netloc = "";
  if (rest.startsWith("//")) {
    const end = rest.slice(2).search(/[/?#]/);
    netloc = end < 0 ? rest.slice(2) : rest.slice(2, end + 2);
    rest = end < 0 ? "" : rest.slice(end + 2);
    if (netloc.includes("[") !== netloc.includes("]")) throw new Error("Invalid IPv6 URL");
  }
  let fragment = "", query = "";
  if (rest.includes("#")) [rest, fragment] = [rest.slice(0, rest.indexOf("#")), rest.slice(rest.indexOf("#") + 1)];
  if (rest.includes("?")) [rest, query] = [rest.slice(0, rest.indexOf("?")), rest.slice(rest.indexOf("?") + 1)];
  const hasUserinfo = netloc.includes("@");
  const hostinfo = netloc.slice(netloc.lastIndexOf("@") + 1);
  let hostname, port;
  if (hostinfo.includes("[")) {
    const bracketed = hostinfo.slice(hostinfo.indexOf("[") + 1);
    hostname = bracketed.slice(0, bracketed.indexOf("]"));
    const after = bracketed.slice(bracketed.indexOf("]") + 1);
    port = after.includes(":") ? after.slice(after.indexOf(":") + 1) : "";
    if (!isIPv6(hostname)) throw new Error("Invalid IPv6 URL");
  } else {
    const at = hostinfo.indexOf(":");
    [hostname, port] = at < 0 ? [hostinfo, ""] : [hostinfo.slice(0, at), hostinfo.slice(at + 1)];
  }
  if (port && (!/^\d+$/.test(port) || Number(port) > 65535)) throw new Error("Invalid port");
  return { scheme, netloc, path: rest, query, fragment, hasUserinfo,
           hostname: hostname ? hostname.toLowerCase() : null, port: port ? Number(port) : null };
}

/** Return [canonical URL, conservative source family], or null. */
export function identity(url) {
  let p;
  try {
    if (typeof url !== "string" || /[\s\u0000-\u001f]/u.test(url)) return null;
    p = urlsplit(url);
  } catch {
    return null;
  }
  if (!["http", "https"].includes(p.scheme) || !p.hostname || p.hasUserinfo) return null;
  const host = p.hostname;
  let netloc = host.includes(":") ? "[" + host + "]" : host;
  if (p.port !== null && !((p.scheme === "http" && p.port === 80) || (p.scheme === "https" && p.port === 443))) {
    netloc += ":" + p.port;
  }
  const path = p.path || "/";
  try {
    // Known entity IDs/mirrors, not a general assumption about mobile sites.
    const baidu = path.match(/^\/item\/[^/]+\/(\d+)\/?$/);
    if (["baike.baidu.com", "wapbaike.baidu.com"].includes(host) && baidu) {
      return ["https://baike.baidu.com/item/" + baidu[1], "baike.baidu.com"];
    }
    if (["wikiwand.com", "www.wikiwand.com"].includes(host) && (path.startsWith("/zh-cn/") || path.startsWith("/zh/"))) {
      return ["https://zh.wikipedia.org/wiki/" + unquote(path.slice(path.indexOf("/", 1) + 1)), "zh.wikipedia.org"];
    }
    if (host === "zh.wikipedia.org" && path.startsWith("/wiki/") && !p.query) {
      return ["https://zh.wikipedia.org" + unquote(path), host];
    }
    const query = parseQsl(p.query).filter(([k]) => !k.toLowerCase().startsWith("utm_") && !TRACKING.has(k.toLowerCase()));
    query.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const encoded = query.map(([k, v]) => quotePlus(k) + "=" + quotePlus(v)).join("&");
    // Preserve hash-router destinations and meaningful parameters such as id/page/version.
    const fragment = p.fragment.startsWith("/") || p.fragment.startsWith("!/") ? p.fragment : "";
    return [p.scheme + "://" + netloc + path + (encoded ? "?" + encoded : "") + (fragment ? "#" + fragment : ""), host];
  } catch {
    return null;  // e.g. lone surrogates that cannot be percent-encoded.
  }
}

export function profileFor(query, profile = "generic", subject = null) {
  const match = query.trim().match(BIO_QUERY);
  if (profile === "auto") profile = match ? "biography" : "generic";
  if (subject == null && match && profile === "biography") {
    subject = match[1].endsWith("的") ? match[1].slice(0, -1) : match[1];
  }
  return [profile, subject ?? null];
}

function fingerprint(row) {
  // A bounded prefix keeps processing time/memory predictable for large API pages.
  const body = head(row.content ?? "", 24000);
  const chars = Array.from(normalized(body)).filter((c) => /[\p{L}\p{N}]/u.test(c));
  const text = chars.join("");
  const grams = new Set();
  for (let i = 0; i < Math.max(0, chars.length - 4); i++) grams.add(chars.slice(i, i + 5).join(""));
  return { text, length: chars.length, numbers: text.match(/\p{Nd}+(?:[.,]\p{Nd}+)*/gu) ?? [],
           negations: new Set(text.match(NEGATION_ALL) ?? []), grams };
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));

function nearCopy(a, b) {
  const [x, y] = [a.length, b.length];
  if (Math.min(x, y) < 120 || Math.min(x, y) / Math.max(x, y) < 0.9) return false;
  // Preserve changed numbers and negation for fact review.
  if (!sameList(a.numbers, b.numbers) || !sameSet(a.negations, b.negations)) return false;
  let shared = 0;
  for (const g of a.grams) if (b.grams.has(g)) shared++;
  return shared / Math.max(1, a.grams.size + b.grams.size - shared) >= 0.94;
}

/** Narrow Chinese biography year/event adapter; other claims need agent review. */
export function candidateFacts(row, subject, aliases) {
  if (!subject) return [];
  let body = row.content || row.summary || row.snippet || "";
  const level = row.content ? "page_content" : "search_summary";
  // Remove Markdown link targets while preserving visible text.
  body = body.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const names = [subject, ...aliases];
  const attributed = names.some((n) => (row.title ?? "").includes(n) || body.trimStart().startsWith(n));
  const claims = [];
  for (const sentence of body.split(/[。！？;；\n]/u)) {
    const years = [...sentence.matchAll(YEAR)];
    years.forEach((year, i) => {
      const yearEnd = year.index + year[0].length;
      const end = i + 1 < years.length ? years[i + 1].index : sentence.length;
      const segment = head(sentence.slice(yearEnd, end), 100);
      for (const [pattern, kind] of [[JOIN, "加入"], [RELEASE, "发行"]]) {
        const event = segment.match(pattern);
        if (!event) continue;
        const prefix = segment.slice(0, event.index);
        if (NEGATION.test(prefix)) continue;
        // Only explicit subject or a short implicit-subject clause. Do not
        // attribute another named person's event to the page subject.
        const plain = prefix.replace(/[\s，,:：*-]/gu, "");
        const implicit = ["", "他", "她", "其", "正式", "他正式", "她正式"];
        const explicit = names.some((n) => plain === n || plain === n + "正式");
        if (!explicit && (!attributed || !implicit.includes(plain))) continue;
        const label = kind + (kind === "加入" ? event[1] : "《" + event[1] + "》");
        claims.push({ event: label, value: year[1], url: row.url, source_family: row.source_family,
                      evidence_level: level,
                      excerpt: head(sentence.slice(year.index, yearEnd + event.index + event[0].length), 120) });
      }
    });
  }
  return claims;
}

export function processResults(rows, query, { subject = null, aliases = [], profile = "generic", excludeTerms = [] } = {}) {
  aliases ??= [];
  excludeTerms ??= [];
  [profile, subject] = profileFor(query, profile, subject);
  const names = (subject ? [subject] : []).concat(aliases).map(normalized);
  const kept = [], eligible = [], duplicates = [], excluded = [], prints = [];
  for (const original of rows) {
    const row = { ...original };
    const ids = identity(row.url ?? "");
    const text = normalized(["title", "summary", "snippet", "content"].map((k) => row[k] ?? "").join(" "));
    let reason = null;
    if (!ids) reason = "invalid_url";
    else if (names.length && !names.some((n) => text.includes(n))) reason = "subject_not_found";
    else if (excludeTerms.some((term) => text.includes(normalized(term)))) reason = "excluded_term";
    else if (profile === "biography" && CLICKBAIT.test(row.title ?? "")) reason = "off_topic_clickbait_title";
    else if (profile === "biography" && GOSSIP.test(row.title ?? "") && !CAREER.test(row.title ?? "")) {
      reason = "off_topic_personal_life_title";
    }
    if (reason) {
      excluded.push({ url: row.url ?? null, title: row.title ?? null, reason });
      continue;
    }
    [row.canonical_url, row.source_family] = ids;
    const fp = fingerprint(row);
    let match = kept.findIndex((k) => k.canonical_url === ids[0]);
    let method = "canonical_url";
    if (match < 0) {
      match = prints.findIndex((other) => nearCopy(fp, other));
      method = "near_identical_content";
    }
    if (match >= 0) {
      const representative = kept[match];
      row.source_family = representative.source_family;
      const duplicate = { url: row.url, kept_url: representative.url, reason: method,
                          changed_numbers: !sameList(fp.numbers, prints[match].numbers) };
      // The calling model must be able to inspect changed evidence in any
      // subject/language, including claims outside the biography adapter.
      const fields = ["title", "snippet", "summary", "content", "date", "matched_queries"];
      if (["content", "summary", "snippet"].some((k) => row[k] !== representative[k])) {
        duplicate.variant = Object.fromEntries(fields.filter((k) => k in row).map((k) => [k, row[k]]));
      }
      const queries = [...new Set([...(representative.matched_queries ?? []), ...(row.matched_queries ?? [])])];
      if (queries.length) representative.matched_queries = queries;
      duplicates.push(duplicate);
      (representative.alternates ??= []).push(duplicate);
    } else {
      kept.push(row);
      prints.push(fp);
    }
    eligible.push(row);  // Duplicate variants can still contain contradictory claims.
  }
  const grouped = new Map();
  if (profile === "biography") {
    for (const row of eligible) {
      for (const fact of candidateFacts(row, subject, aliases)) {
        if (!grouped.has(fact.event)) grouped.set(fact.event, []);
        const records = grouped.get(fact.event);
        if (!records.some((r) => JSON.stringify(r) === JSON.stringify(fact))) records.push(fact);
      }
    }
  }
  const facts = [], conflicts = [];
  for (const [event, evidence] of grouped) {
    const values = [...new Set(evidence.map((e) => e.value))].sort();
    const fact = { subject, event, values, status: values.length > 1 ? "unresolved" : "unverified", evidence,
                   source_family_count: new Set(evidence.map((e) => e.source_family)).size };
    facts.push(fact);
    if (values.length > 1) conflicts.push({ ...fact, verification_query: `${subject} ${event} 时间 采访` });
  }
  return { results: kept, quality: {
    input_count: rows.length, kept_count: kept.length, duplicate_count: duplicates.length,
    excluded_count: excluded.length, source_family_count: new Set(kept.map((r) => r.source_family)).size,
    profile, subject, duplicates, excluded,
    fact_check_scope: profile === "biography" ? "Chinese biography year/event candidates only; manual review required"
      : "Semantic relevance, coverage and factual conflicts require manual review by the calling agent",
    source_family_note: "Conservative URL/copy grouping; distinct hosts do not prove independent reporting." },
    facts, conflicts, facts_verified: false };
}
