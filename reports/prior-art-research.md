# 参考研究 · 2026-10-18

使用 qiaomu-meta-skill 内置 research_prior_art.py，查询 `deepseek web search`、`web research source citations`；skills.sh 与 SkillsMP 均成功，共去重为 41 个候选家族。按任务相关性筛选，未执行候选脚本。目录原始指标节选在 prior-art-candidates.json；安装量与仓库 stars 分开，均不是质量评分。

## 实际阅读

| 参考 | 维护与许可信号 | 具体借鉴与落点 |
|---|---|---|
| [tavily-search](https://github.com/tavily-ai/skills/blob/main/skills/tavily-search/SKILL.md) | Tavily 官方仓库，GitHub 489 stars，MIT，2026-10-17 更新（核对日快照） | 先短查询筛选，再按需正文；对版本/身份敏感事实核对官方源，落在 SKILL 的 Compact Workflow |
| [tavily-research](https://github.com/tavily-ai/skills/blob/main/skills/tavily-research/SKILL.md) | 同仓库；skills.sh research 条目 6.5K 安装（目录别名，不能当成 search 子技能安装量） | 区分快速查找与深研究、认证失败后处理；改为有界补充检索与逐论断引用 |
| [redfox deepseek-websearch](https://github.com/redfox-data/redfox-community/blob/main/skills/deepseek-websearch/SKILL.md) | skills.sh 101 安装，GitHub 仓库 446 stars、2026-10-17 更新；GitHub 未检出许可证 | 学习自然语言触发和错误引导的表达方向；未复制文案或代码。不采用其第三方账户/中转 API |

源代码检查：读取上述原始 SKILL.md、GitHub 仓库 license/default_branch/updated_at，未安装候选依赖。评分证据缺失；不声称候选质量排名。

## 取舍

- keep：来源保留、短查询拆分、关键事实回原文、错误可操作。
- adapt：来源评估改成中文补充调研工作流；查询上限严格遵循 DeepSeek 的 128 Unicode 字符；默认少量请求。
- reject：第三方代理与异步任务轮询（官方接口是直接 JSON）；全套 crawl/map/deep research（超出补充搜索范围）；自动 Pro 模型选择（本任务不需要聊天模型）。
- invent：缺 Key → 官方页面 → 用户本机隐藏输入 → 私有文件 → 真实搜索核验 → 原任务续做的一体化引导；把“已保存”和“取得结果”编码为不同状态。

实现为原创 Python 标准库代码。MIT 候选只吸收方法，未复制其代码；无明确许可证的候选仅作为只读比较对象。DeepSeek 的指南与 Search/Fetch API 参考是请求参数、响应结构、计费和错误处理的直接依据。

## 证据边界

设计优势：相比已阅读的候选，此包明确提供 DeepSeek 官方直连与首次配置完成状态。经过测试的优势只限于 tests、trigger-eval 和实际 provider/安装证据。没有横向检索质量基准、用户满意度或平台覆盖率数据，不能声称更准确或全平台已实测。

## v1.1.0 质量改进研究

2026-10-18 再用内置 runner 查询 `search deduplication source verification` 与 `research conflicting evidence fact check`，两个目录均成功，去重为 21 个候选家族。实际读取 [mattpocock/skills research](https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md) 及 MIT LICENSE；本次没有安装或执行候选代码。目录快照显示 skills.sh 677.4K 安装、SkillsMP 仓库 292,968 stars，两者分别记录，不是质量评分；目录更新时间为 2026-08-19，不当作当前仓库提交时间。

keep：逐论断追溯到拥有事实的第一手来源。adapt：在三次 Search 预算内记录中性冲突查询，把未解决状态暴露给 Agent。reject：该参考要求后台代理，但本工具是轻量补充搜索，不引入后台任务；目录里大量抓站/销售名单工具与本需求无关，未采用。invent：可审计 URL/内容去重、保护相互矛盾的重复版本、意图限定的人物过滤、无真伪裁决的候选年份检测。

通用原则：同一证据不能重复计票，相关性先于来源分数，冲突不能被去重掩盖。人物年份提取是可选适配器，窦唯仅为回归夹具；另测虚构音乐人、一般文档、不同参数 URL、否定句、其他人物和英文数值范围。没有声称规则具备通用语义事实核查能力。
