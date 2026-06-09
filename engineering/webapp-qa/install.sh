#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install.sh <codex|claude|destination-path>

Examples:
  install.sh codex
  install.sh claude
  install.sh "$HOME/.config/my-agent/skills/webapp-qa"

Environment:
  WEBAPP_QA_SKILL_REF          Git ref to download when run remotely. Default: master
  WEBAPP_QA_SKILL_TARBALL_URL  Override the GitHub tarball URL.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 2
fi

case "$1" in
  codex)
    target="${CODEX_HOME:-$HOME/.codex}/skills/webapp-qa"
    ;;
  claude)
    target="${CLAUDE_HOME:-$HOME/.claude}/skills/webapp-qa"
    ;;
  *)
    target="$1"
    ;;
esac

if [ -z "$target" ] || [ "$target" = "/" ] || [ "$target" = "$HOME" ] || [ "$target" = "." ]; then
  echo "Refusing unsafe install target: $target" >&2
  exit 1
fi

script_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fi

tmpdir=""
cleanup() {
  if [ -n "$tmpdir" ] && [ -d "$tmpdir" ]; then
    rm -rf "$tmpdir"
  fi
}
trap cleanup EXIT

if [ -n "$script_dir" ] && [ -f "$script_dir/SKILL.md" ] && [ -d "$script_dir/references" ]; then
  source_dir="$script_dir"
else
  command -v curl >/dev/null 2>&1 || {
    echo "curl is required for remote installation." >&2
    exit 1
  }
  command -v tar >/dev/null 2>&1 || {
    echo "tar is required for remote installation." >&2
    exit 1
  }

  ref="${WEBAPP_QA_SKILL_REF:-master}"
  tarball_url="${WEBAPP_QA_SKILL_TARBALL_URL:-https://codeload.github.com/Newton-School/SKILLS/tar.gz/$ref}"
  tmpdir="$(mktemp -d)"

  curl -fsSL "$tarball_url" | tar -xz -C "$tmpdir"
  source_dir="$(find "$tmpdir" -type d -path "*/engineering/webapp-qa" -print -quit)"

  if [ -z "$source_dir" ]; then
    echo "Could not find engineering/webapp-qa in downloaded archive." >&2
    exit 1
  fi
fi

mkdir -p "$(dirname -- "$target")"
rm -rf "$target"
cp -R "$source_dir" "$target"

echo "Installed webapp-qa skill to $target"
