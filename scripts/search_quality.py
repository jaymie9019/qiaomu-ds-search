"""Conservative result cleanup and candidate conflicts; never a truth oracle."""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit, unquote

SCRIPT_INTERFACE = "internal-module"
TRACKING = {"fbclid", "gclid", "spm", "ref_src", "ref_url"}
BIO_QUERY = re.compile(r"^(.{1,40}?)(?:的)?(?:个人简历|简历|人物简介|个人简介|简介|生平|个人资料|年谱)[？?。 ]*$")
GOSSIP = re.compile(r"前夫|前妻|离婚|绯闻|恋情|小三|情史|私生|出轨|八卦")
CLICKBAIT = re.compile(r"你们不知道|分分钟都是钱|震惊|惊呆|万万没想到")
CAREER = re.compile(r"简历|简介|生平|年谱|生涯|作品|访谈|采访|创作")
YEAR = re.compile(r"(?<!\d)((?:18|19|20)\d{2})年(?:\d{1,2}月)?(?:\d{1,2}日)?")
JOIN = re.compile(r"加入(?:了)?[“\"「]?([^，。；;！？\n《》“”\"「」]{2,20}?(?:乐队|公司|团队|大学|实验室))[”\"」]?")
RELEASE = re.compile(r"(?:发行|推出|出版)[^，。；;！？\n]{0,25}?《([^》\n]{1,40})》")
NEGATION = re.compile(r"未|没|不|无|非|否认")


def normalized(text):
    return unicodedata.normalize("NFKC", text).casefold()


def identity(url):
    """Return canonical URL and a conservative source family, or None."""
    try:
        p = urlsplit(url)
        if (p.scheme not in ("http", "https") or not p.hostname or p.username is not None
                or p.password is not None or any(c.isspace() or ord(c) < 32 for c in url)):
            return None
        port = p.port
    except (ValueError, TypeError):
        return None
    host = p.hostname.lower()
    netloc = "[" + host + "]" if ":" in host else host
    if port is not None and (p.scheme, port) not in (("http", 80), ("https", 443)):
        netloc += ":" + str(port)
    path = p.path or "/"
    # Known entity IDs/mirrors, not a general assumption about mobile sites.
    baidu = re.match(r"^/item/[^/]+/(\d+)/?$", path)
    if host in ("baike.baidu.com", "wapbaike.baidu.com") and baidu:
        return "https://baike.baidu.com/item/" + baidu[1], "baike.baidu.com"
    if host in ("wikiwand.com", "www.wikiwand.com") and path.startswith(("/zh-cn/", "/zh/")):
        return "https://zh.wikipedia.org/wiki/" + unquote(path.split("/", 2)[2]), "zh.wikipedia.org"
    if host == "zh.wikipedia.org" and path.startswith("/wiki/") and not p.query:
        return "https://zh.wikipedia.org" + unquote(path), host
    query = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in TRACKING]
    # Preserve hash-router destinations and meaningful parameters such as id/page/version.
    fragment = p.fragment if p.fragment.startswith(("/", "!/")) else ""
    return urlunsplit((p.scheme, netloc, path, urlencode(sorted(query, key=lambda kv: kv[0])), fragment)), host


def profile_for(query, profile="generic", subject=None):
    match = BIO_QUERY.fullmatch(query.strip())
    if profile == "auto":
        profile = "biography" if match else "generic"
    if subject is None and match and profile == "biography":
        subject = match[1][:-1] if match[1].endswith("的") else match[1]
    return profile, subject


def fingerprint(row):
    # A bounded prefix keeps processing time/memory predictable for large API pages.
    body = row.get("content", "")[:24000]
    text = "".join(c for c in normalized(body) if c.isalnum())
    return (text, tuple(re.findall(r"\d+(?:[.,]\d+)*", text)),
            set(NEGATION.findall(text)), {text[i:i+5] for i in range(max(0, len(text)-4))})


def near_copy(a, b):
    x, y = a[0], b[0]
    if min(len(x), len(y)) < 120 or min(len(x), len(y)) / max(len(x), len(y)) < .9:
        return False
    if a[1:3] != b[1:3]:  # Preserve changed numbers and negation for fact review.
        return False
    return len(a[3] & b[3]) / max(1, len(a[3] | b[3])) >= .94


def candidate_facts(row, subject, aliases):
    """Narrow Chinese biography year/event adapter; other claims need agent review."""
    if not subject:
        return []
    body = row.get("content") or row.get("summary") or row.get("snippet", "")
    level = "page_content" if row.get("content") else "search_summary"
    # Remove Markdown link targets while preserving visible text.
    body = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", body)
    names = [subject] + list(aliases)
    attributed = any(n in row.get("title", "") or body.lstrip().startswith(n) for n in names)
    claims = []
    for sentence in re.split(r"[。！？;；\n]", body):
        years = list(YEAR.finditer(sentence))
        for i, year in enumerate(years):
            end = years[i+1].start() if i+1 < len(years) else len(sentence)
            segment = sentence[year.end():end][:100]
            for pattern, kind in ((JOIN, "加入"), (RELEASE, "发行")):
                event = pattern.search(segment)
                if not event:
                    continue
                prefix = segment[:event.start()]
                if NEGATION.search(prefix):
                    continue
                # Only explicit subject or a short implicit-subject clause. Do not
                # attribute another named person's event to the page subject.
                plain = re.sub(r"[\s，,:：*\-]", "", prefix)
                implicit = ("", "他", "她", "其", "正式", "他正式", "她正式")
                explicit = any(plain in (n, n + "正式") for n in names)
                if not explicit and (not attributed or plain not in implicit):
                    continue
                label = kind + (event[1] if kind == "加入" else "《" + event[1] + "》")
                claims.append({"event": label, "value": year[1], "url": row["url"],
                               "source_family": row["source_family"], "evidence_level": level,
                               "excerpt": sentence[year.start():year.end()+event.end()][:120]})
    return claims


def process_results(rows, query, subject=None, aliases=None, profile="generic", exclude_terms=None):
    aliases, exclude_terms = aliases or [], exclude_terms or []
    profile, subject = profile_for(query, profile, subject)
    names = [normalized(n) for n in ([subject] if subject else []) + aliases]
    kept, eligible, duplicates, excluded, prints = [], [], [], [], []
    for original in rows:
        row = dict(original)
        ids = identity(row.get("url", ""))
        text = normalized(" ".join(row.get(k, "") for k in ("title", "summary", "snippet", "content")))
        reason = None
        if not ids:
            reason = "invalid_url"
        elif names and not any(n in text for n in names):
            reason = "subject_not_found"
        elif any(normalized(term) in text for term in exclude_terms):
            reason = "excluded_term"
        elif profile == "biography" and CLICKBAIT.search(row.get("title", "")):
            reason = "off_topic_clickbait_title"
        elif profile == "biography" and GOSSIP.search(row.get("title", "")) and not CAREER.search(row.get("title", "")):
            reason = "off_topic_personal_life_title"
        if reason:
            excluded.append({"url": row.get("url"), "title": row.get("title"), "reason": reason})
            continue
        row["canonical_url"], row["source_family"] = ids
        fp = fingerprint(row)
        match = next((i for i, k in enumerate(kept) if k["canonical_url"] == ids[0]), None)
        method = "canonical_url"
        if match is None:
            match = next((i for i, other in enumerate(prints) if near_copy(fp, other)), None)
            method = "near_identical_content"
        if match is not None:
            representative = kept[match]
            row["source_family"] = representative["source_family"]
            duplicate = {"url": row["url"], "kept_url": representative["url"], "reason": method,
                         "changed_numbers": fp[1] != prints[match][1]}
            # The calling model must be able to inspect changed evidence in any
            # subject/language, including claims outside the biography adapter.
            fields = ("title", "snippet", "summary", "content", "date", "matched_queries")
            if any(row.get(k) != representative.get(k) for k in ("content", "summary", "snippet")):
                duplicate["variant"] = {k: row[k] for k in fields if k in row}
            queries = list(dict.fromkeys(representative.get("matched_queries", []) + row.get("matched_queries", [])))
            if queries:
                representative["matched_queries"] = queries
            duplicates.append(duplicate)
            representative.setdefault("alternates", []).append(duplicate)
        else:
            kept.append(row)
            prints.append(fp)
        eligible.append(row)  # Duplicate variants can still contain contradictory claims.
    grouped = {}
    if profile == "biography":
        for row in eligible:
            for fact in candidate_facts(row, subject, aliases):
                records = grouped.setdefault(fact["event"], [])
                if fact not in records:
                    records.append(fact)
    facts, conflicts = [], []
    for event, evidence in grouped.items():
        values = sorted({e["value"] for e in evidence})
        fact = {"subject": subject, "event": event, "values": values,
                "status": "unresolved" if len(values) > 1 else "unverified", "evidence": evidence,
                "source_family_count": len({e["source_family"] for e in evidence})}
        facts.append(fact)
        if len(values) > 1:
            conflicts.append({**fact, "verification_query": f"{subject} {event} 时间 采访"})
    return {"results": kept, "quality": {
        "input_count": len(rows), "kept_count": len(kept), "duplicate_count": len(duplicates),
        "excluded_count": len(excluded), "source_family_count": len({r["source_family"] for r in kept}),
        "profile": profile, "subject": subject, "duplicates": duplicates, "excluded": excluded,
        "fact_check_scope": ("Chinese biography year/event candidates only; manual review required" if profile == "biography"
                             else "Semantic relevance, coverage and factual conflicts require manual review by the calling agent"),
        "source_family_note": "Conservative URL/copy grouping; distinct hosts do not prove independent reporting."},
        "facts": facts, "conflicts": conflicts, "facts_verified": False}
