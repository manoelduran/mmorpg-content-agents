# Project Rules

## Core Architecture

- ALWAYS follow Clean Architecture: `domain/` → `application/` → `infrastructure/` → `presentation/`, each layer only depending on the ones to its left.
- Domain layer (`src/domain/`) MUST NOT import an SDK, the filesystem, or a network client — zod schemas and pure functions only.
- Application layer (`src/application/`) MUST only depend on `application/ports` interfaces, never on a concrete `infrastructure/` class directly.
- Every port (`I<Thing>Agent`, `ITargetRepoConventions`, `IManifestWriter`) MUST have exactly one production adapter in `infrastructure/` — no speculative second implementations.
- No DI container. Wiring happens once, by hand, in `src/presentation/cli/generate-package.cli.ts`. If a second entrypoint is ever added, it gets its own wiring function — don't build a container to avoid writing five `new` calls twice.

## Agents

- Story, Art, and Dev are the only three things allowed to call an LLM provider. Master (`OrchestrateContentGenerationUseCase`) is plain TypeScript — see `docs/ARCHITECTURE.md` for why. Don't "upgrade" Master into a fourth agent call without updating that doc's reasoning first.
- Art calls the Claude Agent SDK — it's the only agent with real tools (Bash/Read/Glob/Write, to search/copy existing sprites), which needs the SDK's tool-execution loop. Story and Dev call OpenRouter directly (`run-structured-openrouter-agent.ts`) — they're pure text-in-JSON-out with zero tools, so a plain chat completion is the honest-sized tool for the job. Don't move Art to OpenRouter without also building (and reviewing the security of) a real tool-execution loop first — see `docs/ARCHITECTURE.md`'s "Why OpenRouter for Story/Dev, not OpenCode" section for the reasoning already done here.
- Every agent call MUST constrain output to a JSON Schema derived from `z.toJSONSchema(...)` of the corresponding domain value-object (`outputFormat` for the Claude SDK, `response_format` for OpenRouter) — never parse free text out of an agent's prose response.
- Every use-case that receives an agent's output MUST re-validate it with the zod schema before doing anything else with it (`Schema.parse(raw)`), even though the SDK already constrained the shape. Don't trust the infrastructure layer wired it up correctly — verify at the boundary.

## City template

- The exact cardinalities (8 npcs, 10 quests, 4 portals/fields, 2 instances, drop counts, ...) live in exactly one place: `src/domain/value-objects/city-template.value-object.ts`. `story-manifest.value-object.ts` and `dev-content.value-object.ts` both import from it — never hardcode a count (`.length(8)`, a literal `10`, ...) directly in either of those files again; import the constant instead, so Story and Dev can never validate against different numbers.
- When a count changes, it changes in `city-template.value-object.ts` and nowhere else — update the three agent prompts (they restate the numbers in prose for the model's benefit) and the README's "City Template v1" table in the same change, since those are documentation copies of the same source of truth, not independent decisions.

## Target-repo conventions

- `mmorpg-backend`'s and `mmorpg-frontend`'s own `CLAUDE.md`/`AGENTS.md`/`.claude/docs/tdd-ticket-workflow.md` are NEVER copied into this repo. `FilesystemTargetRepoConventions` reads them live, every run, from wherever `--backend-path`/`--frontend-path` point. If you're tempted to paste their content into a file here — don't; wire a new read instead.

## Manifests, not code

- Nothing in this repo writes to `mmorpg-backend`'s database, opens a PR against it, or runs a migration. The finished artifact of a run is `output/<cityId>/manifest.json` plus its `assets/`. An installer that consumes this manifest via the backend's own use-cases is explicitly out of scope until a separate task takes it on (see `docs/ARCHITECTURE.md`).

## Tests

- Every use-case in `application/use-cases/` should be testable by passing in-memory fakes for its port dependencies — no real API call to any provider required to test `ValidatePackageUseCase` or `AssemblePackageUseCase`.
- `run-structured-openrouter-agent.ts` (Story/Dev) is tested against a fake `ChatCompletionClient` (see its `.test.ts`) — a real advantage over the Claude SDK path, whose `query()` isn't easily fakeable. Prefer this pattern for any future OpenRouter-path code.
- Domain logic (`checkReferentialIntegrity`) MUST be tested with plain objects, no mocks needed at all.
