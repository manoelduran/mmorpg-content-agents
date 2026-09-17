# mmorpg-content-agents

A Clean Architecture multi-agent pipeline that turns a one-line brief
("a coastal pirate town, level 15-20") into a validated, self-contained
**content package** — city lore, NPCs, quests, fields, instances, monster
stats, and sprite assets — for Aetherbound Online, a Ragnarok-style
pixel-art MMORPG (a separate, private repo).

A cost-aware setup: all three agents call [OpenRouter](https://openrouter.ai/)
directly (plain, provider-agnostic chat completions — pick any model per
agent, including free/cheap ones). Art's model additionally needs vision
input — it's shown thumbnails of sprites already committed to the game
purely as a style reference, and writes a fresh generation prompt for
every entity, always; a human draws every sprite by hand, so the agent
never reuses or produces a file itself. See "Why
OpenRouter for all three agents, not OpenCode or the Claude Agent SDK" in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for how that landed. Same
Clean Architecture / DDD discipline the game's own backend uses
throughout: `domain` → `application` → `infrastructure` → `presentation`,
ports and use-cases, zero framework leakage into business logic.

## Why this exists

Aetherbound's backend (a separate, private repo) already follows strict
Clean Architecture. This project asks: does that discipline hold up when
the "business logic" is *orchestrating language models* instead of HTTP
requests? The answer this repo argues for is yes — with one adjustment:
**the orchestrator (Master) is not itself an LLM call.** See
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full reasoning;
short version: a fixed, known sequence (generate story → fan out to art
and dev → merge → validate) is a correctness liability as a prompt and a
non-issue as fifteen lines of TypeScript.

## The four roles

| Agent | Runs as | Produces | Depends on |
|---|---|---|---|
| **Master** | plain TypeScript (`OrchestrateContentGenerationUseCase`) | the final `ContentPackage` | Story, Art, Dev's outputs |
| **Story** | OpenRouter chat completion | `StoryManifest` (lore, NPC roster, quests, portals/fields, instances) | the brief + retrieved World Registry context |
| **Art** | OpenRouter chat completion, vision-capable model | `AssetManifest` (sprite files + provenance) | `StoryManifest` |
| **Dev** | OpenRouter chat completion | `DevContent` (map sizes, spawn positions, quest counters, monster stats + drops) | `StoryManifest` + the target repo's own `CLAUDE.md`/`AGENTS.md` |

Story runs first and alone, because Art and Dev both *depend* on the
narrative as an input (Art needs atmosphere/theme, Dev needs which NPC
gives which quest) — neither should be inventing story details on the
side. Art and Dev then run in parallel off the same `StoryManifest`.

## City Template v1

Every generated city follows the same fixed shape — not a suggestion in a
prompt, an actual zod-enforced structure (`city-template.value-object.ts`).
A `StoryManifest` that doesn't match these counts fails validation before
Art or Dev ever see it:

| Element | Count | Detail |
|---|---|---|
| NPCs | **8** | 1 `MERCHANT`, 1 `TELEPORTER` (travels between nearby cities), 3 `QUEST_GIVER`, 1 `BLACKSMITH` (refines equipment), 2 `INSTANCE_MASTER` (one per instance) |
| Quests | **10** | Given by the 3 `QUEST_GIVER` npcs. Each is `KILL_MONSTER` or `TALK_TO_NPC` — the latter exists specifically to teach the player this city's lore, on top of an XP reward |
| Portals | **4** | One per cardinal direction (N/S/E/W) at the city's edges, each leading to exactly one field (1:1) |
| Fields | **4** | One per portal, each with exactly 3 distinct monster types |
| Field monster drops | **3 per monster** | Exactly 2 `COMMON` + 1 `RARE` |
| Instances | **2** | Each owned by its own `INSTANCE_MASTER`, each with exactly 3 monsters: 2 `NORMAL` + 1 `BOSS` |

This is enforced with `.length(n)` and `.superRefine()` on every relevant
array in `src/domain/value-objects/city-template.value-object.ts` — see
that file for the exact rules, and
`src/domain/entities/content-package.entity.ts`'s
`checkReferentialIntegrity` for the cross-references these counts alone
can't catch (a quest given by a non-`QUEST_GIVER`, an instance boss with no
matching sprite, etc.).

## What "manifest, not code" means

This pipeline never touches `mmorpg-backend`'s database, opens a PR
against it, or runs a migration. A finished run produces:

```
output/<cityId>/
├── manifest.json        # the full ContentPackage, matching schemas/content-package.schema.json
└── assets/
    └── *.png
```

Turning that manifest into real rows in the game (via the backend's own
`CreateMapUseCase`, `AddMonsterToMapUseCase`, etc.) is a deliberately
separate installer that lives in the game's own backend repo, not here —
keeping this repo from ever needing write access to the game's database
is the whole reason it's a repo of its own.

## Quick start

```bash
npm install
cp .env.example .env
# set OPENROUTER_API_KEY and OPENROUTER_STORY_MODEL / OPENROUTER_DEV_MODEL /
# OPENROUTER_ART_MODEL — pick current model ids from
# https://openrouter.ai/models (no defaults are hardcoded; that catalog,
# especially the free tier, changes often). Art's model additionally needs
# vision input — see .env.example's comment on that variable.

npm run generate -- --brief "a coastal pirate town, level 15-20" \
  --backend-path ../mmorpg-backend \
  --frontend-path ../mmorpg-frontend
```

Expects `mmorpg-backend`/`mmorpg-frontend` as sibling directories by
default (`../mmorpg-backend`, `../mmorpg-frontend`) — override with the
flags above if yours live elsewhere. Their `CLAUDE.md`/`AGENTS.md` are read
live off disk every run, never copied into this repo (see
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)).

### Extending a city that already partially exists

Not every city starts from nothing — Aethelgard, this game's own anchor
city, already exists as a hand-built map with 2 NPCs placed on it. Add
`--existing-city <path-to-json>` to pin those facts so Story/Dev complete
the city instead of inventing a competing one:

```bash
npm run generate -- --brief "Aethelgard, cidade âncora de 'O Paradoxo das Eras', nível 10-20" \
  --existing-city existing-cities/aethelgard.json \
  --backend-path ../mmorpg-backend --frontend-path ../mmorpg-frontend
```

See `existing-cities/aethelgard.json` for the exact shape (map identity +
existing NPCs with their real positions) and
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for how preserving those
pinned facts is enforced (reusing the same self-correction retry loop a
schema failure already triggers, not a separate mechanism).

Other scripts:

```bash
npm run typecheck     # tsc --noEmit
npm test              # node's built-in test runner, no mocking framework
npm run build:schema  # regenerate schemas/content-package.schema.json from the zod source of truth
```

## Tooling: RTK

The Dev agent (and anyone developing this repo) runs a lot of CLI commands
— `npm run typecheck`, `git`, `find`/`grep` while inspecting the target
repos' conventions. [RTK](https://www.rtk-ai.app/) is an optional,
zero-config proxy that compresses that command output by ~50-90% before it
reaches an agent's context window, without changing any prompt or command:

```bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
# or: brew install rtk-ai/tap/rtk
rtk init --global
```

It's an environment-level tool, not a project dependency — nothing in
`package.json` depends on it, and the pipeline runs identically without it.

## Project layout

```
src/
├── domain/            # zod schemas + inferred types, zero dependencies
│   ├── entities/         content-package.entity.ts (+ checkReferentialIntegrity)
│   └── value-objects/    story-manifest, asset-manifest, dev-content
├── application/        # ports (interfaces) + use-cases, depends only on domain/
│   ├── ports/             ...IStoryAgent, IDevAgent, IArtAgent, Skill<TInput, TOutput>
│   └── use-cases/        orchestrate-content-generation is the Master's logic
├── infrastructure/     # concrete adapters — the only layer that imports openai / sharp / fs
│   ├── agents/            OpenRouterStoryAgent, OpenRouterArtAgent, OpenRouterDevAgent, GenerateShopInventorySkill
│   └── persistence/       FilesystemTargetRepoConventions, FileManifestWriter
└── presentation/
    └── cli/               generate-package.cli.ts (full pipeline), regenerate-shop.cli.ts (one skill, standalone)
```

Full breakdown and the sequence diagram: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

### Regenerating just one piece: Skills

Not every change needs a full city rerun. `npm run regenerate:shop --
--manifest output/<cityId>/manifest.json --npc-id <merchant-or-blacksmith-id>`
regenerates a single NPC's shop inventory in an already-generated
manifest, in isolation — no Story/Art call, no touching maps or quests.
See "Skills: on-demand capabilities outside the fixed pipeline" in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for what this pattern is
and how it composes with the fixed pipeline above.

## Known limitations (read before assuming this is fully autonomous)

- **Art can't actually draw, and by design never reuses either.** No free
  model on OpenRouter can generate an image as output (checked directly
  against `https://openrouter.ai/models?output_modalities=image`), and
  every sprite in this project is hand-drawn by a human anyway. The Art
  agent shows a vision-capable model a handful of existing sprites as a
  style reference only, then always writes a fresh, ready-to-paste
  generation prompt for every entity (`AssetEntry.source === 'generated'`,
  always) — turning that prompt into a pixel-art file is a manual step.
- **OpenRouter's free tier is genuinely limited.** 50 requests/day with
  $0 lifetime credits purchased, 1000/day after a one-time (non-recurring)
  top-up of $10+ — and a *failed* attempt still counts against that quota,
  so a naive retry loop can dig the hole deeper. See `QuotaExceededError`
  in `domain/errors/agent-errors.ts` for how this pipeline detects that
  specific case and fails fast instead of retrying it. A full city costs
  roughly 28 requests (1 Story + ~26 Art, one per npc/monster + 1 Dev).
- **JSON Schema conformance from OpenRouter isn't guaranteed provider-to-
  provider** (OpenRouter's own docs say so) — every agent's path re-validates
  every response with zod regardless (see `run-structured-openrouter-agent.ts`).
- Tests cover the deterministic parts and the retry/self-correction logic
  (`node --test`, no mocking framework). `run-structured-openrouter-agent.ts`
  has real unit coverage against a fake `ChatCompletionClient`, shared by
  all three agents — success, transient-error retry, refusal, and
  self-correction paths are all exercised without hitting the network.
  `openrouter-art-agent.test.ts` additionally covers its own file-listing/
  thumbnailing/batching/resume logic against a real temp directory.

## Status

Working v1. Schema-validated pipeline, Clean Architecture layering, the
Story→{Art,Dev}→merge→validate flow, checkpointed recovery at batch
granularity, and a first `Skill` for standalone regeneration have all run
successfully end-to-end against live OpenRouter models, not just
typechecked. Animated sprites and CI are still future work — see "Out of
scope for v1" in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
