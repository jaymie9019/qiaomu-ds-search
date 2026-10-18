#!/bin/sh
# Double-click on macOS or open with Terminal. The user enters the secret locally.
cd -- "$(dirname -- "$0")" || exit 1
python3 ds_search.py setup
result=$?
printf '\n配置程序已结束（退出码 %s）。按回车关闭。' "$result"
read -r ignored
exit "$result"
