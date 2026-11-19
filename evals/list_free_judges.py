"""Lists free OpenRouter models usable as a judge right now.

Same eligibility rule as .env.example spells out for the pipeline's agents:
the model must list BOTH `response_format` and `structured_outputs`. The free
lineup rotates, so check this before picking OPENROUTER_JUDGE_MODEL.
"""

import json
import urllib.request

with urllib.request.urlopen("https://openrouter.ai/api/v1/models") as response:
    models = json.load(response)["data"]

eligible = [
    m
    for m in models
    if m["id"].endswith(":free")
    and {"response_format", "structured_outputs"} <= set(m.get("supported_parameters", []))
]

for m in sorted(eligible, key=lambda m: -(m.get("context_length") or 0)):
    print(f"{m['id']:<50} ctx={m.get('context_length')}")
