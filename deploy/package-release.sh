#!/usr/bin/env bash
# Packs a built TAGPILOT for a server: the build output, the database migrations and the package lists.
# Never packs .env files, the local database or uploaded files.
# Run "npx next build" first. Usage: deploy/package-release.sh <output.tgz>
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:?give the output file}"
[ -f .next/BUILD_ID ] || { echo "Build first: npx next build"; exit 1; }
stage="$(mktemp -d)"
mkdir -p "$stage/app"
cp package.json package-lock.json next.config.ts "$stage/app/"
cp -r drizzle "$stage/app/"
# The build without its caches, development files and the links to this computer's packages.
tar -C . --exclude=.next/cache --exclude=.next/dev --exclude=.next/trace --exclude=.next/trace-build --exclude=.next/node_modules --exclude=.next/types -cf - .next | tar -C "$stage/app" -xf -
# Turbopack loads some packages through links in .next/node_modules; the server recreates them from this list.
( cd .next/node_modules && find . -type l | while read -r l; do
    target="$(readlink "$l")"; echo "${l#./} ${target##*/node_modules/}"; done ) > "$stage/app/.next-links.txt"
git rev-parse --short HEAD > "$stage/app/RELEASE"
tar -C "$stage/app" -czf "$out" .
rm -rf "$stage"
echo "packed $(du -h "$out" | cut -f1) into $out"
