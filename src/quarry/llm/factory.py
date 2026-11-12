"""Build the configured provider and price its usage."""

from __future__ import annotations

from quarry.config import Settings
from quarry.llm.base import LLMProvider, Usage

DEFAULT_MODELS = {"gemini": "gemini-3.5-flash-lite", "ollama": "qwen3.5:9b", "fake": "fake-1"}

# Paid "Standard" prices in USD per 1M tokens, from https://aistudio.google.com/docs/pricing
# (checked 2026-11-12). The free tier costs $0; we report the paid-tier equivalent so the
# cost of running Quarry at scale is visible. Thinking tokens bill as output tokens.
PRICES_PER_M: dict[str, tuple[float, float]] = {
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.6-flash": (0.75, 3.75),
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.1-flash-lite": (0.25, 1.50),
}


def paid_equivalent_usd(model: str, usage: Usage) -> float:
    price = PRICES_PER_M.get(model)
    if price is None:
        return 0.0
    in_price, out_price = price
    return (
        usage.input_tokens * in_price + (usage.output_tokens + usage.thinking_tokens) * out_price
    ) / 1e6


def get_provider(settings: Settings) -> LLMProvider:
    model = settings.model or DEFAULT_MODELS[settings.provider]
    if settings.provider == "gemini":
        from quarry.llm.gemini import GeminiProvider

        key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
        return GeminiProvider(key, model, rpm=settings.gemini_rpm)
    if settings.provider == "ollama":
        from quarry.llm.ollama import OllamaProvider

        return OllamaProvider(model, settings.ollama_host, think=settings.ollama_think)
    raise ValueError("the fake provider is built directly in tests")
