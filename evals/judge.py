"""OpenRouter-backed judge model for DeepEval, restricted to free models.

DeepEval's metrics call `generate(prompt, schema=SomePydanticModel)` and
accept either a schema instance or raw JSON text back (see
deepeval/metrics/utils/generation.py). We ask OpenRouter for that exact JSON
Schema via `response_format` — same approach the TS agents use — and
re-validate with pydantic, never trusting the provider's conformance.
"""

import os
from pathlib import Path
from typing import Optional, Type

from deepeval.models import DeepEvalBaseLLM
from dotenv import load_dotenv
from openai import AsyncOpenAI, OpenAI
from pydantic import BaseModel

# Same .env the pipeline reads — one key, one place.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class FreeModelRequiredError(ValueError):
    pass


def require_free_model(model_id: str) -> str:
    # OpenRouter marks zero-cost variants with a ":free" suffix; anything else
    # can bill the account, so refuse it outright instead of trusting config.
    if not model_id.endswith(":free"):
        raise FreeModelRequiredError(
            f"Judge model '{model_id}' is not a free OpenRouter model "
            "(must end with ':free'). Run `uv run python list_free_judges.py`."
        )
    return model_id


class OpenRouterJudge(DeepEvalBaseLLM):
    def __init__(self, model: Optional[str] = None):
        model_id = model or os.environ.get("OPENROUTER_JUDGE_MODEL", "")
        if not model_id:
            raise FreeModelRequiredError(
                "Set OPENROUTER_JUDGE_MODEL in .env to a ':free' model id."
            )
        self.model_id = require_free_model(model_id)
        api_key = os.environ["OPENROUTER_API_KEY"]
        self._client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key, max_retries=4)
        self._async_client = AsyncOpenAI(
            base_url=OPENROUTER_BASE_URL, api_key=api_key, max_retries=4
        )
        super().__init__(self.model_id)

    def load_model(self):
        return self._client

    def get_model_name(self) -> str:
        return f"openrouter/{self.model_id}"

    def _request(self, prompt: str, schema: Optional[Type[BaseModel]]) -> dict:
        request: dict = {
            "model": self.model_id,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
        }
        if schema is not None:
            request["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": schema.__name__,
                    "schema": schema.model_json_schema(),
                },
            }
        return request

    @staticmethod
    def _parse(content: Optional[str], schema: Optional[Type[BaseModel]]):
        if schema is None:
            return content or ""
        try:
            return schema.model_validate_json(content or "")
        except Exception:
            # Let DeepEval's own lenient JSON extraction (trimAndLoadJson) try
            # — some free models wrap valid JSON in prose or code fences.
            return content or ""

    def generate(self, prompt: str, schema: Optional[Type[BaseModel]] = None, **_):
        response = self._client.chat.completions.create(**self._request(prompt, schema))
        return self._parse(response.choices[0].message.content, schema)

    async def a_generate(
        self, prompt: str, schema: Optional[Type[BaseModel]] = None, **_
    ):
        response = await self._async_client.chat.completions.create(
            **self._request(prompt, schema)
        )
        return self._parse(response.choices[0].message.content, schema)
