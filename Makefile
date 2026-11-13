.PHONY: install data gold test lint format eval eval-smoke report readme site-data serve web web-build mcp docker clean

install:  ## Python deps, web deps and the static UI build
	uv sync
	cd web && npm ci && npm run build

data:  ## download the Olist dataset and build data/quarry.duckdb
	uv run python -m quarry.data.build

gold:  ## recompute ground-truth results from the hand-written SQL
	uv run python -m quarry.evals.benchmark

test:
	uv run pytest

lint:
	uv run ruff check src tests
	uv run ruff format --check src tests
	uv run mypy src

format:
	uv run ruff check --fix src tests
	uv run ruff format src tests

eval:  ## agent vs baseline on the full benchmark with the configured provider (resumable)
	uv run python -m quarry.evals.runner --system both $(if $(RUN),--run $(RUN),)
	uv run python -m quarry.evals.report $(if $(RUN),--run $(RUN),)

eval-smoke:  ## offline harness check with oracle fakes (no API calls)
	uv run python -m quarry.evals.runner --offline --fresh

report:
	uv run python -m quarry.evals.report $(if $(RUN),--run $(RUN),)

site-data:  ## export the numbers, analysis and sample rows the website shows into web/lib/generated
	uv run python scripts/export_site_data.py

readme:  ## regenerate the README results tables from evals/results (RUN=..., BEFORE=..., HELDOUT=...)
	uv run python -m quarry.evals.readme --run $(RUN) $(if $(BEFORE),--before $(BEFORE),) $(if $(HELDOUT),--heldout $(HELDOUT),)

serve:  ## API on :8000 (serves the built UI too, if web/out exists)
	uv run uvicorn quarry.api.app:app --host 0.0.0.0 --port 8000

web:  ## Next.js dev server on :3000, talking to the API on :8000
	cd web && npm run dev

web-build:
	cd web && npm run build

mcp:  ## MCP server over stdio (for Claude Desktop and other MCP clients)
	uv run python -m quarry.mcp.server

docker:
	docker build -t quarry .

clean:
	rm -rf .pytest_cache .ruff_cache traces/*.json web/.next web/out
