# double-search

输入一个问题，让当前助手按话题选择搜索引擎、拆解方向、按缺口继续追查，最后给出带来源的答案。

Agent-led research with two engines: DeepSeek Search / Fetch for Chinese sources (including WeChat articles), Grok for the global web and X/Twitter.

[![Tests](https://github.com/jaymie9019/double-search/actions/workflows/test.yml/badge.svg)](https://github.com/jaymie9019/double-search/actions)
[![MIT](https://img.shields.io/github/license/jaymie9019/double-search)](LICENSE)

```bash
npx skills add jaymie9019/double-search
```

## 两个引擎怎么分工

| 引擎 | 擅长 | 返回 | 接入方式 |
|---|---|---|---|
| DeepSeek Search / Fetch | 中文生态：微信公众号、国内公司/政策/人物、中文媒体；抓取任意公开 URL 的正文 | 原始摘要和正文，由助手自己读、自己判断 | `scripts/ds_search.mjs`，Node.js 18+，DeepSeek API Key |
| Grok（`grokx`） | 海外英文网页、国际动态、X/Twitter 上的讨论 | Grok 写好的总结加来源链接（二手证据） | [grokx](https://github.com/jaymie9019/grokx) CLI，一次性 OAuth 登录 |

跨中外的话题两边各查自己那一侧再交叉核对；Grok 总结里影响结论的关键事实，会用 DeepSeek `fetch` 抓原文核对。只配好其中一个引擎也能用，助手会说明覆盖面变窄。

| 分工 | 做什么 |
|---|---|
| 调用 Skill 的模型 | 选引擎、理解意图、生成互补查询、筛选材料、判断冲突与缺口、决定何时结束 |
| `ds_search.mjs` | DeepSeek 官方 Search/Fetch、机械去重、保留来源版本、本批预算检查与离线合并 |
| `grokx` | 在 Grok 服务端执行网页/X 搜索并汇总 |

DeepSeek 脚本只用 Node 内置模块（装了 Codex CLI、Claude Code 的电脑基本都有 Node），无需 `npm install`、Python 或向量数据库。

## 你可以直接这样说

- “搜一下这个公众号最近怎么解读 Vitest 5，给出原文链接。”
- “看看 X 上开发者怎么评价 Vite+ 1.0。”
- “查一下这款产品在国内外的口碑，分别给来源。”
- “再找几个来源，核实这篇调研里的关键结论。”
- “抓取这篇公众号文章的正文，总结一下。”
- “我没有 API Key，带我配置 double-search。”

## 安装与配置

1. 运行上面的一行安装命令，在安装器中选择自己的 Agent。验证：让助手加载 `double-search`，或检查安装器显示的目录是否含 `SKILL.md`。
2. 让助手带你配置，或在本机终端进入安装目录运行 `node scripts/ds_search.mjs setup`。它会打开 [DeepSeek API keys](https://platform.deepseek.com/api_keys)，显示创建步骤，隐藏读取密钥，并保存至用户私有配置目录。macOS 也可双击 `scripts/setup.command`。
3. 运行 `node scripts/ds_search.mjs doctor`；只有 `search_verified: true` 才表示已取得真实搜索结果。然后直接向助手提出查询。
4. Grok（可选）：运行 `bash scripts/install_grokx.sh` 安装 `grokx`（已装且支持 `search` 时会直接复用），再在自己的终端运行一次 `grokx login` 完成浏览器授权。排错见 [Grok 配置与排错](references/grok.md)。

前置条件：

- [ ] Node.js 18+：从 [nodejs.org](https://nodejs.org/) 安装 LTS，用 `node --version` 检查。安装 skill 用的 `npx` 随 Node 附带。
- [ ] 支持 Agent Skills、能执行本地命令的助手；安装后让它加载此 skill。
- [ ] DeepSeek API 账户与可用额度：通过 [官方平台](https://platform.deepseek.com/) 创建；聊天会员不等于 API 额度。
- [ ] Grok 一侧（可选）：可登录 Grok 的账号；`grokx` 预编译版本支持 macOS 和 Linux x86_64，其他平台需 Rust 工具链 `cargo install --git https://github.com/jaymie9019/grokx`。

也可以用 `DEEPSEEK_API_KEY` 环境变量，它优先于 `${XDG_CONFIG_HOME:-~/.config}/double-search/credentials.json`。配置文件不在仓库中，POSIX 下目录 700、文件 600；文件是权限保护的明文，不是加密密钥库。不要把 Key 贴到聊天、命令行参数或 Git。

## 命令

从安装目录运行（Agent 会使用完整路径）：

```bash
node scripts/ds_search.mjs search 'DeepSeek Search API site:api-docs.deepseek.com' --count 5
node scripts/ds_search.mjs search '开源模型 lang:zh,en after:2026-10-01' --need-content
node scripts/ds_search.mjs research '城市热岛效应是什么' --query '城市热岛 成因 地表温度 空气温度' --max-searches 8 --count 5
node scripts/ds_search.mjs merge '原始研究问题' /absolute/path/round1.json /absolute/path/round2.json
node scripts/ds_search.mjs fetch 'https://api-docs.deepseek.com/guides/search/'
node scripts/ds_search.mjs status
node scripts/ds_search.mjs doctor
node scripts/ds_search.mjs --help
```

Grok 一侧：

```bash
grokx search "How are developers on X reacting to Vite+ 1.0?" --depth fast
grokx search "海外媒体如何报道某事件" --no-x --depth expert
```

`--depth fast|expert|heavy` 决定 Grok 投入多少算力（默认超时 60 / 180 / 300 秒），`--no-x` / `--no-web` 限定来源。

`search` 另支持 `--ori-question`、`--localization`（显式 IP），以及 `--timeout 1..120`、`--retries 0..2`；`fetch` 也支持超时和重试。查询及原问题最多 128 个 Unicode 字符；count 为 1–50。以 `-` 开头的查询写在 `--` 之后。成功数据输出到 stdout，错误 JSON 输出到 stderr，不自动保存搜索历史。

`research` 接受模型生成的重复 `--query`，按顺序执行并去重相同查询；没有展开词时只搜索一次。`--max-searches 1..8` 限制本批逻辑请求，超预算在联网前报错。下一批搜索由模型读结果后决定，脚本不会自行扩词或按三个域名就结束。

一个用户问题通常最多 8 Search + 5 Fetch，简单任务最多 3 + 2，足够即可提前停止。**跨批累计由调用模型记录**，脚本不会跨进程自动记账；下一批应传入剩余额度，失败请求也计数，有限网络重试另计。`merge` 离线合并最多 8 个 JSON 文件，保留重复版本和上游失败状态，不联网、无需 Key。

`search` 默认 `generic`：机械去重，相关性与事实核对由调用模型完成。`--raw` 返回原始 API 数据。显式 `--subject/--alias/--exclude-term` 可做字面过滤；`--profile biography/auto` 保留人物规则作为可选辅助。重复页面内容不同时，`alternates[].variant` 保留差异证据，不能只看第一条。详见[通用研究规则](references/search-quality.md)。

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
| `node` 找不到 | 安装 Node.js 18+；用 nvm 等管理器时确认当前终端已加载 |
| `grokx` 找不到 / 未登录 | 运行 `bash scripts/install_grokx.sh`；未登录时在自己的终端运行 `grokx login` |

## 验证与开发

```bash
node --test            # 或 npm test
node scripts/ds_search.mjs status
node scripts/ds_search.mjs doctor
```

测试使用 `node:test`，不发真实请求；测试通过不等于真实 API 可用，需用 `doctor` 实测。

## English

Install with `npx skills add jaymie9019/double-search`. The calling agent routes each question: DeepSeek Search / Fetch for Chinese sources (WeChat articles, Chinese media and institutions), Grok via the `grokx` CLI for the global web and X/Twitter. Cross-border topics use both and cross-check. DeepSeek returns raw evidence the agent reads itself; Grok returns a summary with citations, which the agent treats as second-hand and verifies against the original pages (via DeepSeek Fetch) when a claim matters.

The DeepSeek side needs Node.js 18+ and an API key entered with hidden input in your own terminal (`node scripts/ds_search.mjs setup`); `DEEPSEEK_API_KEY` takes precedence. The Grok side needs `grokx` (`bash scripts/install_grokx.sh`) and a one-time `grokx login`. Either engine alone still works, with narrower coverage.

## 来源与致谢

- 基于 [qiaomu-ds-search](https://github.com/joeseesun/qiaomu-ds-search)（MIT）改写为 Node.js 实现，原版权声明保留在 [LICENSE](LICENSE)。
- [DeepSeek 官方 Search / Fetch 文档](https://api-docs.deepseek.com/guides/search/)：接口契约的直接来源。
- Grok 一侧来自本地的 grok-search skill 与 [grokx](https://github.com/jaymie9019/grokx)。
