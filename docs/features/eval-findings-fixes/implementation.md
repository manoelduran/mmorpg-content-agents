# Implementation — Eval Findings Fixes
*Branch: `fix/item-drop-descriptions` (mmorpg-content-agents) · Completed: 2026-11-19*

## Summary

The first DeepEval run over finished manifests found two real pipeline
defects and two false positives in the eval itself:
- **Pipeline:** Dev and the shop skill wrote items in English, and
  `TALK_TO_NPC` quests had no place to hold the fact they teach. Both are
  fixed: a shared pt-BR instruction, and a new `loreReveal` quest field.
- **Eval:** the judge now sees quest targets and knows about companion NPCs,
  so it no longer reports those false positives.

A city generated after the change (`mare-funda`) passes every eval metric on
two consecutive runs.

## Pipeline (`src/`)

- **Domain:** `src/domain/value-objects/city-template.value-object.ts` gets
  `CityQuestSchema.loreReveal`, required (non-blank) for `TALK_TO_NPC` and
  forbidden for `KILL_MONSTER` via `.superRefine()`. The issue messages name
  the quest id.
- `src/infrastructure/agents/content-language.ts` (new):
  `CONTENT_LANGUAGE_INSTRUCTION`, the only place pt-BR is stated.
  Interpolated into `openrouter-story-agent.ts`, `openrouter-dev-agent.ts`
  and `generate-shop-inventory.skill.ts`. Story's old pt-BR sentence was
  removed.
- `src/infrastructure/agents/openrouter-story-agent.ts`: the `TALK_TO_NPC`
  bullet asks for `loreReveal`. It may add new facts, must not contradict the
  lore, and must not repeat another quest's fact.
- `src/application/use-cases/apply-content-guardrails.use-case.ts`: the
  injection-echo scan now includes `loreReveal`.
- **Data model:** `schemas/content-package.schema.json` regenerated, with
  `loreReveal` added.
- **Tests** (`npm test`: 73 pass, 0 fail; typecheck clean):
  - new `city-template.value-object.test.ts`, `openrouter-story-agent.test.ts`
    and `openrouter-dev-agent.test.ts`;
  - extended `apply-content-guardrails.use-case.test.ts` and
    `generate-shop-inventory.skill.test.ts`;
  - `valid-city.fixture.ts` gives its `TALK_TO_NPC` quests a `loreReveal`.

## Evals (`evals/`)

- The harness itself (DeepEval 4.3.4, free-only OpenRouter judge, `npm run
  eval`) landed in `d825e7a` as the base for this feature. See
  `evals/README.md`.
- `evals/cases.py`:
  - the `:talk-quests` case shows giver, target (joined from
    `dev.questObjectives`) and `loreReveal`;
  - its steps judge the `loreReveal` fact, allow new facts, and state that
    giver ≠ target by design;
  - the `:coherence` steps state that instance companions and portal
    guardians sit outside the roster, and the story view now includes
    `portals`.
- `evals/goldens.json`: adds `mare-funda`.
- **Verification:**
  - AC7, on the existing manifests, two runs: no giver/narrative-mismatch
    reason for Aethelgard, and no Zafira/Rami reason for Necrópolis.
  - AC8, on `mare-funda`, two runs: `:language` 1.00/1.00 and
    `:talk-quests` 1.00/1.00. All 5 metrics passed both times.

## Known Gaps / Follow-ups

- **Pre-change manifests no longer parse.** `output/aethelgard` and
  `output/necropolis-de-eter` lack `loreReveal`, so `ContentPackageSchema`
  rejects them. That means `npm run regenerate:shop` fails on them, and they
  score 0.0 on `:talk-quests`. Leaving them unmigrated was decided in the
  spec interview; regenerating them is a separate task.
- **Necrópolis still scores 0.20 on `:language`.** Its manifest predates the
  language fix.
- **Art model changed.** `nex-agi/nex-n2.5-pro:free` left OpenRouter's free
  tier mid-run, so the local `.env` now uses
  `dots-studio/dots-3-note-preview:free`. The `.env.example` comment was
  updated to match.
- **No security eval yet.** A prompt-injection eval (canary tokens plus
  DeepEval's `PromptInjectionClassifier`/`DataLeakageClassifier` over
  adversarial goldens) was discussed but not specced.
- **The future installer** in `mmorpg-backend` should treat `loreReveal` as
  the target NPC's dialogue. That installer is out of scope here.
