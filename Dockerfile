# One container serves the API and the static UI. Build: `docker build -t quarry .`
# Run:   docker run -p 8000:8000 -e QUARRY_PROVIDER=gemini -e GEMINI_API_KEY=... quarry

# ---------------------------------------------------------------- web build
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# Same-origin API in production: the UI calls /api/* on the server that served it.
ENV NEXT_PUBLIC_API_URL="" NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------------------------------------------------------------- python app
FROM python:3.12-slim AS app
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv

# Run as an unprivileged user; the database file is read-only to the app anyway.
RUN useradd --create-home --uid 1000 quarry
USER quarry
WORKDIR /home/quarry/app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/home/quarry/app/.venv/bin:$PATH"

COPY --chown=quarry pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY --chown=quarry src/ src/
COPY --chown=quarry data/checksums.sha256 data/
RUN uv sync --frozen --no-dev

# Download the public dataset at build time and bake the read-only warehouse into the image.
RUN python -m quarry.data.build && rm -rf data/raw

COPY --chown=quarry --from=web /web/out web/out
COPY --chown=quarry evals/results/ evals/results/

# run_python needs OS-level network isolation (unshare), which containers rarely allow
# without extra privileges; Quarry detects that and disables the tool rather than run
# untrusted code unisolated. QUARRY_PYTHON_ENABLED=false makes that explicit.
ENV QUARRY_PYTHON_ENABLED=false QUARRY_TRUST_PROXY=true QUARRY_TRACE_DIR=/tmp/quarry-traces PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn quarry.api.app:app --host 0.0.0.0 --port ${PORT}"]
