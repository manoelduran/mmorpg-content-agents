# Architecture

## Why a Master that isn't itself an LLM call

The obvious design is "four agents, Master included, all talking to each
other." This repo deliberately does something narrower: **Story, Art, and
Dev are the LLM-calling agents; Master is plain, deterministic
TypeScript** (`OrchestrateContentGenerationUseCase`).

The reasoning: orchestration here is a fixed, known sequence — run Story,
then run Art and Dev off Story's output, then merge and validate. None of
that benefits from an LLM deciding it fresh each time, and every LLM call
is a chance to skip a step, hallucinate a different order, or silently drop
a validation pass. Making Master ordinary code means:

- It's unit-testable without an `OPENROUTER_API_KEY`.
- The sequence (Story → {Art, Dev} in parallel → merge → validate) is
  provably always followed, not "usually followed by a well-prompted
  model."
- Adding a step (e.g. a future QA agent) is a one-line change to the
  use-case, not a prompt-engineering exercise on the Master's own system
  prompt.

This is the same instinct DDD applies to any workflow: put business rules
in code you can read and test, keep the non-deterministic part (creative
generation) isolated behind a narrow interface. Story/Art/Dev are that
non-deterministic part — each is a single schema-constrained LLM call via
OpenRouter's `response_format: {type:'json_schema', ...}` (the same JSON
Schema `z.toJSONSchema()` already produces for us), so even the "AI part"
is schema-constrained at the boundary.

## Why OpenRouter for all three agents, not OpenCode or the Claude Agent SDK

v1 had all three agents on the Claude Agent SDK, paying Anthropic's list
price for every call. Reducing that cost meant picking a way to route
different agents to different providers/models. Two options were evaluated
for real (not from marketing pages — from the actual installed package
types) before choosing:

- **OpenCode** (`@opencode-ai/sdk`) — inspected via `npm pack`, not just its
  docs. It's a general-purpose *interactive coding agent* harness: it spawns
  a child-process server, requires session lifecycle
  (`session.create()` → `prompt()` → ...), and its own documented structured-
  output call shape didn't match the types actually published in the
  package at the version checked. To get the one thing we wanted from it —
  per-call model/provider routing — we'd have taken on all of that
  complexity, plus a real doc/type mismatch risk, just to reach a stateless
  JSON-generation call it wasn't designed around.
- **OpenRouter directly** — an OpenAI-compatible endpoint, called with the
  official `openai` package pointed at OpenRouter's `baseURL`. No session,
  no child process — a stateless request/response shape. **Chosen.**

Along the way, a real constraint surfaced: **Art had actual tools**
(Bash/Read/Glob/Write, to search `mmorpg-frontend` for a reusable sprite
before asking for a new one). That tool-execution loop was something the
Claude Agent SDK ran for us; OpenRouter's plain chat completions API has no
equivalent. The migration therefore stayed intentionally hybrid at first:
Story and Dev (zero tools, pure text-in-JSON-out) moved to OpenRouter; Art
stayed on the Claude Agent SDK.

That split later got revisited, and the tool-execution loop turned out to
be solving the wrong layer of the problem. "Search mmorpg-frontend for a
matching sprite" isn't actually a task that benefits from an agent
*deciding* how to search — it's a fixed operation (list a directory,
thumbnail some candidates) that Master-style deterministic code can just
do, the same reasoning this doc already applies to orchestration itself.
`OpenRouterArtAgent` does exactly that: it lists `mmorpg-frontend`'s sprite
files and thumbnails candidates in plain TypeScript, then hands the model
only the genuinely creative decision — look at a few candidate images plus
the entity's narrative, decide reuse-vs-generate. That's a single
vision-capable chat-completion call, the same shape as Story/Dev, no tool
loop needed. See `openrouter-art-agent.ts`.

One real constraint this introduced: as of this writing, no free model on
OpenRouter can *generate* an image as output (checked
`https://openrouter.ai/models?output_modalities=image` directly — every
image-output model listed is paid). `OpenRouterArtAgent` was designed
around that fact rather than against it: it never asks a model to produce
an image, only to reason over ones it's shown. When nothing existing fits,
the output is still a ready-to-paste generation prompt for a human (or a
future pluggable image-gen step) — same contract `ClaudeArtAgent` always
had, see "Known limitation" below.

See `openrouter-client.ts` for the `ChatCompletionClient` port this
introduced (and why it's a port when a raw SDK call isn't — the answer is
testability, not dogma) and `run-structured-openrouter-agent.ts`, the
shared runner all three agents call, for the retry/self-correction/error-
taxonomy machinery (`retry-policy.ts`, `agent-errors.ts`).

## The pipeline

```
CLI brief
   │
   ▼
┌─────────────────────────────┐
│ GenerateStoryUseCase          │──▶ StoryManifest (zod-validated)
└─────────────────────────────┘
   │
   ├──────────────────────────────┐
   ▼                               ▼
┌───────────────────────┐   ┌────────────────────────────────┐
│ GenerateAssetsUseCase   │   │ LoadTargetRepoConventionsUseCase │
│  (Art agent)             │   │  (reads mmorpg-backend's live    │
└───────────────────────┘   │   CLAUDE.md/AGENTS.md/workflow)  │
   │                         └────────────────────────────────┘
   │                               │
   │                               ▼
   │                         ┌────────────────────────────┐
   │                         │ GenerateDevContentUseCase    │
   │                         │  (Dev agent)                  │
   │                         └────────────────────────────┘
   │                               │
   ▼                               ▼
┌─────────────────────────────────────────┐
│ AssemblePackageUseCase → ContentPackage    │
└─────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────┐
│ ValidatePackageUseCase                    │
│  (cross-reference integrity — zod schema  │
│   shape alone can't catch a dangling id)  │
└─────────────────────────────────────────┘
   │
   ▼
output/<cityId>/manifest.json + assets/*.png
```

Each step's output shape is fixed by `city-template.value-object.ts` — see
"City Template v1" in the [README](../README.md) for the exact counts (8
npcs, 10 quests, 4 portals/fields, 2 instances, ...). That template is
imported by `story-manifest.value-object.ts` *and* `dev-content.value-object.ts`,
so Story and Dev are validated against the same constants — Dev can't
structurally drift from what Story already committed to (it can still get
individual ids wrong, which is what `checkReferentialIntegrity` in
`content-package.entity.ts` catches).

## Layers (mirrors mmorpg-backend's Clean Architecture exactly)

| Layer | Contains | Depends on |
|---|---|---|
| `domain/` | zod schemas + inferred types (`StoryManifest`, `AssetManifest`, `DevContent`, `ContentPackage`, and the shared `city-template.value-object.ts` cardinalities they're both built from) and pure functions (`checkReferentialIntegrity`) | nothing |
| `application/` | `ports/` (interfaces: `IStoryAgent`, `IArtAgent`, `IDevAgent`, `ITargetRepoConventions`, `IManifestWriter`) and `use-cases/` (orchestration + validation logic) | `domain/` only |
| `infrastructure/` | Concrete adapters: `OpenRouterStoryAgent`/`OpenRouterDevAgent`/`OpenRouterArtAgent` (all OpenRouter via `openai`), `FilesystemTargetRepoConventions`, `FileManifestWriter` | implements `application/ports` |
| `presentation/` | `generate-package.cli.ts` (the only place that wires ports to adapters via manual constructor injection) | everything |

Same rule as `mmorpg-backend/AGENTS.md`: the domain layer never imports a
framework, an agent SDK, or the filesystem. `application/` only knows about
*interfaces* — this is why swapping `ClaudeStoryAgent`/`ClaudeDevAgent` for
`OpenRouterStoryAgent`/`OpenRouterDevAgent` only ever touched
`infrastructure/agents/` and the CLI's wiring, not `IStoryAgent`/`IDevAgent`
themselves or any use-case: a real instance of the "swappable adapter"
promise this layering makes, not just a theoretical one.

## Extending an existing city

Every schema/prompt in this pipeline assumed a city is invented whole,
from nothing — until Aethelgard. Reading `mmorpg-backend`'s actual seed
data (`src/database/seeds/01_game_simulation_data.ts`) directly, rather
than assuming, turned up a real, hand-built 50x50 map with 2 NPCs (Captain
Jans, Guardião do Nexo) already placed on it — not a stub, a deliberately
designed plaza with a fountain, a boardwalk, and houses. Generating a
brand-new Aethelgard from scratch would have invented a competing map and
duplicate/renamed NPCs, silently orphaning what a human already built.

`ExistingCityContext` (`domain/value-objects/existing-city-context.value-object.ts`)
is how a caller pins the facts that are NOT up for invention — a real
map's identity/dimensions and specific NPCs with their id/name/role/
position — passed in via `--existing-city <path>` (see
`existing-cities/aethelgard.json` for the real example, sourced by hand
from the seed file since a one-off TS seed isn't worth writing a parser
for). Everything else about the city (the rest of the NPC roster, all
quests, portals/fields, instances) is still generated fresh, exactly like
a from-scratch city.

Enforcing the pins reuses the retry loop that already exists for schema
failures, instead of adding a second mechanism: `run-structured-openrouter-agent.ts`
gained a generic `extraValidation?: (data: T) => string[]` hook, checked
right after the zod schema succeeds. `OpenRouterStoryAgent`/`OpenRouterDevAgent` supply
`checkExistingNpcsPreserved`/`checkExistingMapAndPlacementsPreserved` as
that hook when an `existingCity` is given — any violation becomes exactly
the same `StructuredOutputValidationError` a zod failure would, which the
retry loop already knows how to feed back into the next attempt's prompt
as corrective feedback. The generic infra never needs to know what
"existing city" means; it just runs whatever check the caller supplies.

## Known limitation: the Art agent can't actually draw

No free OpenRouter model can generate an image as output (see above), and
even paid ones are a separate concern from this pipeline's job.
`OpenRouterArtAgent`'s real job is search-first: list what's already
committed to `mmorpg-frontend`, show the model a handful of candidates
alongside the entity's narrative, and only fall back to `source:
'generated'` with a ready-to-paste generation prompt when nothing shown
fits well enough — mirroring the manual ChatGPT-browser-automation
workflow this project used before agents existed. Turning that prompt into
a real file is still a manual (or pluggable, future) step; see
`AssetEntry.source` in `src/domain/value-objects/asset-manifest.value-object.ts`.

## Out of scope for v1

- **The installer.** Nothing in this repo writes to `mmorpg-backend`'s
  database or calls its use-cases. `manifest.json` is the finished
  artifact; turning it into real `maps`/`npcs`/`quests`/`monsters` rows via
  the backend's own use-cases (`CreateMapUseCase`, `AddMonsterToMapUseCase`,
  ...) is deliberately a separate, future piece of work — keeping this repo
  decoupled from the game's database is the reason it's a separate repo at
  all.
- Animated sprites (would need a different generation pipeline entirely).
- CI/CD and end-to-end tests against a real game instance.
