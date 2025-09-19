#!/usr/bin/env bash
# Cleanup script - remove common junk files from repository
set -euo pipefail

EXCLUDE_ARGS=()
if [[ ${1:-} == '--exclude' ]]; then
  shift
  while [[ ${1:-} && ${1:0:1} != '-' ]]; do
    EXCLUDE_ARGS+=("$1"); shift
  done
fi

DEFAULT_EXCLUDES=("public/uploads" "uploads" "node_modules" ".git" ".github")
if [[ -f .cleanupignore ]]; then
  mapfile -t FILE_EXCLUDES < .cleanupignore
else
  FILE_EXCLUDES=()
fi

EXCLUDES=(${DEFAULT_EXCLUDES[@]} ${FILE_EXCLUDES[@]} ${EXCLUDE_ARGS[@]})

echo "Scanning for junk files..."
patterns=("*.log" "*.err" "*.tmp" "*.bak" "*.pid")
for p in "${patterns[@]}"; do
  while IFS= read -r -d $'\0' file; do
    skip=false
    for ex in "${EXCLUDES[@]}"; do
      if [[ "$file" == *"$ex"* ]]; then skip=true; break; fi
    done
    if [[ "$skip" == true ]]; then
      echo "Skipping excluded: $file"
      continue
    fi
    echo "Removing: $file"
    rm -f "$file" || true
  done < <(find . -type f -name "$p" -print0)
done

echo "Done."
