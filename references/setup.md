# DeepSeek：从没有 API Key 到可用搜索

## 用户可见引导

推荐说法：“我会打开 DeepSeek 官方 API Keys 页面。请登录后创建一个密钥，名称填 double-search，然后粘贴到本机终端的隐藏输入框。不要把密钥发到聊天。保存后会用一次搜索验证是否可用。”

1. 官方创建入口：[DeepSeek API keys](https://platform.deepseek.com/api_keys)。链接由 [官方快速开始](https://api-docs.deepseek.com/) 提供，核对日期 2026-10-18。
2. 如未登录，用户自己登录/注册，处理验证码。页面文字变化时以实际的 API keys/创建密钥入口为准，不保证固定按钮位置。
3. 创建 Key 后妥善保存，按平台页面提示处理只显示一次的密钥。不要截图或录制密钥。
4. macOS 启动 `open -a Terminal "<skill_dir>/scripts/setup.command"`。Linux/Windows 用户在可见终端执行 `node "<skill_dir>/scripts/ds_search.mjs" setup`（需 Node.js 18+，`node --version` 检查）。无图形界面加 `--no-browser`，在自己的浏览器打开打印的链接。
5. Key 在本机隐藏输入，保存后会验证一次搜索。配置目录可由 XDG_CONFIG_HOME 指定，但必须是绝对路径；Windows 文件 ACL 由当前用户目录继承，600/700 只在 POSIX 环境承诺。
6. 若 agent 先启动了 guide-only，后续使用 `setup --no-browser` 避免重复开页。agent 应等用户完成输入，再用 `doctor` 核对，而不是索取 Key。

## 成功边界

| 状态 | 可以说什么 | 下一步 |
|---|---|---|
| `status` 成功 | 检测到配置 | 尚未验证 API；执行 doctor |
| setup 保存后 401 | 文件已保存，但密钥不可用 | 重新复制/创建；检查环境变量是否覆盖 |
| setup 保存后 402 | API 返回余额不足 | 用户在平台查看余额，自行决定充值 |
| doctor HTTP 200 且空结果 | API 有响应，未验证有效结果 | 用实际主题再查一次，不反复重置配置 |
| `search_verified: true` | 搜索实测成功 | 继续原查询；Fetch 单独验证 |

`DEEPSEEK_API_KEY` 优先于配置文件。setup 会验证刚保存的 Key，但后续查询仍使用环境变量；若环境变量过期，需要在真正运行 agent 的进程中更新/移除，单独开一个终端 unset 不会修改已运行 agent 的环境。

密钥明文保存在用户私有配置目录，由操作系统权限保护，并非加密保险箱。不写入 shell 历史、skill、README、截图、报告。删除本地文件只能删除本地副本；需要失效时由用户在官方平台撤销。没有真实 Key 时发布包可继续，但 API 成功必须标为 missing evidence。
