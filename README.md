# mmorpg-content-agents

A Clean Architecture multi-agent pipeline that turns a one-line brief
("a coastal pirate town, level 15-20") into a validated, self-contained
**content package** — city lore, NPCs, quests, fields, instances, monster
stats, and sprite assets — for [Aetherbound Online](#), a Ragnarok-style
pixel-art MMORPG.

A hybrid, cost-aware setup: **Story and Dev** call
[OpenRouter](https://openrouter.ai/) directly (plain, provider-agnostic chat
completions — pick any model per agent, including free/cheap ones), while
**Art** stays on the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
the only one of the three that genuinely needs its tool-execution loop
(Bash/Read/Glob/Write, for finding and reusing existing sprites). See
"Why OpenRouter for Story/Dev, not OpenCode" in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for how that split was
decided. Same Clean Architecture / DDD discipline the game's own backend
uses throughout: `domain` → `application` → `infrastructure` →
`presentation`, ports and use-cases, zero framework leakage into business
logic.

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
| **Art** | Claude Agent SDK call, tool-enabled | `AssetManifest` (sprite files + provenance) | `StoryManifest` |
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
separate, not-yet-built "installer" — keeping this repo from ever needing
write access to the game's database is the whole reason it's a repo of its
own.

## Quick start

```bash
npm install
cp .env.example .env
# set ANTHROPIC_API_KEY (Art), OPENROUTER_API_KEY (Story/Dev), and
# OPENROUTER_STORY_MODEL / OPENROUTER_DEV_MODEL — pick current model ids
# from https://openrouter.ai/models (no defaults are hardcoded; that
# catalog, especially the free tier, changes often)

npm run generate -- --brief "a coastal pirate town, level 15-20" \
  --backend-path ../mmorpg-backend \
  --frontend-path ../mmorpg-frontend
```

Expects `mmorpg-backend`/`mmorpg-frontend` as sibling directories by
default (`../mmorpg-backend`, `../mmorpg-frontend`) — override with the
flags above if yours live elsewhere. Their `CLAUDE.md`/`AGENTS.md` are read
live off disk every run, never copied into this repo (see
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)).

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
│   ├── ports/
│   └── use-cases/        orchestrate-content-generation is the Master's logic
├── infrastructure/     # concrete adapters — the only layer that imports the Agent SDK / openai / fs
│   ├── agents/            OpenRouterStoryAgent, ClaudeArtAgent, OpenRouterDevAgent
│   └── persistence/       FilesystemTargetRepoConventions, FileManifestWriter
└── presentation/
    └── cli/               generate-package.cli.ts — the one place everything gets wired together
```

Full breakdown and the sequence diagram: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Known limitations (read before assuming this is fully autonomous)

- **Art can't actually draw.** Claude doesn't generate raster images. The
  Art agent's real job is search-first — reuse an existing sprite from
  `mmorpg-frontend` or the local "Pixel Art Top Down - Basic" pack — and
  only fall back to writing a ready-to-paste generation prompt
  (`AssetEntry.source === 'generated'`) when nothing fits. Turning that
  prompt into a pixel-art file is still a manual step today.
- **Not yet run end-to-end against live API keys.** The pipeline typechecks
  cleanly and the schema-generation step (`npm run build:schema`) has been
  verified to run and produce valid JSON Schema; the three agent calls
  themselves are implemented directly against each provider's documented
  API but haven't had a real run logged here yet — needs both
  `OPENROUTER_API_KEY` (Story/Dev) and `ANTHROPIC_API_KEY` (Art), and costs
  real money on both.
- **JSON Schema conformance from OpenRouter isn't guaranteed provider-to-
  provider** (OpenRouter's own docs say so) — the Story/Dev path re-validates
  every response with zod regardless (see `run-structured-openrouter-agent.ts`),
  the same defense-in-depth the Claude SDK path already had.
- Tests cover the deterministic parts and the retry/self-correction logic
  (`node --test`, no mocking framework). `run-structured-openrouter-agent.ts`
  (Story/Dev) has real unit coverage against a fake `ChatCompletionClient` —
  success, transient-error retry, refusal, and self-correction paths are all
  exercised without hitting the network. The Claude Agent SDK path (Art)
  still isn't covered by an automated test, since its `query()` call isn't
  easily fakeable the same way.

## Status

Early. This is the v1 scaffold: schema-validated pipeline, Clean
Architecture layering, the Story→{Art,Dev}→merge→validate flow. Animated
sprites, the game-database installer, and CI are explicitly future work —
see "Out of scope for v1" in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
