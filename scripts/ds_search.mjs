#!/usr/bin/env node
// DeepSeek Search / Fetch CLI. Node.js 18+ built-ins only; no chat model calls.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { processResults, urlsplit } from "./search_quality.mjs";

export const VERSION = "1.0.0";
export const API_BASE = "https://api.deepseek.com/v1/tools";
export const KEYS_URL = "https://platform.deepseek.com/api_keys";
export const DOCS_URL = "https://api-docs.deepseek.com/guides/search/";
const MAX_BYTES = 16 * 1024 * 1024;
const POSIX = process.platform !== "win32";

export class SearchError extends Error {
  constructor(message, code = "request_failed", status = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class CancelledError extends Error {}
class UsageError extends Error {}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const codePoints = (text) => Array.from(text).length;

export function configPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  if (!path.isAbsolute(base)) throw new SearchError("XDG_CONFIG_HOME 必须为绝对路径。", "invalid_config");
  return path.join(base, "double-search", "credentials.json");
}

export function validateKey(key) {
  key = typeof key === "string" ? key.trim() : "";
  if (!key || /\s/u.test(key) || !/^[\x00-\x7f]*$/.test(key)) {
    throw new SearchError("API Key 为空或含非法空白/字符，请重新复制。", "invalid_key");
  }
  return key;
}

const isSymlink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

export function loadKey() {
  if ((process.env.DEEPSEEK_API_KEY ?? "").trim()) return [validateKey(process.env.DEEPSEEK_API_KEY), "environment"];
  const file = configPath();
  if (isSymlink(file) || isSymlink(path.dirname(file))) throw new SearchError("凭据文件或专用目录不能是符号链接。", "unsafe_config");
  if (!fs.existsSync(file)) throw new SearchError(`尚未配置 API Key。运行 setup 引导创建与配置：${KEYS_URL}`, "missing_api_key");
  if (POSIX && (fs.statSync(file).mode & 0o077)) throw new SearchError(`凭据权限过宽，请运行 chmod 600 '${file}'。`, "unsafe_config");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    data = null;
  }
  if (!isObject(data) || typeof data.api_key !== "string") throw new SearchError("凭据文件损坏，请重新运行 setup。", "invalid_config");
  return [validateKey(data.api_key), "config_file"];
}

export function saveKey(key) {
  key = validateKey(key);
  const file = configPath();
  const dir = path.dirname(file);
  if (isSymlink(file) || isSymlink(dir)) throw new SearchError("拒绝向符号链接保存凭据。", "unsafe_config");
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if (POSIX) fs.chmodSync(dir, 0o700);
  const temporary = path.join(dir, ".credentials-" + randomBytes(8).toString("hex"));
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify({ api_key: key }) + "\n");
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return file;
}

export function validateText(value, field) {
  if (typeof value !== "string" || !value.trim() || codePoints(value) > 128) {
    throw new SearchError(`${field} 必须为 1–128 个 Unicode 字符，且不能全为空白。`, "invalid_input");
  }
  return value;
}

export function searchPayload(query, count = 5, needContent = false, oriQuestion = null, localization = null) {
  validateText(query, "query");
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new SearchError("count 必须为 1–50 的整数。", "invalid_input");
  const data = { query, count, need_content: needContent };
  if (oriQuestion != null) data.ori_question = validateText(oriQuestion, "ori_question");
  if (localization != null) {
    if (!isIP(localization)) throw new SearchError("localization 必须为 IP 地址；不要填国家名称。", "invalid_input");
    data.localization = localization;
  }
  return data;
}

export function fetchPayload(url) {
  let valid = false;
  try {
    // urlsplit also rejects malformed ports and brackets before a paid request.
    const parsed = urlsplit(url);
    valid = codePoints(url) <= 8192 && ["http", "https"].includes(parsed.scheme) && Boolean(parsed.hostname)
      && !parsed.hasUserinfo && !/[\s\u0000-\u001f]/u.test(url);
  } catch {
    valid = false;
  }
  if (!valid) throw new SearchError("URL 必须是最多 8192 字符、含主机且不含账号密码的 HTTP(S) 地址。", "invalid_input");
  return { url };
}

export function errorForStatus(status) {
  const messages = {
    400: "请求参数无效，请核对 query/count/URL。",
    401: "API Key 无效或已撤销；运行 setup 重新配置。环境变量优先于配置文件。",
    402: "DeepSeek 账户余额不足；请在官方平台检查余额，充值由用户自行决定。",
    403: "Fetch 被安全策略拒绝；请更换公开来源，不要绕过限制。",
    404: "Fetch 未取得可用正文；页面可能不可用、受站点限制或无可提取内容。",
    408: "请求超时。",
    413: "请求体过大，请缩短输入。",
    429: "达到 Search/Fetch 限流；请稍后重试，多个进程共享账户限额。",
  };
  return new SearchError(messages[status] ?? "DeepSeek 服务暂时不可用或返回了意外 HTTP 状态。", "http_error", status);
}

async function readCapped(response) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new SearchError("响应超过 16 MiB 安全上限，请减少结果或关闭 need_content。", "response_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const retryable = (status) => status === 408 || status === 429 || (status >= 500 && status <= 599);

export async function requestApi(operation, payload, key, { timeout = 30, retries = 2, fetchImpl, sleep: wait } = {}) {
  if (!["search", "fetch"].includes(operation)) throw new SearchError("不支持的操作。", "invalid_input");
  fetchImpl ??= deps.fetch;
  wait ??= deps.sleep;
  const init = {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { Authorization: "Bearer " + validateKey(key), "Content-Type": "application/json",
               "User-Agent": `double-search/${VERSION}` },
    redirect: "manual",  // Never forward Bearer credentials to a redirect destination.
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    let delay = Math.min(2 ** attempt + Math.random(), 10);
    let raw = null, status = null, retryAfter = "";
    try {
      const response = await fetchImpl(API_BASE + "/" + operation, { ...init, signal: AbortSignal.timeout(timeout * 1000) });
      status = response.status;
      if (status === 200) {
        raw = await readCapped(response);
      } else {
        retryAfter = response.headers?.get?.("retry-after") ?? "";
        // Do not echo provider error bodies: they may contain sensitive input.
        await response.body?.cancel?.().catch(() => {});
      }
    } catch (error) {
      if (error instanceof SearchError) throw error;
      if (attempt === retries) throw new SearchError("网络或 TLS 连接失败/超时，请检查网络后重试。", "network_error");
      await wait(delay);
      continue;
    }
    if (status === 200) {
      let result;
      try {
        result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      } catch {
        throw new SearchError("API 返回的内容不是有效 JSON。", "invalid_response");
      }
      validateResponse(operation, result);
      return [result, attempt + 1];
    }
    if (!retryable(status) || attempt === retries) throw errorForStatus(status);
    const header = retryAfter.trim();
    if (header && !Number.isNaN(Number(header))) {
      if (Number(header) > 10) throw new SearchError("服务要求等待超过 10 秒；本次停止，请稍后重试。", "retry_later", status);
      delay = Math.max(delay, Number(header));
    }
    await wait(delay);
  }
}

export function validateResponse(operation, result) {
  let valid = isObject(result);
  if (operation === "search") {
    valid = valid && Array.isArray(result.results) && result.results.every((r) => isObject(r)
      && ["title", "url", "snippet", "summary", "content"].every((k) => typeof r[k] === "string")
      && (!("matched_queries" in r) || (Array.isArray(r.matched_queries)
        && r.matched_queries.every((q) => typeof q === "string"))));
  } else {
    valid = valid && typeof result.title === "string" && typeof result.content === "string";
  }
  if (!valid) throw new SearchError("API 响应结构与官方 Search/Fetch 契约不符。", "invalid_response");
}

export function envelope(operation, payload, response, attempts) {
  const empty = operation === "search" ? !response.results.length : !response.content.trim();
  return { ok: true, provider: "deepseek", operation, retrieved_at: new Date().toISOString().replace("Z", "+00:00"),
           request: payload, attempts, empty, ...response };
}

export async function doctor(key, source, timeout = 30) {
  const payload = searchPayload("DeepSeek site:api-docs.deepseek.com", 1);
  const [response, attempts] = await deps.requestApi("search", payload, key, { timeout, retries: 0 });
  const nonempty = response.results.length > 0;
  return { ok: nonempty, configured: true, credential_source: source, search_verified: nonempty, http_200: true,
           result_count: response.results.length, attempts,
           message: nonempty ? "搜索实测成功。" : "接口已响应，但结果为空；尚未验证有效搜索结果。" };
}

export function researchPlan(query, queries = null, maxSearches = 8) {
  if (!Number.isInteger(maxSearches) || maxSearches < 1 || maxSearches > 8) throw new SearchError("max-searches 必须为 1–8。", "invalid_input");
  if (queries != null && (!Array.isArray(queries) || !queries.every((q) => typeof q === "string"))) {
    throw new SearchError("queries 必须为字符串列表。", "invalid_input");
  }
  const plan = [];
  for (const value of [query, ...(queries ?? [])]) {
    const trimmed = validateText(value, "query").trim();
    if (!plan.includes(trimmed)) plan.push(trimmed);
  }
  if (plan.length > maxSearches) throw new SearchError("查询计划超过本轮预算；请减少查询或明确调整 max-searches。", "budget_exceeded");
  return plan;
}

/** Execute only the caller's plan; semantic planning stays with the agent. */
export async function research(query, key, { count = 5, maxSearches = 8, timeout = 30, retries = 2, queries = null, ...qualityOptions } = {}) {
  const plan = researchPlan(query, queries, maxSearches);
  const payload = searchPayload(plan[0], count, true);
  const rows = [], searches = [], errors = [];
  for (const [index, currentQuery] of plan.entries()) {
    const current = searchPayload(currentQuery, count, true);
    const purpose = index === 0 ? "original" : "agent_expansion";
    let response, attempts;
    try {
      [response, attempts] = await deps.requestApi("search", current, key, { timeout, retries });
    } catch (error) {
      if (!(error instanceof SearchError) || !searches.length) throw error;
      errors.push({ query: currentQuery, purpose, code: error.code, message: error.message, http_status: error.status });
      break;
    }
    searches.push({ query: currentQuery, purpose, attempts, result_count: response.results.length });
    rows.push(...response.results.map((r) => ({ ...r, matched_queries: [currentQuery] })));
  }
  const reviewed = processResults(rows, query, qualityOptions);
  const used = searches.length + errors.length;
  return { ...envelope("search", payload, reviewed, searches.reduce((sum, s) => sum + s.attempts, 0)),
           operation: "research", ok: !errors.length, complete: !errors.length, searches, errors,
           planning: { owner: "calling_agent", automatic_query_expansion: false, planned_queries: plan,
                       remaining_queries: plan.slice(searches.length),
                       stop_reason: errors.length ? "request_failed" : "plan_completed" },
           budget: { scope: "this_batch", limit: maxSearches, used, remaining: maxSearches - used, retries_per_request: retries },
           verification: { final_resolution: "manual_review_required" } };
}

/** Offline merge of saved batches, retaining alternate source evidence. */
export function mergeOutputs(documents, query, qualityOptions = {}) {
  const rows = [], upstream = [];
  for (const document of documents) {
    validateResponse("search", document);
    const complete = "upstream_complete" in document ? document.upstream_complete
      : "complete" in document ? document.complete : "ok" in document ? document.ok : true;
    upstream.push({ complete, searches: document.searches ?? [], errors: document.errors ?? [], quality: document.quality ?? {} });
    for (const item of document.results) {
      const { alternates = [], ...base } = item;
      rows.push(base);
      if (!Array.isArray(alternates)) throw new SearchError("结果中的 alternates 必须为列表。", "invalid_input");
      for (const alternate of alternates) {
        if (!isObject(alternate) || typeof alternate.url !== "string") throw new SearchError("无效的重复来源记录。", "invalid_input");
        const variant = alternate.variant ?? {};
        if (!isObject(variant)) throw new SearchError("无效的来源版本记录。", "invalid_input");
        const evidence = Object.fromEntries(["title", "snippet", "summary", "content", "date", "matched_queries"]
          .filter((k) => k in variant).map((k) => [k, variant[k]]));
        rows.push({ ...base, ...evidence, url: alternate.url });
      }
    }
  }
  if (rows.length > 400) throw new SearchError("单次 merge 最多 400 条来源（含重复版本）；请缩小范围。", "invalid_input");
  validateResponse("search", { results: rows });
  const reviewed = processResults(rows, query, qualityOptions);
  return { ...envelope("search", { query }, reviewed, 0), operation: "merge", network_requests: 0, upstream,
           upstream_complete: upstream.every((u) => Boolean(u.complete)) };
}

export function readResultFile(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw new SearchError("结果文件超过 16 MiB，请缩小范围。", "invalid_input");
  const raw = fs.readFileSync(file);
  if (raw.length > MAX_BYTES) throw new SearchError("结果文件超过 16 MiB，请缩小范围。", "invalid_input");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new SearchError("结果文件不是有效 JSON。", "invalid_input");
  }
}

function openBrowser(url) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    return spawnSync(command, args, { stdio: "ignore", timeout: 10000, windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

function readHidden(prompt) {
  const stdin = process.stdin;
  if (typeof stdin.setRawMode !== "function") {
    return Promise.reject(new SearchError("此终端无法安全隐藏输入，请换用本机终端。", "interactive_required"));
  }
  return new Promise((resolve, reject) => {
    let value = "", escape = false;
    const finish = (error) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      error ? reject(error) : resolve(value);
    };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (escape) {  // Skip terminal escape sequences such as arrow keys.
          if (/[A-Za-z~]/.test(c)) escape = false;
        } else if (c === "\r" || c === "\n") {
          return finish();
        } else if (c === "\u0003" || (c === "\u0004" && !value)) {
          return finish(new CancelledError());
        } else if (c === "\u007f" || c === "\b") {
          value = Array.from(value).slice(0, -1).join("");
        } else if (c === "\u001b") {
          escape = true;
        } else if (c >= " ") {
          value += c;
        }
      }
    };
    process.stdout.write(prompt);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

/** Indirection for side effects so tests can substitute them. */
export const deps = {
  fetch: (...args) => globalThis.fetch(...args),
  sleep,
  requestApi,
  loadKey,
  doctor,
  openBrowser,
  readHidden,
  isInteractive: () => Boolean(process.stdin.isTTY),
};

export async function setup({ noBrowser = false, guideOnly = false } = {}) {
  console.log(`1. 打开 DeepSeek 官方 API Keys 页面：${KEYS_URL}`);
  console.log("2. 登录/注册，进入 API keys，选择创建新密钥，名称可填 double-search。");
  console.log("3. 复制新生成的 Key，仅粘贴到下方本机隐藏输入；不要发到聊天或提交到 Git。");
  console.log(`4. 保存后执行一次 Search 验证。可能产生 API 费用，现价以 ${DOCS_URL} 为准。`);
  console.log("若遇 402，请自行在平台查看余额并决定是否充值；ChatGPT 等会员不含 DeepSeek API 额度。");
  if (!noBrowser && !deps.openBrowser(KEYS_URL)) console.log("浏览器未能自动打开，请手动访问上面的官方链接。");
  if (guideOnly) return 0;
  if (!deps.isInteractive()) {
    throw new SearchError("请在用户自己的可见终端运行 setup；禁止通过聊天、参数或管道传入密钥。", "interactive_required");
  }
  const key = validateKey(await deps.readHidden("DeepSeek API Key（输入不回显）: "));
  const file = saveKey(key);
  console.log(`已保存到 ${file}（POSIX 目录 700 / 文件 600）。`);
  if ((process.env.DEEPSEEK_API_KEY ?? "").trim()) {
    console.log("提醒：后续搜索优先使用 DEEPSEEK_API_KEY；若旧环境变量无效，请在使用 skill 的进程中清除/更新。");
  }
  let checked;
  try {
    checked = await deps.doctor(key, "newly_saved_config");
  } catch (error) {
    console.log("配置已保存，联网验证未通过。处理下面的错误后重新运行 doctor，无需重复输入密钥。");
    throw error;
  }
  console.log(JSON.stringify(checked, null, 2));
  return checked.ok ? 0 : 4;
}

const QUALITY_OPTIONS = {
  profile: { type: "string", default: "generic" },
  subject: { type: "string" },
  alias: { type: "string", multiple: true, default: [] },
  "exclude-term": { type: "string", multiple: true, default: [] },
};
const NETWORK_OPTIONS = { timeout: { type: "string", default: "30" }, retries: { type: "string", default: "2" } };
const QUALITY_HELP = `  --profile generic|auto|biography  默认 generic；biography/auto 为可选人物规则
  --subject TEXT        显式字面主体过滤；默认由调用模型判断相关性
  --alias TEXT          主体别名，可重复
  --exclude-term TEXT   排除含此词的结果，可重复`;
const NETWORK_HELP = `  --timeout 1..120      单次请求超时秒数，默认 30
  --retries 0..2        仅对网络失败/408/429/5xx 重试，默认 2`;
const COMMANDS = {
  setup: { args: "", min: 0, max: 0, summary: "引导创建 API Key、隐藏输入、保存并验证",
           options: { "no-browser": { type: "boolean" }, "guide-only": { type: "boolean" } },
           help: "  --no-browser          只显示官方链接\n  --guide-only          打开页面并说明步骤，不读写密钥" },
  status: { args: "", min: 0, max: 0, summary: "只检查本地配置，不联网、不显示密钥", options: {}, help: "" },
  doctor: { args: "", min: 0, max: 0, summary: "一次真实搜索验证，可能计费", options: {}, help: "" },
  search: { args: "<query>", min: 1, max: 1, summary: "搜索公开网页",
            options: { count: { type: "string", default: "5" }, "need-content": { type: "boolean" },
                       "ori-question": { type: "string" }, localization: { type: "string" }, raw: { type: "boolean" },
                       ...QUALITY_OPTIONS, ...NETWORK_OPTIONS },
            help: `  --count N             结果数 1–50，默认 5
  --need-content        请求搜索服务返回正文
  --ori-question TEXT   可选原问题，最多 128 字符
  --localization IP     可选 IP 地址；不会自动采集用户 IP
  --raw                 跳过去重与筛选，返回原始 API 结果
${QUALITY_HELP}
${NETWORK_HELP}` },
  research: { args: "<query>", min: 1, max: 1, summary: "执行调用模型提供的查询；默认只执行原查询",
              options: { count: { type: "string", default: "5" }, "max-searches": { type: "string", default: "8" },
                         query: { type: "string", multiple: true, default: [] }, ...QUALITY_OPTIONS, ...NETWORK_OPTIONS },
              help: `  --count N             每条查询结果数 1–50，默认 5
  --max-searches 1..8   本轮剩余搜索预算，默认 8
  --query TEXT          模型展开的查询，可重复；按输入顺序执行
${QUALITY_HELP}
${NETWORK_HELP}` },
  merge: { args: "<query> <file>...", min: 2, max: Infinity, summary: "离线合并多个已保存结果，不联网、不需要 Key",
           options: { ...QUALITY_OPTIONS }, help: QUALITY_HELP },
  fetch: { args: "<url>", min: 1, max: 1, summary: "抓取指定 URL 的 Markdown 正文", options: { ...NETWORK_OPTIONS }, help: NETWORK_HELP },
};

function rootHelp() {
  const lines = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(10)}${c.summary}`);
  return `usage: ds_search.mjs <command> [options]\n\nDeepSeek 官方搜索与网页抓取；缺少密钥时运行 setup。\n\ncommands:\n${lines.join("\n")}\n\n运行 ds_search.mjs <command> --help 查看参数。`;
}

function commandHelp(name) {
  const c = COMMANDS[name];
  return `usage: ds_search.mjs ${name}${c.args ? " " + c.args : ""} [options]\n\n${c.summary}${c.help ? "\n\noptions:\n" + c.help : ""}`;
}

function intOption(values, name, min = -Infinity, max = Infinity) {
  const raw = values[name];
  if (!/^[+-]?\d+$/.test(raw.trim()) || Number(raw) < min || Number(raw) > max) {
    throw new UsageError(`--${name} 的值无效：${raw}` + (Number.isFinite(min) ? `（允许 ${min}..${max}）` : ""));
  }
  return Number(raw);
}

export function parseCli(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || command === "-h" || command === "--help") return { command: "help", text: rootHelp() };
  const spec = COMMANDS[command];
  if (!spec) throw new UsageError(`未知命令：${command}`);
  if (rest.includes("-h") || rest.includes("--help")) return { command: "help", text: commandHelp(command) };
  // Defaults are applied by hand: parseArgs only supports `default` from Node 18.11.
  const options = Object.fromEntries(Object.entries(spec.options).map(([name, { default: _, ...rule }]) => [name, rule]));
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const { values, positionals } = parsed;
  for (const [name, rule] of Object.entries(spec.options)) {
    if (values[name] === undefined && "default" in rule) values[name] = rule.default;
  }
  if (positionals.length < spec.min || positionals.length > spec.max) {
    throw new UsageError(`参数数量不正确，用法：ds_search.mjs ${command} ${spec.args}`.trimEnd());
  }
  const args = { command, positionals, values };
  if ("profile" in values && !["auto", "generic", "biography"].includes(values.profile)) {
    throw new UsageError(`--profile 必须为 auto、generic 或 biography`);
  }
  if ("count" in values) args.count = intOption(values, "count");
  if ("max-searches" in values) args.maxSearches = intOption(values, "max-searches", 1, 8);
  if ("timeout" in values) args.timeout = intOption(values, "timeout", 1, 120);
  if ("retries" in values) args.retries = intOption(values, "retries", 0, 2);
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseCli(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`usage: ds_search.mjs <command> [options]\nds_search.mjs: error: ${error.message}\n`);
    return 2;
  }
  if (args.command === "help") {
    console.log(args.text);
    return 0;
  }
  const { command, positionals: [first, ...others], values } = args;
  try {
    if (command === "setup") return await setup({ noBrowser: Boolean(values["no-browser"]), guideOnly: Boolean(values["guide-only"]) });
    let payload, qualityOptions;
    if (command === "search") {
      payload = searchPayload(first, args.count, Boolean(values["need-content"]), values["ori-question"] ?? null, values.localization ?? null);
    } else if (command === "research") {
      researchPlan(first, values.query, args.maxSearches);
      payload = searchPayload(first, args.count, true);
    } else if (command === "fetch") {
      payload = fetchPayload(first);
    }
    if (["search", "research", "merge"].includes(command)) {
      for (const value of [...(values.subject != null ? [values.subject] : []), ...values.alias, ...values["exclude-term"]]) {
        validateText(value, "subject/alias/exclude-term");
      }
      qualityOptions = { profile: values.profile, subject: values.subject ?? null, aliases: values.alias, excludeTerms: values["exclude-term"] };
    }
    if (command === "merge") {
      if (others.length > 8) throw new SearchError("单次 merge 最多读取 8 个结果文件。", "invalid_input");
      const result = mergeOutputs(others.map(readResultFile), first, qualityOptions);
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    const [key, source] = deps.loadKey();
    let result;
    if (command === "status") {
      result = { ok: true, configured: true, credential_source: source, search_verified: false,
                 message: "配置存在；运行 doctor 才能验证真实搜索。" };
    } else if (command === "doctor") {
      result = await deps.doctor(key, source);
    } else if (command === "research") {
      result = await research(first, key, { count: args.count, maxSearches: args.maxSearches, timeout: args.timeout,
                                            retries: args.retries, queries: values.query, ...qualityOptions });
    } else {
      let [response, attempts] = await deps.requestApi(command, payload, key, { timeout: args.timeout, retries: args.retries });
      if (command === "search" && !values.raw) response = { ...response, ...processResults(response.results, first, qualityOptions) };
      result = envelope(command, payload, response, attempts);
    }
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 4;
  } catch (error) {
    if (error instanceof SearchError) {
      process.stderr.write(JSON.stringify({ ok: false, error: { code: error.code, message: error.message, http_status: error.status } }) + "\n");
      return error.code === "missing_api_key" ? 2 : 1;
    }
    if (error instanceof CancelledError) {
      process.stderr.write("已取消。\n");
      return 130;
    }
    if (typeof error?.code === "string" && typeof error?.syscall === "string") {
      process.stderr.write('{"ok":false,"error":{"code":"local_io_error","message":"本地文件操作失败，请检查目录权限。"}}\n');
      return 1;
    }
    throw error;
  }
}

const invokedDirectly = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exitCode = await main();
