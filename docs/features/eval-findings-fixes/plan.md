# Implementation Plan — Eval Findings Fixes

See `spec.md` for the design. Pipeline phases follow Red → Green → Refactor
with `node --test` (this repo has a real test runner, unlike
mmorpg-frontend). One commit per phase. Phases are ordered so every commit
leaves `npm test` and `npm run typecheck` green.

## Prerequisites

- `.env` has `OPENROUTER_API_KEY`, all three `OPENROUTER_*_MODEL` set to `:free` models, and `OPENROUTER_JUDGE_MODEL` set to a `:free` model.
- `uv` installed (`evals/` runs through it).
- Baseline: `npm test` green (0 failures, checked while writing this spec).

## Pipeline

### Phase 1 — `loreReveal` in the domain
1. **Red:** create `src/domain/value-objects/city-template.value-object.test.ts` with these cases:
   - a `TALK_TO_NPC` quest with `loreReveal` passes;
   - a `TALK_TO_NPC` quest without it fails, and the issue names the quest id;
   - an empty `loreReveal` fails;
   - a `KILL_MONSTER` quest with `loreReveal` fails;
   - a `KILL_MONSTER` quest without it passes.

   Confirm the test fails.
2. **Green:** add the field and the refinement to `CityQuestSchema`. Give the `TALK_TO_NPC` quests in `src/test-support/valid-city.fixture.ts` a `loreReveal`, so the existing suites stay green.
3. **Refactor:** check that the `.describe()` text matches spec.md. Run `npm run build:schema` and commit the regenerated `schemas/content-package.schema.json`.
4. Commit: `feat(domain): add loreReveal to TALK_TO_NPC quests`

### Phase 2 — Guardrails scan `loreReveal`
1. **Red:** in `apply-content-guardrails.use-case.test.ts`, add a case where an injection echo inside a quest's `loreReveal` raises `ContentGuardrailViolationError`. Confirm it fails.
2. **Green:** include `loreReveal`, when present, in the guardrail's quest text list.
3. **Refactor:** keep tests green.
4. Commit: `feat(guardrails): scan quest loreReveal for injection echoes`

### Phase 3 — Shared content-language instruction
1. **Red:** add or extend the following, each asserting that the captured `systemPrompt` contains `CONTENT_LANGUAGE_INSTRUCTION`:
   - new `openrouter-story-agent.test.ts`;
   - new `openrouter-dev-agent.test.ts`;
   - existing `generate-shop-inventory.skill.test.ts`.

   The fake client's response may be invalid for Story/Dev; the tests only inspect `calls[0]` and assert the promise rejects. Confirm they fail.
2. **Green:** create `src/infrastructure/agents/content-language.ts` and interpolate it into all three prompts. Delete Story's own pt-BR sentence so the rule exists once.
3. **Refactor:** keep tests green; `npm run typecheck`.
4. Commit: `fix(agents): require pt-BR for every player-facing string, including items`

### Phase 4 — Story prompt describes `loreReveal`
1. **Red:** in `openrouter-story-agent.test.ts`, assert that the system prompt's `TALK_TO_NPC` bullet mentions `loreReveal`. Confirm it fails.
2. **Green:** rewrite that bullet per spec.md Business Rule 2.
3. **Refactor:** keep tests green.
4. Commit: `feat(story): ask for loreReveal on TALK_TO_NPC quests`

## Evals

### Phase 5 — Close the eval blind spots
1. **Implement:** apply the `:talk-quests` case and the metric-step changes in `evals/cases.py` (spec.md, "Case and Metric Changes"). Update `evals/README.md`.
2. **Verify:** run `npm run eval` on the two existing manifests. Read the reasons in `evals/results/<latest>.json`:
   - the Aethelgard `:talk-quests` reason must not mention a giver/narrative mismatch;
   - the Necrópolis `:coherence` reason must not mention Zafira or Rami.

   Run twice, since judge scores are noisy.
3. Commit: `fix(evals): give the judge quest targets and companion-NPC context`

### Phase 6 — End-to-end validation on a new city
1. **Implement:** generate a new city, using free models only:
   `npm run generate -- --brief "<new brief>" --backend-path ../mmorpg-backend --frontend-path ../mmorpg-frontend`.
   Add it to `evals/goldens.json` with that exact brief.
2. **Verify:**
   - `manifest.json` validates;
   - every `TALK_TO_NPC` quest has a `loreReveal`;
   - run `npm run eval -- <cityId>` twice. `:language` must score ≥ 0.8 and `:talk-quests` ≥ 0.7 on both runs.
3. Commit: `chore(evals): add <cityId> as a golden`. `output/` is gitignored, so only `goldens.json` is committed.
