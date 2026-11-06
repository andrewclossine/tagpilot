#!/usr/bin/env bash
# Unpacks a release into a folder, installs its production packages and recreates the build's package links.
# Usage: install-release.sh <release.tgz> <folder>
set -euo pipefail
tgz="${1:?release file}"; dir="${2:?folder}"
mkdir -p "$dir"
tar -C "$dir" -xzf "$tgz"
cd "$dir"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
mkdir -p .next/node_modules
while read -r link pkg; do
  [ -n "$link" ] || continue
  mkdir -p ".next/node_modules/$(dirname "$link")"
  depth="$(echo "$link" | tr -cd '/' | wc -c)"
  up="../.."; for _ in $(seq 1 "$depth"); do up="../$up"; done
  ln -sfn "$up/node_modules/$pkg" ".next/node_modules/$link"
  [ -e ".next/node_modules/$link" ] || { echo "missing package for $link"; exit 1; }
done < .next-links.txt
echo "installed release $(cat RELEASE) in $dir"
