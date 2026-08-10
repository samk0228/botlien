#!/usr/bin/env bash
# One-command republish for the polished-UI prototype at botlien.com/software.
# Rebuilds from source, wraps it as a standalone page, commits, pushes, and
# deploys to the isolated Fly app (botlien-ui-preview). Run from anywhere.
set -euo pipefail

SRC_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../samk0228-botlien" && pwd)"
THIS_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "-> building prototype from source"
(cd "$SRC_REPO/prototype/src" && node build.cjs)

echo "-> wrapping as standalone page"
{
  printf '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">\n'
  cat "$SRC_REPO/prototype/botlien-prototype.html"
  printf '\n</body></html>\n'
} > "$THIS_REPO/ui-preview/index.html"

echo "-> committing"
cd "$THIS_REPO"
git add ui-preview/index.html
if git diff --cached --quiet; then
  echo "   no changes to commit"
else
  git commit -m "ui-preview: republish polished-UI prototype"
fi

echo "-> pushing"
git push origin main

echo "-> deploying to Fly"
cd ui-preview
flyctl deploy

echo "done -> https://botlien-ui-preview.fly.dev (and botlien.com/software once the Worker route is live)"
