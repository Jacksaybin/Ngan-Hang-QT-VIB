#!/usr/bin/env bash
set -euo pipefail
# push-to-github.sh
# Usage: ./tools/push-to-github.sh [REMOTE_URL] [BRANCH]
# If REMOTE_URL is omitted, script prompts. Default BRANCH=main

REMOTE_URL=${1:-}
BRANCH=${2:-main}

echo "Working directory: $(pwd)"

if [ ! -d .git ]; then
  echo "No git repo detected. Initializing..."
  git init
fi

if [ -z "$REMOTE_URL" ]; then
  read -p "Enter Git remote URL (e.g. git@github.com:user/repo.git or https://github.com/user/repo.git): " REMOTE_URL
fi

if ! git remote | grep -q '^origin$'; then
  git remote add origin "$REMOTE_URL"
else
  echo "Remote 'origin' already exists. Updating URL to $REMOTE_URL"
  git remote set-url origin "$REMOTE_URL"
fi

# Add all files and commit
git add -A
git commit -m "chore: initial commit - prepare repo for GitHub" || true

# Ensure branch exists locally
git branch --show-current || git checkout -b "$BRANCH"

echo "Pushing to origin/$BRANCH..."
git push -u origin "$BRANCH"

echo "Push complete. Verify on GitHub and set repository visibility/branch protection as needed."
