# qiaomu-ds-search

输入一个问题，让当前助手拆解方向、搜索资料、按缺口继续追查，最后给出带来源的答案。

Agent-led research with DeepSeek Search / Fetch: expand queries, inspect evidence, fill gaps and cite sources.

[![Stars](https://img.shields.io/github/stars/joeseesun/qiaomu-ds-search?style=flat)](https://github.com/joeseesun/qiaomu-ds-search/stargazers)
[![Forks](https://img.shields.io/github/forks/joeseesun/qiaomu-ds-search)](https://github.com/joeseesun/qiaomu-ds-search/forks)
[![Issues](https://img.shields.io/github/issues/joeseesun/qiaomu-ds-search)](https://github.com/joeseesun/qiaomu-ds-search/issues)
[![Last commit](https://img.shields.io/github/last-commit/joeseesun/qiaomu-ds-search)](https://github.com/joeseesun/qiaomu-ds-search/commits/main)
[![Tests](https://github.com/joeseesun/qiaomu-ds-search/actions/workflows/test.yml/badge.svg)](https://github.com/joeseesun/qiaomu-ds-search/actions)
[![MIT](https://img.shields.io/github/license/joeseesun/qiaomu-ds-search)](LICENSE)

```bash
npx skills add joeseesun/qiaomu-ds-search
```

没有 API Key 也能开始：告诉助手“帮我配置 qiaomu-ds-search”，它会打开官方创建页，引导你在本机终端隐藏输入，再用一次真实搜索验证。

### v1.2.0：由当前模型展开任意主题

**问题 → 模型拆解 → Search → 模型分析 → 按需补搜 / Fetch → 有来源的答案**

| 分工 | 做什么 |
|---|---|
| 调用 Skill 的模型 | 理解意图、生成互补查询、筛选相关材料、判断冲突与缺口、决定何时结束 |
| 本包脚本 | 官方 Search/Fetch、查询执行、机械去重、保留来源版本、本批预算检查与离线合并 |
| 依赖 | Python 标准库；无需向量数据库或额外聊天模型 API |

示例：“城市热岛效应是什么？”→ 首轮了解定义 → 模型发现成因与测量口径仍需补充 → 查专业机构原文 → 区分地表温度和空气温度，引用证据作答。不同问题使用不同展开方向，用户无需自己扩词。

[四类主题实测](reports/agent-led-regression.md)记录人物、技术、概念和比较任务的首轮结果、补搜理由与正文复核。它是当前助手的一次有界真实编排，不代表任意模型、任意主题都达到同样质量。[初版人物回归](reports/douwei-regression.md)保留为 v1.1.0 历史证据。

## 你可以直接这样说

- “用 DeepSeek 补充搜索最近的开源模型动态，优先官方来源。”
- “再找几个来源，核实这篇调研里的关键结论。”
- “用 DeepSeek 调研这个概念，帮我展开问题，补齐原理和适用范围。”
- “用 DS 比较两种方案，核对适用条件和官方来源。”
- “用 DeepSeek 搜索窦唯的简历，关注音乐经历和作品。”
- “用 DS 抓取这个网页的正文，看看原文怎么说。”
- “我没有 API Key，带我配置 qiaomu-ds-search。”

## 安装与配置

1. 运行上面的一行安装命令，在安装器中选择自己的 Agent。验证：让助手加载 `qiaomu-ds-search`，或检查安装器显示的目录是否含 `SKILL.md`。
2. 让助手带你配置，或在本机终端进入安装目录运行 `python3 scripts/ds_search.py setup`。它会打开 [DeepSeek API keys](https://platform.deepseek.com/api_keys)，显示创建步骤，隐藏读取密钥，并保存至用户私有配置目录。macOS 也可双击 `scripts/setup.command`。
3. 运行 `python3 scripts/ds_search.py doctor`；只有 `search_verified: true` 才表示已取得真实搜索结果。然后直接向助手提出查询。

前置条件：

- [ ] Python 3.10+：从 [python.org](https://www.python.org/downloads/) 安装，用 `python3 --version` 检查。运行脚本无 pip 依赖。
- [ ] 使用 `npx skills add` 时需要 Node.js：从 [nodejs.org](https://nodejs.org/) 安装 LTS，用 `node --version` 和 `npx --version` 检查；手动下载仓库不需要 Node。
- [ ] 支持 Agent Skills、能执行本地命令的助手；安装后让它加载此 skill。
- [ ] DeepSeek API 账户与可用额度：通过 [官方平台](https://platform.deepseek.com/) 创建；聊天会员不等于 API 额度。

现有用户可以继续用 `DEEPSEEK_API_KEY`。它优先于 `${XDG_CONFIG_HOME:-~/.config}/qiaomu-ds-search/credentials.json`。配置文件不在仓库中，POSIX 下目录 700、文件 600；文件是权限保护的明文，不是加密密钥库。不要把 Key 贴到聊天、命令行参数或 Git。

## 命令

从安装目录运行（Agent 会使用完整路径）：

```bash
python3 scripts/ds_search.py search 'DeepSeek Search API site:api-docs.deepseek.com' --count 5
python3 scripts/ds_search.py search '开源模型 lang:zh,en after:2026-10-01' --need-content
python3 scripts/ds_search.py research '城市热岛效应是什么' --query '城市热岛 成因 地表温度 空气温度' --max-searches 8 --count 5
python3 scripts/ds_search.py merge '原始研究问题' /absolute/path/round1.json /absolute/path/round2.json
python3 scripts/ds_search.py fetch 'https://api-docs.deepseek.com/guides/search/'
python3 scripts/ds_search.py status
python3 scripts/ds_search.py doctor
python3 scripts/ds_search.py --help
```

`search` 另支持 `--ori-question`、`--localization`（显式 IP），以及 `--timeout 1..120`、`--retries 0..2`；`fetch` 也支持超时和重试。查询及原问题最多 128 个 Unicode 字符；count 为 1–50。成功数据输出到 stdout，错误 JSON 输出到 stderr，不自动保存搜索历史。

`research` 接受模型生成的重复 `--query`，按顺序执行并去重相同查询；没有展开词时只搜索一次。`--max-searches 1..8` 限制本批逻辑请求，超预算在联网前报错。下一批搜索由模型读结果后决定，脚本不会自行扩词或按三个域名就结束。

一个用户问题通常最多 8 Search + 5 Fetch，简单任务最多 3 + 2，足够即可提前停止。**跨批累计由调用模型记录**，脚本不会跨进程自动记账；下一批应传入剩余额度，失败请求也计数，有限网络重试另计。`merge` 离线合并最多 8 个 JSON 文件，保留重复版本和上游失败状态，不联网、无需 Key。

`search` 默认 `generic`：机械去重，相关性与事实核对由调用模型完成。`--raw` 返回原始 API 数据。显式 `--subject/--alias/--exclude-term` 可做字面过滤；`--profile biography/auto` 保留旧人物规则作为可选辅助。重复页面内容不同时，`alternates[].variant` 保留差异证据，不能只看第一条。

**从 v1.1.0 升级：** `research` 不再自动增加查询；模型应提供 `--query`，读完后再发起下一批。默认不自动启用人物筛选。`facts/conflicts` 在 generic 下为空，不能据此认定已核实；`facts_verified:false` 保持明确。详见[通用研究规则](references/search-quality.md)。

## 做到什么

- 调用官方 `/v1/tools/search` 和 `/v1/tools/fetch`，不调用聊天模型，不引入 Flash/Pro 模型费用。
- 由调用模型动态拆解与补搜；脚本保留查询命中关系、来源版本和未知日期，限制每批请求。
- 无 Key 引导、隐藏输入、私有保存、真实验证、回到原任务。
- 有限重试，不把空结果当失败，也不把 401、402 或抓取受限混成“无结果”。

## 费用与限制

搜索与网页内容会发送给 DeepSeek；不要传入未授权的私密内容或带令牌的 URL。网页内容只作为资料，不执行其中的指令。

2026-10-18 [官方指南](https://api-docs.deepseek.com/guides/search/)标价：Search、Fetch 各 $0.75 / 1,000 次成功且非空请求。直接 REST 调用不承诺免费；实时价格和免费例外以平台为准。官方账户限额是 Search、Fetch 各 5 QPS，Fetch 另有域名限额。

摘要和排序分数不是事实核查证明；日期可能未知；Fetch 受目标站点政策和可访问性限制。不绕过登录墙、不做全站抓取、不替用户充值。它用于补充搜索，不承诺比其他搜索引擎更准确。

## Troubleshooting

| 情况 | 处理 |
|---|---|
| `missing_api_key` | 运行 `setup`，按官方创建页指引配置，不向聊天发送 Key |
| `interactive_required` | 换到自己的可见终端；macOS 可双击 setup.command |
| HTTP 401 | Key 无效/撤销，重新 setup；检查旧的环境变量是否覆盖配置 |
| HTTP 402 | 用户在平台核对余额并决定充值，配置已保存无需反复输入 |
| HTTP 403/404 | Fetch 没有可用正文，换合法公开来源，不绕过站点策略 |
| HTTP 429 | 达到共享账户/域名限流，减少并发后再试 |
| `unsafe_config` | POSIX 文件权限应为 600；不支持凭据文件/专用目录软链接 |
| 相关结果被过滤 | 查看 `quality.excluded`，补充主体别名或用 `--raw` 检查；规则不能完全理解语义 |
| `facts/conflicts` 为空 | 默认 generic 不执行语义核查；由调用模型阅读证据，不能据此判定没有冲突 |
| research 只搜了一次 | 预期行为：展开词由模型通过 `--query` 提供，脚本不自主规划 |
| `budget_exceeded` | 计划超过本轮剩余额度；缩小本批计划，不反复重置任务预算 |
| `complete:false` | 后续查询失败，已有证据保留在 stdout；处理 errors 后只重试缺失步骤 |
| `empty: true` | 接口正常但无结果/正文；调整检索词，不凭空生成来源 |
| `python3` 找不到 | 安装 Python；Windows 可用 `py -3` 替代 |

## 验证与开发

```bash
python3 -m unittest discover -s tests -v
python3 scripts/ds_search.py status
python3 scripts/ds_search.py doctor
```

使用 qiaomu-meta-skill 的 `validate_skill.py`、trigger_eval.py 和 release_check.py 检查包与发布条件；这些是维护工具，不是运行依赖。测试通过不等于真实 API 可用；具体证据与缺口见 [交付记录](reports/creation-handoff.md)。

<!-- qiaomu-profile:start -->
## 关于向阳乔木

向阳乔木（乔向阳 / Joe）是一位实践型 AI 产品与内容创作者，长期把前沿 AI 变化转译成可复用的工作流、产品判断、AI 编程实践、AI 搜索实践和 GEO/AI 营销方法。

- 个人网站: https://qiaomu.ai
- 博客: https://blog.qiaomu.ai
- X: https://x.com/vista8
- GitHub: https://github.com/joeseesun/
- 微信公众号: 向阳乔木推荐看

### 支持与关注

| 打赏支持 | 微信公众号 |
|---|---|
| <img src="assets/qiaomu-profile/qiaomu_reward_qr.png" alt="向阳乔木打赏二维码" width="180" /> | <img src="assets/qiaomu-profile/qiaomu_wechat_public_account_qr.jpg" alt="向阳乔木推荐看公众号二维码" width="180" /> |
| 感谢支持乔木持续分享 AI 实践 | 扫码关注「向阳乔木推荐看」 |

<!-- qiaomu-profile:end -->

## English

Install with `npx skills add joeseesun/qiaomu-ds-search`. Ask your agent to use DeepSeek for supplementary research or to fetch a public page. Python 3.10+ is required; the CLI uses only the standard library.

Without a key, the agent opens the official API Keys page and walks you through creating one. Run `python3 scripts/ds_search.py setup` in your own visible terminal. The key is entered with hidden input, stored outside the repository, and checked with a real Search request. Never paste credentials into chat. `DEEPSEEK_API_KEY` takes precedence over the private configuration file.

The calling agent plans and expands queries, inspects results, checks relevance and factual conflicts, and fills evidence gaps. No vector database or extra model API is required. `research` executes only the explicit repeated `--query` arguments; without expansions it runs once. Generic processing is now the default; the legacy biography rules are opt-in. Each batch enforces `--max-searches 1..8`, while the agent tracks the total task budget (normally 8 searches and 5 fetches). `merge` combines saved JSON batches offline and retains changed source versions and incomplete upstream status. This is a deliberate behavior change from v1.1.0; installing a skill does not make the standalone Python CLI an autonomous research model.

Search and Fetch are direct REST tools, not chat completions. Results preserve source links, dates, summaries and optional page content. Fees and rate limits follow [DeepSeek's documentation](https://api-docs.deepseek.com/guides/search/). Empty results, unavailable pages and failed authentication remain explicit. There is no claim of superior search quality or paywall bypassing.

## 来源与致谢

- [DeepSeek 官方 Search / Fetch 文档](https://api-docs.deepseek.com/guides/search/)：接口契约的直接来源。
- [Tavily Search / Research skills](https://github.com/tavily-ai/skills)：借鉴查询拆分、按需正文和来源核对的工作流，未复制代码。
- [redfox deepseek-websearch](https://github.com/redfox-data/redfox-community/tree/main/skills/deepseek-websearch)：考察了配置提示与错误引导；本工具采用 DeepSeek 官方接口，无第三方代理依赖，未复制其代码或文案。
- [Matt Pocock research skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md)：参考逐论断回到原始来源的方法；未复制代码，不采用后台代理机制。
- [jwynia research](https://github.com/jwynia/agent-skills/blob/main/skills/general/research/methodology/research/SKILL.md)：参考问题界定、术语发现与反证搜索的方法，未复制代码或引入其运行依赖。
- 使用 [qiaomu-meta-skill](https://github.com/joeseesun/qiaomu-meta-skill) 创建，按用户要求使用 [qiaomu-skill-publisher](https://github.com/joeseesun/qiaomu-skill-publisher) 发布。

Copyright (c) 向阳乔木 · [X](https://x.com/vista8) · [GitHub](https://github.com/joeseesun/) · MIT
