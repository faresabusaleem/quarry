#!/usr/bin/env sh
# Vercel build: bake the read-only warehouse and the static UI into the deployment.
set -e
python -m quarry.data.build
rm -rf data/raw
(cd web && npm ci --no-audit --no-fund && NEXT_PUBLIC_API_URL="" npm run build)
