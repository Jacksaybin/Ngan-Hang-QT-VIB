#!/usr/bin/env bash
REMOTE=${1:-origin}
BRANCH=${2:-main}
MSG=${3:-"Update from local"}

git add .
git commit -m "$MSG"
git push "$REMOTE" "$BRANCH"

echo "If push fails due to auth, configure SSH keys or use HTTPS with credentials/token."
