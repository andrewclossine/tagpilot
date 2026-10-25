#!/bin/sh
# Daily backup of TAGPILOT: the database and the uploaded documents, kept for 14 days.
# Run from the folder that holds docker-compose.yml, e.g. from cron:
#   30 2 * * * cd /opt/tagpilot && ./deploy/backup.sh >> /var/log/tagpilot-backup.log 2>&1
set -eu
DEST="${BACKUP_DIR:-/opt/tagpilot-backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"

docker compose exec -T db pg_dump -U tagpilot -d tagpilot --format=custom > "$DEST/db_$STAMP.dump"
docker compose exec -T app tar -czf - -C /app storage > "$DEST/storage_$STAMP.tar.gz"

# Keep two weeks of backups.
find "$DEST" -type f -mtime +14 -delete
echo "$(date) backup ok: $DEST/db_$STAMP.dump"
