# qiaomu-ds-search 1.0.0 交付记录

日期：2026-10-18。用途：以 DeepSeek 官方 Search/Fetch 补充调研，并带无 Key 用户完成安全配置。

## 参考与取舍

- tavily-search：短查询、按需正文、核对原始来源。
- tavily-research：区分轻搜索和研究，保留逐论断引用；不引入其模型选择和长任务系统。
- redfox deepseek-websearch：考察自然语言入口和错误引导；拒绝第三方代理依赖，未复制未明确授权的代码。
- 原创连接：官方创建页、可见终端隐藏输入、私有配置、真实验证、继续原任务。

来源和指标详见 [研究记录](prior-art-research.md)。

## 验证

- validated advantage：23 项 Python 单元测试通过；包含失败反例，覆盖参数、网络、重试、密钥配置与不泄密。
- trigger-eval 是启发式路由冒烟检查，不是实际大模型路由准确率；19/19 通过，结果以 trigger-eval.json 为准。
- design advantage：直接调用 Search/Fetch，没有聊天模型和额外 Python 运行依赖；提供完整 API onboarding。
- hypothesis：可能减少补充调研与首次配置成本；尚无用户比较实验。
- 真实 API：用户完成本机隐藏输入配置后，Search 返回 3 条官方来源，Fetch 返回 10,279 字符正文；均为一次请求成功。证据见 output-evidence.json。
- 包结构、版本一致性与 secret scan 已通过。本地发布门禁无阻断；开发时的未提交文件与尚待远端安装验证单独记录。GitHub CI、PR、Release 和安装结果为独立外部证据，可查看仓库 Actions、PR 与 Releases；本文件不将尚未运行的外部门禁预写为成功。

## 边界与回滚

没有执行登录、验证码、充值或绕过访问限制。外部正文为不可信资料，不能成为 agent 指令。配置保存在仓库外；用户可删除专用配置文件，并在 DeepSeek 平台撤销 Key。代码回滚使用已发布 tag，不覆盖旧 Release。

尚未验证：Windows/Linux 的真人交互 onboarding、不同主题的检索质量、真实账户限流/余额错误（单元测试用固定夹具覆盖）。
