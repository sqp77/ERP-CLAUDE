#!/usr/bin/env bash
# Print every file in a web build directory as a bucket key (relative path, forward slashes), one per line, sorted.
# deploy-web.sh uploads this list as _deploy/files.txt so prune-web-assets.sh keeps every file of the live build,
# including assets referenced only from JS/CSS (logo, fonts, lazy chunks) that index.html never names.
#   scripts/web-file-list.sh apps/web/dist
set -euo pipefail
DIR="${1:?dist directory}"
( cd "$DIR" && find . -type f | sed 's#^\./##' | LC_ALL=C sort )
