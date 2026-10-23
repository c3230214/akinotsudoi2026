#!/usr/bin/env bash
# Build a self-contained ZIP for the Linux server (no npm access needed there).
# Usage: ./build-zip.sh [--with-qr]
#   --with-qr  include ./stamp-qr (printed QR files and stamp-tokens.json, keep private)
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
NAME="marugoto-bingo-${VERSION}"
OUT="dist/${NAME}"
rm -rf "${OUT}" && mkdir -p "${OUT}/server"

(cd server && npm test)

cp -r web deploy docs README.md CLAUDE.md "${OUT}/"
cp -r server/src server/scripts server/config server/package.json server/package-lock.json "${OUT}/server/"
# Production dependencies only. All are pure JavaScript (SQLite is node:sqlite),
# so node_modules built here also runs on the Linux server.
(cd "${OUT}/server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
if [[ "${1:-}" == "--with-qr" && -d stamp-qr ]]; then cp -r stamp-qr "${OUT}/"; fi
echo "${VERSION}" > "${OUT}/VERSION"
(cd dist && rm -f "${NAME}.zip" && zip -qr "${NAME}.zip" "${NAME}")
echo "dist/${NAME}.zip"
