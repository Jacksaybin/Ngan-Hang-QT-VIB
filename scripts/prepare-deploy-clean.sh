#!/usr/bin/env bash
set -euo pipefail

# prepare-deploy-clean.sh
# Tạo một archive "sạch" cho triển khai: loại bỏ tệp test, demo và tệp rác.
# Chạy trên Linux / WSL / Git Bash.

REPO_ROOT=$(pwd)
TS=$(date +%Y%m%d-%H%M%S)
TMPDIR=$(mktemp -d /tmp/deploy-clean-${TS}.XXXX)
OUTFILE=deploy-clean-${TS}.tar.gz
EXCLUDE_FILE=${TMPDIR}/exclude.txt
DRYRUN=0

# Preflight: ensure lib/telegram-queue.js exists in repository
if [ ! -f "./lib/telegram-queue.js" ]; then
  echo "ERROR: required file ./lib/telegram-queue.js not found in repository. Aborting create-archive." >&2
  exit 1
fi

usage(){
  cat <<EOF
Usage: $0 [--dry-run] [--archive-name name]

--dry-run       : chỉ liệt kê các tệp sẽ bị loại bỏ/không được đóng gói
--archive-name  : tên file tar.gz kết quả (mặc định: ${OUTFILE})

Script will copy repository into a temporary folder excluding patterns,
then create a compressed tar.gz package ready to upload to the server.
EOF
}

while [[ ${#} -gt 0 ]]; do
  case "$1" in
    --dry-run) DRYRUN=1; shift ;;
    --archive-name) OUTFILE=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

# Static exclude patterns
cat > "$EXCLUDE_FILE" <<'EOF'
.git
node_modules
**/node_modules/**
**/test/**
**/tests/**
**/*.test.js
**/*.spec.js
**/*.test.ts
**/*.spec.ts
**/coverage/**
**/deploy-*.tar*
*.tar
*.tar.gz
**/.DS_Store
**/.vscode/**
EOF

# Exclude root HTML files except index.html (dynamic)
# Find top-level .html files in repo root (not recursive) and exclude them except index.html
while IFS= read -r -d $'\0' f; do
  name=$(basename "$f")
  if [[ "$name" != "index.html" ]]; then
    echo "/${name}" >> "$EXCLUDE_FILE"
  fi
done < <(find . -maxdepth 1 -type f -name '*.html' -print0)

# Also exclude some obvious demo file names if present (add more if desired)
cat >> "$EXCLUDE_FILE" <<'EOF'
/dang-xu-ly.html
/huy-tam-khoa-the.html
/mo-the-tin-dung.html
/nang hm html.html
/nang-han-muc.html
/otp.html
/otphtml1.html
/sua-yeu-cau.html
/yeu-cau-da-gui.html
EOF

# Print exclude file for debugging
echo "Exclude patterns (saved to $EXCLUDE_FILE):"
cat "$EXCLUDE_FILE"

echo "\nCreating temporary copy in $TMPDIR (rsync). This will exclude patterns above."

# Perform rsync copy excluding patterns
RSYNC_EXCLUDES=(--exclude-from="$EXCLUDE_FILE")

if [ "$DRYRUN" -eq 1 ]; then
  echo "DRY RUN: files that would be copied (kept) to tempdir:"
  rsync -av --exclude-from="$EXCLUDE_FILE" --exclude="$TMPDIR" ./ "$TMPDIR/" | sed -n '1,200p'
  echo "\nDRY RUN: files that would be excluded (not copied):"
  # Show files excluded by comparing file lists
  (cd "$REPO_ROOT" && find . -type f | sed 's|^\./||' | sort) > ${TMPDIR}/all_files.txt
  (cd "$TMPDIR" && find . -type f | sed 's|^\./||' | sort) > ${TMPDIR}/kept_files.txt
  echo "Files excluded (first 200):"
  comm -23 ${TMPDIR}/all_files.txt ${TMPDIR}/kept_files.txt | sed -n '1,200p'
  echo "\nDry-run complete. No files changed."
  exit 0
fi

rsync -a --delete --exclude-from="$EXCLUDE_FILE" ./ "$TMPDIR/"

# Ensure lib/telegram-queue.js exists in the temporary copy: if rsync excluded lib for any reason,
# copy it explicitly from the repo root so archives always contain the queue implementation.
if [ ! -f "$TMPDIR/lib/telegram-queue.js" ]; then
  echo "lib/telegram-queue.js not found in temp copy; attempting to copy lib/ from repo root..."
  if [ -d "./lib" ]; then
    mkdir -p "$TMPDIR/lib"
    cp -a ./lib/. "$TMPDIR/lib/"
  else
    echo "ERROR: repository does not contain ./lib directory. Aborting." >&2
    rm -rf "$TMPDIR"
    exit 1
  fi
fi

if [ ! -f "$TMPDIR/lib/telegram-queue.js" ]; then
  echo "ERROR: After copy, $TMPDIR/lib/telegram-queue.js is still missing. Aborting." >&2
  rm -rf "$TMPDIR"
  exit 1
fi

# Create tar.gz from tempdir
echo "Creating archive ${OUTFILE} from temp dir..."
( cd "$TMPDIR" && tar -czf "${REPO_ROOT}/${OUTFILE}" . )

echo "Archive created: ${REPO_ROOT}/${OUTFILE}"

# Optional: remove tempdir
rm -rf "$TMPDIR"

echo "Done. Ready to upload ${OUTFILE} to your VPS (e.g. scp ...:/tmp/)."

echo "Suggested upload command (Windows PowerShell):"
echo "scp -o IdentitiesOnly=yes -i C:\\Users\\truon\\.ssh\\id_ed25519_new ${OUTFILE} deploy@103.180.134.74:/tmp/"

exit 0
