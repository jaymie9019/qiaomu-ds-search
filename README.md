# qiaomu-ds-search

同一篇资料换了三个网址，不能算三个信源。用 DeepSeek 补充搜索、去重筛选，并追查互相矛盾的说法。

Supplement research with DeepSeek's official Search / Fetch API, including guided API-key setup.

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

### 输出预览

**v1.1.0：「窦唯的简历」真实回归（2026-10-18）**

| 检查 | 实际结果 |
|---|---|
| 原始 5 条回放 | 合并 2 个重复百科词条、排除 2 条离婚八卦，保留 1 条 |
| 新版 research | 3 次 Search 共返回 15 条，合并 2 条、排除 4 条，保留 9 条供进一步阅读 |
| 年份冲突 | 识别加入黑豹的 1988 / 1989 分歧，执行专项查询，仍标记待核实 |
| Fetch 正文复核 | 凤凰网返回相关采访；咪咕返回首页导航，未作为已核实正文 |

保留项含同站繁简版本，不能将 9 条当作 9 个独立信源。规则筛选后仍需 Agent 核对语义和原始出处；[本次实测与简历摘要](reports/douwei-regression.md)记录了证据边界。


2026-10-18 真实调用：

| 操作 | 返回结果 |
|---|---|
| 搜索 `DeepSeek Search API site:api-docs.deepseek.com` | 3 条官方来源，包括[中文指南](https://api-docs.deepseek.com/zh-cn/guides/search/)、[英文指南](https://api-docs.deepseek.com/guides/search/)与[更新日志](https://api-docs.deepseek.com/updates/) |
| Fetch 官方指南 | 返回 `Search & Fetch` 标题及 10,279 字符正文 |

上表是初版的连通性验证；新版另做上述人物检索回归，均不代表所有主题的检索质量。完整元数据见[实测证据](reports/output-evidence.json)。

搜索成功后返回来源标题、URL、摘要、发布时间（未知时保留 null）、可选正文；助手据此给出带链接的中文结论。Fetch 返回网页 Markdown，便于核对原文。

## 你可以直接这样说

- “用 DeepSeek 补充搜索最近的开源模型动态，优先官方来源。”
- “再找几个来源，核实这篇调研里的关键结论。”
- “用 DeepSeek 搜索窦唯的简历，去重、过滤八卦，并核对年份冲突。”
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
python3 scripts/ds_search.py research '窦唯的简历' --alias '竇唯' --count 5
python3 scripts/ds_search.py fetch 'https://api-docs.deepseek.com/guides/search/'
python3 scripts/ds_search.py status
python3 scripts/ds_search.py doctor
python3 scripts/ds_search.py --help
```

`search` 另支持 `--ori-question`、`--localization`（显式 IP），以及 `--timeout 1..120`、`--retries 0..2`；`fetch` 也支持超时和重试。查询及原问题最多 128 个 Unicode 字符；count 为 1–50。成功数据输出到 stdout，错误 JSON 输出到 stderr，不自动保存搜索历史。

`search` 默认清理结果，`--raw` 可返回原始数据；`search/research` 支持 `--subject`、重复的 `--alias` 与 `--exclude-term`、`--profile auto/generic/biography`。`research --max-searches 1..3` 在预算内补充来源并追查冲突，自动请求正文。所有筛选与去重都有原因记录；后续请求失败保留部分证据、标记 `complete:false` 并退出 4。

中文人物经历中的年份冲突可自动生成核实查询，其他事实由 Agent 按[质量处理规则](references/search-quality.md)核对。`facts_verified:false` 始终保留：多数票、排序高分和“没检测出冲突”都不能证明事实正确。

## 做到什么

- 调用官方 `/v1/tools/search` 和 `/v1/tools/fetch`，不调用聊天模型，不引入 Flash/Pro 模型费用。
- 默认少量查询，去重筛选、保留原始来源和未知日期；研究模式最多三次搜索，记录冲突和核实查询。
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
| `conflicts` 非空 | 回原始材料核实；无法解决就保留双方证据，不按高分或多数票裁决 |
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

`search` now cleans duplicate URLs and near copies, with intent-scoped filtering and an audit trail. `research` runs at most three searches to diversify sources and investigate candidate conflicts. Chinese biography year/event extraction is deliberately narrow: final fact checking requires original-source review. Conflicts remain unresolved until sufficient evidence exists; scores and majority votes are never truth verdicts. `--raw`, explicit subjects and aliases provide escape hatches.

Search and Fetch are direct REST tools, not chat completions. Results preserve source links, dates, summaries and optional page content. Fees and rate limits follow [DeepSeek's documentation](https://api-docs.deepseek.com/guides/search/). Empty results, unavailable pages and failed authentication remain explicit. There is no claim of superior search quality or paywall bypassing.

## 来源与致谢

- [DeepSeek 官方 Search / Fetch 文档](https://api-docs.deepseek.com/guides/search/)：接口契约的直接来源。
- [Tavily Search / Research skills](https://github.com/tavily-ai/skills)：借鉴查询拆分、按需正文和来源核对的工作流，未复制代码。
- [redfox deepseek-websearch](https://github.com/redfox-data/redfox-community/tree/main/skills/deepseek-websearch)：考察了配置提示与错误引导；本工具采用 DeepSeek 官方接口，无第三方代理依赖，未复制其代码或文案。
- [Matt Pocock research skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md)：参考逐论断回到原始来源的方法；未复制代码，不采用后台代理机制。
- 使用 [qiaomu-meta-skill](https://github.com/joeseesun/qiaomu-meta-skill) 创建，按用户要求使用 [qiaomu-skill-publisher](https://github.com/joeseesun/qiaomu-skill-publisher) 发布。

Copyright (c) 向阳乔木 · [X](https://x.com/vista8) · [GitHub](https://github.com/joeseesun/) · MIT
