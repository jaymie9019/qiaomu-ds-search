# Grok 配置与排错

Grok 一侧通过 [grokx](https://github.com/jaymie9019/grokx) CLI 调用：Grok 在服务端执行网页和 X 搜索，返回总结和来源。只在命令实际失败时查本页。

## 安装

在 skill 目录运行：

```bash
GROKX="$(bash "<skill_dir>/scripts/install_grokx.sh")"
"$GROKX" search "..."
```

安装脚本会先检查已有的 `grokx` 是否支持 `search` 子命令，可用就直接复用；否则从 GitHub release 下载最新版到 `~/.local/bin`（不需要 sudo）。日志输出到 stderr，stdout 最后一行是可用的程序路径。目前提供 macOS（arm64 / x86_64）和 Linux x86_64 的预编译版本。

## 排错

| 失败输出 | 含义 | 处理 |
|---|---|---|
| `command not found: grokx`，且 `~/.local/bin/grokx` 也不存在 | 未安装 | 运行上面的安装命令，用输出的路径重试 |
| `error: unrecognized subcommand 'search'` | 已装的 `grokx` 太旧 | 同样运行安装脚本，它会替换成最新版 |
| ``Error: not logged in. Run `grokx login` first.`` | 还没做一次性 OAuth 登录 | **你不能替用户登录**：`grokx login` 会打开浏览器，只有用户本人能授权。请用户在自己的终端运行 `grokx login`（约 20 秒，凭据会保存），然后停下等待确认，不要循环重试。等待期间可以先用 DeepSeek 完成能做的部分 |
| 安装脚本提示平台不支持或下载失败 | 没有该平台的预编译版本 | 安装脚本会给出备选方案 `cargo install --git https://github.com/jaymie9019/grokx`（需要 Rust 工具链）。Windows 用户可以只用 DeepSeek 一侧 |
| 安装脚本提示 `~/.local/bin` 不在 PATH | PATH 缺失 | 你继续用 `$GROKX` 完整路径；告诉用户如需手动使用，把 `~/.local/bin` 加进 PATH |
| 超时 | 查询太宽或用了 `heavy` | 收窄问题、降一档 `--depth`，或调大 `--timeout` 和你自己的命令超时 |

access token 过期**不算**故障：`grokx status` 可能显示过期，但 `search` 会自动刷新。
