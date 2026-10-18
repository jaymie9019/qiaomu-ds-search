# qiaomu-ds-search 1.2.0 交付记录

日期：2026-10-18。目标：任意主题由调用 Skill 的模型理解、拆解、扩词、阅读、补搜和核实；脚本执行 Search/Fetch、去重、预算预检与离线合并。源目录保持用户指定的唯一目录，Key 配置不变。

## 参考与取舍

- Tavily Search/Research：保留按需读原文、逐论断引用；未采用额外研究模型或长任务服务。
- Matt Pocock research：追溯第一手来源；未采用后台代理。
- jwynia research：问题界定、术语发现和反证检索；未采用数字置信度、固定领域模板、自动排除已见域名及 Deno/Tavily 依赖。只借鉴方法，未复制代码。
- redfox deepseek-websearch：此前只读比较配置提示；无第三方中转依赖。

完整候选指标、许可边界及一条目录检索失败见 prior-art-research.md。

## 最终实现与验证

- design advantage：规划和语义判断明确交给当前模型，无额外模型 API/向量数据库；固定人物规则降为可选兼容辅助。
- validated advantage：research 只执行明确查询，即使已经有三个来源分组也不私自停止；计划超预算或有非法查询时在联网前拒绝。62 项离线测试通过。
- validated advantage：重复页面中不同语言/主题的差异证据保留；离线 merge 保留跨轮来源、重复版本和失败状态，不需要 Key 或网络。
- provider-backed evidence：当前助手在人物、技术、概念、比较四类主题中先读结果再补搜，9 次 Search、6 次 Fetch；包含一次空搜索、一次 Fetch 404，未隐瞒或当作成功取得资料。详见 agent-led-regression.md 和 output-evidence.json。
- trigger-eval 为启发式路由冒烟检查，22 项；agent_workflow_cases.json 为 7 类场景验收准则，不冒充模型准确率。
- hypothesis：更有效的展开和收敛可能提高内容覆盖；未做通用检索质量基准、用户实验或不同模型间比较。

## 兼容、预算与回滚

research 的 v1.1.0 自动补搜改为由调用模型传 --query；不传时执行一次。默认 generic 不过滤人物关键词，旧规则通过 --profile biography/auto 显式启用。每批 --max-searches 限制 1–8 个逻辑请求，跨批任务总量由模型累计，失败请求计数、重试另有上限。

沿用 Search/Fetch、setup/status/doctor 与仓库外私有凭据。不新增密钥权限，不绕过登录或付费限制。使用旧版本 tag 可回滚脚本与指令；私有 Key 不随版本覆盖。

远端 PR/CI/Release 和干净安装由独立发布门禁检查，本报告不预写外部门禁成功。Windows/Linux 真人配置、所有主题或调用模型质量仍未验证。
