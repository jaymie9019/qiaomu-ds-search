#!/bin/sh
# Double-click on macOS or open with Terminal. The user enters the secret locally.
cd -- "$(dirname -- "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  node ds_search.mjs setup
  result=$?
else
  printf '未找到 node。请先从 https://nodejs.org/ 安装 Node.js 18+ 后重试。\n'
  result=127
fi
printf '\n配置程序已结束（退出码 %s）。按回车关闭。' "$result"
read -r ignored
exit "$result"
