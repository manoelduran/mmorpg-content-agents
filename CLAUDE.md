# Claude Code Instructions

See [`AGENTS.md`](./AGENTS.md) for the full architecture rules — this project keeps one rules document, not two that can drift apart.

Quick pointers:

- `npm run generate -- --brief "..."` — run the full pipeline.
- `npm run build:schema` — regenerate `schemas/content-package.schema.json` after changing a domain value-object.
- `npm run typecheck` — no build step needed for day-to-day work, this alone catches almost everything.

## Implemented Features

- **Eval Findings Fixes** (2026-11-19) — `loreReveal` on TALK_TO_NPC quests, one shared pt-BR instruction for every agent prompt, and eval fixes for giver/target and companion-NPC false positives
  → `docs/features/eval-findings-fixes/implementation.md`
