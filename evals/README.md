# evals

Offline quality scoring of finished content packages with
[DeepEval](https://deepeval.com). The judge is a free OpenRouter model;
`judge.py` refuses any model id that doesn't end in `:free`.

The TS side already guarantees *structure* (zod, city-template counts,
`checkReferentialIntegrity`). This folder covers what code can't decide:

| Case suffix | Metric | Asks |
|---|---|---|
| `:brief` | Aderência ao brief | Does the city reflect what the brief asked for? |
| `:talk-quests` | Quests TALK_TO_NPC ensinam lore | Does each quest's `loreReveal` (what the target NPC says) teach a concrete, non-contradicting, non-repeated fact? Sees giver and target, so a narrative naming the target isn't a mismatch. Manifests from before `loreReveal` existed fail this by design. |
| `:coherence` | Coerência narrativa | Do NPCs, monsters, places and quests fit each other? Instance companions and portal guardians are outside the roster by design. |
| `:language` | Consistência de idioma | Is every player-facing string (drops, shop items included) in the lore's language? |
| `:art` | Prompts de arte acionáveis | Could an artist draw each sprite from its prompt alone? |

Each case is one judge call (`evaluation_steps` are fixed in `cases.py`,
so DeepEval doesn't spend an extra call writing them).

## Setup

```bash
# in ../.env (same file the pipeline uses)
OPENROUTER_JUDGE_MODEL=<a :free model id>

cd evals
uv run python list_free_judges.py   # current free models with structured outputs
```

## Running

```bash
npm run eval                          # from the repo root: score table + results/<timestamp>.json
uv run python report.py necropolis    # only cases whose id contains "necropolis"
uv run pytest                         # same cases as a pass/fail test suite
```

## Adding a city

Add an entry to `goldens.json` with the brief that produced it and the path
to its manifest. If a metric doesn't apply to that manifest's data, opt out
with `"skip": {"<case-suffix>": "<why>"}` (see Aethelgard's `art`).

## Comparing models

Generate the same briefs with two different `OPENROUTER_STORY_MODEL`s (into
different output roots), point `goldens.json` at each, and diff the two
`results/*.json`. Judge scores are noisy run to run (the same case has
moved by ±0.3 between runs): compare averages over a few runs, not one.
