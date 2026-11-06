#!/usr/bin/env bash
# Daily backup of TAGPILOT on the server: its database and uploaded files.
# The service stops for a few seconds so the database is copied in a consistent state, and always starts again.
# Installed as /usr/local/sbin/tagpilot-backup, run by /etc/cron.d/tagpilot-backup. Keeps the newest 14 copies.
set -euo pipefail
dest=/var/backups/tagpilot
keep=14
stamp="$(date +%Y-%m-%d-%H%M)"
file="$dest/tagpilot-$stamp.tgz"
mkdir -p "$dest"
chmod 700 "$dest"

restart() { systemctl start tagpilot.service; }
trap restart EXIT
systemctl stop tagpilot.service
tar -C /opt/tagpilot -czf "$file.part" data storage
restart
trap - EXIT

# A copy that cannot be read is not a backup.
tar -tzf "$file.part" > /dev/null
mv "$file.part" "$file"
chmod 600 "$file"
ls -1t "$dest"/tagpilot-*.tgz | tail -n +$((keep + 1)) | xargs -r rm -f
echo "$(date '+%F %T') OK $(basename "$file") $(du -h "$file" | cut -f1); service $(systemctl is-active tagpilot.service)"
