#!/usr/bin/env bash
# Backup the SmartVote SQLite database.
#
# Usage:
#   ./backup.sh [source_db_path] [backup_dir]
#
# Defaults assume the docker-compose setup where the DB lives in the
# `smartvote_data` volume, mounted at /data inside the backend container.
#
# Cron example (daily at 2am), run from the host:
#   0 2 * * * docker compose exec -T backend /app/scripts/backup.sh >> /var/log/smartvote-backup.log 2>&1

set -euo pipefail

SRC="${1:-/data/smartvote.db}"
DEST_DIR="${2:-/data/backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

if [ ! -f "$SRC" ]; then
  echo "Source database not found at $SRC" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/smartvote_${TIMESTAMP}.db"

# sqlite3 .backup is safer than a plain file copy while the DB may be in use
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$SRC" ".backup '$DEST'"
else
  cp "$SRC" "$DEST"
fi

echo "Backed up $SRC -> $DEST"

# Keep the last 30 backups only
ls -1t "$DEST_DIR"/smartvote_*.db 2>/dev/null | tail -n +31 | xargs -r rm -f
