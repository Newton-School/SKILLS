#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install.sh <codex|claude|destination-path>

Examples:
  install.sh codex
  install.sh claude
  install.sh "$HOME/.config/my-agent/skills/pixel-compare"

Environment:
  PIXEL_COMPARE_SKILL_REF          Git ref to download when run remotely. Default: master
  PIXEL_COMPARE_SKILL_TARBALL_URL  Override the GitHub tarball URL.
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

normalize_path() {
  local input="$1"
  local resolved remainder component

  case "$input" in
    /*)
      resolved="/"
      remainder="$input"
      ;;
    *)
      resolved="$(pwd -P)"
      remainder="$input"
      ;;
  esac

  while [ -n "$remainder" ]; do
    component="${remainder%%/*}"
    if [ "$remainder" = "$component" ]; then
      remainder=""
    else
      remainder="${remainder#*/}"
    fi

    case "$component" in
      ""|.)
        ;;
      ..)
        if [ "$resolved" != "/" ]; then
          resolved="${resolved%/*}"
          [ -n "$resolved" ] || resolved="/"
        fi
        ;;
      *)
        if [ "$resolved" = "/" ]; then
          resolved="/$component"
        else
          resolved="$resolved/$component"
        fi
        ;;
    esac
  done

  printf '%s\n' "$resolved"
}

canonicalize_path() {
  local input="$1"
  local resolved remainder component candidate

  case "$input" in
    /*)
      resolved="/"
      remainder="$input"
      ;;
    *)
      resolved="$(pwd -P)"
      remainder="$input"
      ;;
  esac

  while [ -n "$remainder" ]; do
    component="${remainder%%/*}"
    if [ "$remainder" = "$component" ]; then
      remainder=""
    else
      remainder="${remainder#*/}"
    fi

    case "$component" in
      ""|.)
        ;;
      ..)
        if [ "$resolved" != "/" ]; then
          resolved="${resolved%/*}"
          [ -n "$resolved" ] || resolved="/"
        fi
        ;;
      *)
        if [ "$resolved" = "/" ]; then
          candidate="/$component"
        else
          candidate="$resolved/$component"
        fi

        if [ -d "$candidate" ]; then
          resolved="$(cd -P -- "$candidate" && pwd)"
        else
          resolved="$candidate"
        fi
        ;;
    esac
  done

  printf '%s\n' "$resolved"
}

is_same_as_or_ancestor_of() {
  local candidate="$1"
  local protected_path="$2"

  [ -n "$protected_path" ] || return 1
  [ "$candidate" = "/" ] && return 0

  case "$protected_path" in
    "$candidate"|"$candidate"/*)
      return 0
      ;;
  esac

  return 1
}

case "$1" in
  codex)
    target="${CODEX_HOME:-$HOME/.codex}/skills/pixel-compare"
    ;;
  claude)
    target="${CLAUDE_HOME:-$HOME/.claude}/skills/pixel-compare"
    ;;
  *)
    target="$1"
    ;;
esac

if [ -z "$target" ]; then
  echo "Refusing unsafe install target: $target" >&2
  exit 1
fi

script_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
fi

requested_target="$target"
target="$(normalize_path "$requested_target")"
canonical_target="$(canonicalize_path "$requested_target")"
if [ "$(canonicalize_path "$target")" != "$canonical_target" ]; then
  echo "Refusing ambiguous install target through a symlink and parent segment: $requested_target" >&2
  exit 1
fi
if [ "$target" = "/" ]; then
  canonical_action_target="/"
else
  target_parent="${target%/*}"
  [ -n "$target_parent" ] || target_parent="/"
  target_name="${target##*/}"
  canonical_target_parent="$(canonicalize_path "$target_parent")"
  canonical_action_target="${canonical_target_parent%/}/$target_name"
fi
canonical_cwd="$(pwd -P)"
canonical_home=""
if [ -n "${HOME:-}" ]; then
  canonical_home="$(canonicalize_path "$HOME")"
fi
canonical_codex_home=""
if [ -n "${CODEX_HOME:-}" ]; then
  canonical_codex_home="$(canonicalize_path "$CODEX_HOME")"
elif [ -n "$canonical_home" ]; then
  canonical_codex_home="$canonical_home/.codex"
fi
canonical_claude_home=""
if [ -n "${CLAUDE_HOME:-}" ]; then
  canonical_claude_home="$(canonicalize_path "$CLAUDE_HOME")"
elif [ -n "$canonical_home" ]; then
  canonical_claude_home="$canonical_home/.claude"
fi

for protected_path in \
    "$canonical_home" \
    "$canonical_cwd" \
    "$script_dir" \
    "$canonical_codex_home" \
    "${canonical_codex_home:+$canonical_codex_home/skills}" \
    "$canonical_claude_home" \
    "${canonical_claude_home:+$canonical_claude_home/skills}"; do
  if is_same_as_or_ancestor_of "$canonical_target" "$protected_path"; then
    echo "Refusing unsafe install target: $requested_target (resolved to $canonical_target)" >&2
    exit 1
  fi
done

tmpdir=""
cleanup() {
  if [ -n "$tmpdir" ] && [ -d "$tmpdir" ]; then
    rm -rf "$tmpdir"
  fi
}
trap cleanup EXIT

if [ -n "$script_dir" ] && [ -f "$script_dir/SKILL.md" ] && [ -f "$script_dir/package.json" ] && [ -d "$script_dir/scripts" ]; then
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

  ref="${PIXEL_COMPARE_SKILL_REF:-master}"
  tarball_url="${PIXEL_COMPARE_SKILL_TARBALL_URL:-https://codeload.github.com/Newton-School/SKILLS/tar.gz/$ref}"
  tmpdir="$(mktemp -d)"

  curl -fsSL "$tarball_url" | tar -xz -C "$tmpdir"
  source_dir="$(find "$tmpdir" -type d -path "*/engineering/pixel-compare" -print -quit)"

  if [ -z "$source_dir" ]; then
    echo "Could not find engineering/pixel-compare in downloaded archive." >&2
    exit 1
  fi
fi

source_dir="$(canonicalize_path "$source_dir")"
if is_same_as_or_ancestor_of "$canonical_target" "$source_dir" \
    || is_same_as_or_ancestor_of "$source_dir" "$canonical_target" \
    || is_same_as_or_ancestor_of "$canonical_action_target" "$source_dir" \
    || is_same_as_or_ancestor_of "$source_dir" "$canonical_action_target"; then
  echo "Refusing install target that overlaps the skill source: $target (resolved to $canonical_target)" >&2
  exit 1
fi

mkdir -p "$(dirname -- "$target")"
rm -rf -- "$target"
cp -R "$source_dir" "$target"

echo "Installed pixel-compare skill to $target"
echo "Next: cd \"$target\" && npm ci && npx playwright install chromium"
