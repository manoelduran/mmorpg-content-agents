# Project Rules

## Core Architecture

- ALWAYS follow Clean Architecture: `domain/` → `application/` → `infrastructure/` → `presentation/`, each layer only depending on the ones to its left.
- Domain layer (`src/domain/`) MUST NOT import an SDK, the filesystem, or a network client — zod schemas and pure functions only.
- Application layer (`src/application/`) MUST only depend on `application/ports` interfaces, never on a concrete `infrastructure/` class directly.
- Every port (`I<Thing>Agent`, `ITargetRepoConventions`, `IManifestWriter`) MUST have exactly one production adapter in `infrastructure/` — no speculative second implementations.
- No DI container. Wiring happens once, by hand, in `src/presentation/cli/generate-package.cli.ts`. If a second entrypoint is ever added, it gets its own wiring function — don't build a container to avoid writing five `new` calls twice.

## Agents

- Story, Art, and Dev are the only three things allowed to call the Claude Agent SDK. Master (`OrchestrateContentGenerationUseCase`) is plain TypeScript — see `docs/ARCHITECTURE.md` for why. Don't "upgrade" Master into a fourth agent call without updating that doc's reasoning first.
- Every agent call MUST use `outputFormat: {type: 'json_schema', ...}` against a schema derived from `z.toJSONSchema(...)` of the corresponding domain value-object — never parse free text out of an agent's prose response.
- Every use-case that receives an agent's output MUST re-validate it with the zod schema before doing anything else with it (`Schema.parse(raw)`), even though the SDK already constrained the shape. Don't trust the infrastructure layer wired it up correctly — verify at the boundary.

## Target-repo conventions

- `mmorpg-backend`'s and `mmorpg-frontend`'s own `CLAUDE.md`/`AGENTS.md`/`.claude/docs/tdd-ticket-workflow.md` are NEVER copied into this repo. `FilesystemTargetRepoConventions` reads them live, every run, from wherever `--backend-path`/`--frontend-path` point. If you're tempted to paste their content into a file here — don't; wire a new read instead.

## Manifests, not code

- Nothing in this repo writes to `mmorpg-backend`'s database, opens a PR against it, or runs a migration. The finished artifact of a run is `output/<zoneId>/manifest.json` plus its `assets/`. An installer that consumes this manifest via the backend's own use-cases is explicitly out of scope until a separate task takes it on (see `docs/ARCHITECTURE.md`).

## Tests

- Every use-case in `application/use-cases/` should be testable by passing in-memory fakes for its port dependencies — no real Anthropic API call required to test `ValidatePackageUseCase` or `AssemblePackageUseCase`.
- Domain logic (`checkReferentialIntegrity`) MUST be tested with plain objects, no mocks needed at all.
