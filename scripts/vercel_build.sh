#!/usr/bin/env sh
# Vercel build: bake the read-only warehouse and the static UI into the deployment.
set -e
# Import from src/, not the installed copy in the build venv: the package finds data/ and
# the committed checksums relative to its own location.
PYTHONPATH="$PWD/src" python -m quarry.data.build
test -f data/quarry.duckdb
rm -rf data/raw
(cd web && npm ci --no-audit --no-fund && NEXT_PUBLIC_API_URL="" npm run build)
