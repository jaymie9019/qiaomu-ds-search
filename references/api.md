# DeepSeek Search / Fetch 契约

核对日期：2026-10-18。原始来源：[指南](https://api-docs.deepseek.com/guides/search/)、[Search 参考](https://api-docs.deepseek.com/api/search)、[Fetch 参考](https://api-docs.deepseek.com/api/fetch)。接口变更时先刷新这些来源再改脚本。

使用 `Authorization: Bearer <Key>` 和 JSON POST，地址固定为 `https://api.deepseek.com/v1/tools/search` 或 `/fetch`。不含 model 参数。

| Search 字段 | 约束 |
|---|---|
| query | 必填，1–128 Unicode 字符，不能全空白 |
| count | 整数 1–50，API 默认 10，本工具默认 5 |
| need_content | API 和工具默认 false；true 也可能没有正文 |
| ori_question | 可选原问题，1–128 字符；null 等同未提供 |
| localization | 可选 IP 地址；不自动采集用户 IP |

运算符直接保留：`site:example.com`；多域名 `site:a.com OR site:b.com`；排除站点 `-site:example.com`；排除词 `-advertisement`；排除短语 `-"release notes"`；精确短语 `"exact phrase"`；`lang:zh,en`；`after:2026-01-01`、`before:2026`。过滤日期不是发布时间准确性的保证。

Search 返回 `results` 数组（可以为空），每项保留 `title/url/snippet/summary/content/site_name/site_icon/date/authority/rerank_score`。date 可为 null，不伪造日期。rerank_score 为 0–3；官方将 1.5 以上视作较高质量检索结果。authority 为 -1（未知）或 0–4；3 以上是较高权威档位。两者都不是事实核实结论。

Fetch 请求字段为 url：HTTP/HTTPS、含主机、不含用户名密码、最长 8192 字符。返回 `title`（可空字符串）、`content`（Markdown）。403 是安全拒绝；404 可能是目标不可用、站点策略、内容类型不支持或无法提取，不等价于目标网站确实不存在。

只对 408、429、5xx 和网络失败重试；本工具每次默认 30 秒，最多 3 次尝试。连续失败总耗时通常不超过约 100 秒（自定义 timeout 后相应变化；网络栈 DNS 等不保证绝对墙钟上限），不会无限轮询。Retry-After 为数值且超过 10 秒时直接停止等待并提示稍后重试。JSON 错误和 schema 错误不重试。

## 计费与限流（会变化）

文档在核对日列出的 Search 和 Fetch 标价均为每 1,000 次成功请求 $0.75；结果数 count 不改变单次价格。成功且非空才计费，空搜索、无正文、失败和超时不计费。文档另说明经 DeepSeek Harness / Claude Code / Codex 使用 DeepSeek 服务端工具的调用当前免费，2026-11-01 北京时间 00:00 起计费；**本脚本是直接 REST 调用，不据此承诺享受免费**。

每账户 Search、Fetch 各自 5 QPS，Fetch 另受目标域名限流；多个 Key 或并行进程仍共享账户限额。此脚本的单次串行重试不能替所有外部客户端统一限速。普通补充调研建议最多 3 次搜索、3 次正文抓取，按标价约 $0.0045（仅估算，实际收费看平台账单）。
