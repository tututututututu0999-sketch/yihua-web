#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

show_dialog() {
  osascript -e "display dialog \"$1\" buttons {\"确定\"} default button \"确定\" with icon note" >/dev/null
}

NODE_BIN=""

# Accept a candidate only if it also satisfies the version floor, otherwise an
# old /usr/local/bin/node would shadow a newer one from a version manager.
try_candidate() {
  [ -z "$NODE_BIN" ] || return 0
  [ -x "$1" ] || return 0
  if "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
    NODE_BIN="$1"
  fi
  return 0
}

if command -v node >/dev/null 2>&1; then
  try_candidate "$(command -v node)"
fi
try_candidate "/opt/homebrew/bin/node"
try_candidate "/usr/local/bin/node"
try_candidate "$HOME/.volta/bin/node"
try_candidate "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
# Double-clicking a .command starts a bash login shell, which never sources the
# zsh rc files where nvm/fnm/asdf put node on the PATH. Look in their install
# directories directly; unmatched globs stay literal and fail the -x test.
for candidate in \
  "$HOME"/.nvm/versions/node/*/bin/node \
  "$HOME"/.asdf/installs/nodejs/*/bin/node \
  "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node \
  "$HOME"/Library/Application\ Support/fnm/node-versions/*/installation/bin/node; do
  try_candidate "$candidate"
done

if [ -z "$NODE_BIN" ]; then
  choice="$(osascript -e 'display dialog "易画需要 Node.js 22 或更高版本才能运行。现在打开官方下载页下载安装吗？安装完成后，请再次双击本文件。\n\n如果你已用 nvm、fnm 等版本管理器装过 Node 22+，可以改为打开终端，进入本文件夹后运行：PORT=4175 node server.mjs" buttons {"暂不安装", "下载 Node.js 22 LTS"} default button "下载 Node.js 22 LTS" with icon caution' -e 'button returned of result')"
  if [ "$choice" = "下载 Node.js 22 LTS" ]; then
    open "https://nodejs.org/en/download"
  fi
  exit 0
fi

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  cp ".env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

CURRENT_KEY="$(sed -n 's/^CCPROXY_API_KEY[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | head -n 1 | sed 's/^"//; s/"$//')"
if [ -z "$CURRENT_KEY" ] || [[ "$CURRENT_KEY" == *"请在这里填写"* ]]; then
  API_KEY="$(osascript -e 'display dialog "首次启动：请输入你自己的 CCPROXY API Key。\n\n密钥只保存到本机这个文件夹的 .env 中，不会上传或分享。" default answer "" buttons {"取消", "保存并启动"} default button "保存并启动" with hidden answer' -e 'text returned of result')" || exit 0
  if [ -z "$API_KEY" ]; then
    show_dialog "未填写 API Key，无法启动。下次双击后可重新输入。"
    exit 0
  fi
  API_KEY="$API_KEY" "$NODE_BIN" -e '
    const fs = require("fs");
    const path = process.argv[1];
    const key = process.env.API_KEY;
    let content = fs.readFileSync(path, "utf8");
    content = content.replace(/^CCPROXY_API_KEY\s*=.*$/m, `CCPROXY_API_KEY=${key}`);
    fs.writeFileSync(path, content, { mode: 0o600 });
  ' "$ENV_FILE"
fi

if lsof -nP -iTCP:4175 -sTCP:LISTEN >/dev/null 2>&1; then
  open "http://127.0.0.1:4175/"
  show_dialog "易画已在本机运行，已为你打开网站。"
  exit 0
fi

show_dialog "易画正在启动，浏览器将自动打开。关闭本窗口会停止本地服务。"
# Opening before the port is bound shows the tester a connection error first.
(
  for _ in $(seq 1 60); do
    if lsof -nP -iTCP:4175 -sTCP:LISTEN >/dev/null 2>&1; then
      open "http://127.0.0.1:4175/"
      exit 0
    fi
    sleep 0.25
  done
) &
PORT=4175 "$NODE_BIN" server.mjs
