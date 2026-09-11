# Architecture

## Why a Master that isn't itself an LLM call

The obvious design is "four agents, Master included, all talking to each
other." This repo deliberately does something narrower: **Story, Art, and
Dev are Claude Agent SDK agents; Master is plain, deterministic
TypeScript** (`OrchestrateContentGenerationUseCase`).

The reasoning: orchestration here is a fixed, known sequence — run Story,
then run Art and Dev off Story's output, then merge and validate. None of
that benefits from an LLM deciding it fresh each time, and every LLM call
is a chance to skip a step, hallucinate a different order, or silently drop
a validation pass. Making Master ordinary code means:

- It's unit-testable without an `ANTHROPIC_API_KEY`.
- The sequence (Story → {Art, Dev} in parallel → merge → validate) is
  provably always followed, not "usually followed by a well-prompted
  model."
- Adding a step (e.g. a future QA agent) is a one-line change to the
  use-case, not a prompt-engineering exercise on the Master's own system
  prompt.

This is the same instinct DDD applies to any workflow: put business rules
in code you can read and test, keep the non-deterministic part (creative
generation) isolated behind a narrow interface. Story/Art/Dev are that
non-deterministic part — each is a `query()` call to the Claude Agent SDK
with `outputFormat: {type: 'json_schema', ...}`, so even the "AI part" is
schema-constrained at the boundary.

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
output/<zoneId>/manifest.json + assets/*.png
```

## Layers (mirrors mmorpg-backend's Clean Architecture exactly)

| Layer | Contains | Depends on |
|---|---|---|
| `domain/` | zod schemas + inferred types (`StoryManifest`, `AssetManifest`, `DevContent`, `ContentPackage`) and pure functions (`checkReferentialIntegrity`) | nothing |
| `application/` | `ports/` (interfaces: `IStoryAgent`, `IArtAgent`, `IDevAgent`, `ITargetRepoConventions`, `IManifestWriter`) and `use-cases/` (orchestration + validation logic) | `domain/` only |
| `infrastructure/` | Concrete adapters: `ClaudeStoryAgent`/`ClaudeArtAgent`/`ClaudeDevAgent` (Claude Agent SDK), `FilesystemTargetRepoConventions`, `FileManifestWriter` | implements `application/ports` |
| `presentation/` | `generate-package.cli.ts` (the only place that wires ports to adapters via manual constructor injection) | everything |

Same rule as `mmorpg-backend/AGENTS.md`: the domain layer never imports a
framework, an agent SDK, or the filesystem. `application/` only knows about
*interfaces* — swapping `ClaudeStoryAgent` for a different model provider
later touches one file in `infrastructure/`, nothing else.

## Known limitation: the Art agent can't actually draw

Claude doesn't generate raster images. `ClaudeArtAgent`'s real job is
search-first: look for a matching sprite already committed to
`mmorpg-frontend` or already present in the local "Pixel Art Top Down -
Basic" asset pack, and only fall back to `source: 'generated'` with a
ready-to-paste generation prompt when nothing fits — mirroring the manual
ChatGPT-browser-automation workflow this project used before agents
existed. Turning that prompt into a real file is still a manual (or
pluggable, future) step; see `AssetEntry.source` in
`src/domain/value-objects/asset-manifest.value-object.ts`.

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
