#!/usr/bin/env bash
# pre-commit：对暂存区的可 lint 文件跑 biome check。
set -uo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root" || exit 1
# 注意：biome.json 的 files.includes 排除了 **/*.json，所以这里也不能把 json 交给 biome，
# 否则「只改 package.json 的提交」会以 "No files were processed" 失败（2026-10-15 实测）。
files="$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx|js|mjs|cjs|css)$' || true)"
if [ -z "$files" ]; then
  echo "pre-commit: 无可 lint 的暂存文件，跳过。"
  exit 0
fi
echo "pre-commit: biome check $(echo "$files" | wc -l | tr -d ' ') 个文件…"
# shellcheck disable=SC2086
npx biome check $files
