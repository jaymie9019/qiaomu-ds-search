#!/usr/bin/env bash
# Ensure a `grokx` binary that supports the `search` subcommand is available,
# installing the latest prebuilt release from GitHub if needed.
#
# Capability-gated on purpose: a `grokx` may exist on PATH but be too old to have
# `search`. We only reuse one that passes `grokx search --help`; otherwise we
# install the latest to ~/.local/bin. This also dodges the case where an older
# grokx earlier on PATH would otherwise shadow a freshly installed one.
#
# Contract: progress/logs go to STDERR; the single line on STDOUT is the path to
# a usable grokx binary. Callers can therefore do:  GROKX="$(bash install.sh)"
set -euo pipefail

REPO="jaymie9019/grokx"
INSTALL_DIR="${GROKX_INSTALL_DIR:-$HOME/.local/bin}"
BIN="$INSTALL_DIR/grokx"

log() { echo "$@" >&2; }

has_search() { "$1" search --help >/dev/null 2>&1; }

# Reuse an existing, capable grokx unless GROKX_FORCE=1.
if [ "${GROKX_FORCE:-0}" != "1" ]; then
  if existing="$(command -v grokx 2>/dev/null)" && has_search "$existing"; then
    log "grokx already installed and supports search: $existing"
    echo "$existing"; exit 0
  fi
  if [ -x "$BIN" ] && has_search "$BIN"; then
    log "grokx already installed at $BIN"
    echo "$BIN"; exit 0
  fi
  if command -v grokx >/dev/null 2>&1; then
    log "Found a grokx on PATH without the 'search' subcommand — installing the latest."
  fi
fi

os="$(uname -s)"
arch="$(uname -m)"
target=""
case "$os" in
  Darwin)
    case "$arch" in
      arm64|aarch64) target="aarch64-apple-darwin" ;;
      x86_64)        target="x86_64-apple-darwin" ;;
    esac ;;
  Linux)
    case "$arch" in
      x86_64) target="x86_64-unknown-linux-gnu" ;;
    esac ;;
esac

if [ -z "$target" ]; then
  log "Unsupported platform: $os/$arch."
  log "Build from source instead: cargo install --git https://github.com/$REPO"
  exit 1
fi

url="https://github.com/$REPO/releases/latest/download/grokx-${target}.tar.gz"
log "Downloading grokx ($target) from $url"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! curl -fsSL "$url" -o "$tmp/grokx.tar.gz"; then
  log "Download failed. No release asset for $target yet?"
  log "Fallback: cargo install --git https://github.com/$REPO"
  exit 1
fi

tar -xzf "$tmp/grokx.tar.gz" -C "$tmp"
mkdir -p "$INSTALL_DIR"
mv "$tmp/grokx" "$BIN"
chmod +x "$BIN"
# curl downloads usually aren't quarantined, but clear it defensively so
# macOS Gatekeeper doesn't block the binary.
if [ "$os" = "Darwin" ]; then
  xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true
fi

log "Installed: $BIN ($("$BIN" --version 2>/dev/null || echo grokx))"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) : ;;
  *)
    log "NOTE: $INSTALL_DIR is not on your PATH."
    log "Add it for manual use (e.g. ~/.zshrc): export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

# Final stdout line: the usable binary path.
echo "$BIN"
