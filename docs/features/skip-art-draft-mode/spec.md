# Skip-Art Draft Mode

## Overview

`npm run generate -- --skip-art` runs Story and Dev only and writes a
**draft**: story + dev, validated for everything except asset coverage. A
full run costs about 28 OpenRouter requests, 26 of them from Art. A draft
costs about 2 (Story 1 + Dev 1, plus any corrective retries). Drafts exist
for evals: the upcoming prompt-injection eval needs several adversarial
cities per run, and none of its checks look at sprites.

Drafts stay out of the game's contract and out of the world's memory. They
are never written to `output/<cityId>/manifest.json` and never added to the
world registry, so adversarial test cities can't leak into later Story
prompts through retrieval. A draft run can be promoted later: re-running
the same `--run-id` without `--skip-art` generates only the Art and writes
the normal manifest.

## Pipeline

### Module Structure

```
src/
├── domain/entities/
│   ├── content-package.entity.ts          (existing, modify) extract the story↔dev
│   │                                       checks into checkStoryDevIntegrity(story, dev);
│   │                                       checkReferentialIntegrity = that + asset coverage
│   ├── content-draft.entity.ts            (new) ContentDraftSchema + checkDraftIntegrity
│   └── content-draft.entity.test.ts       (new)
├── application/
│   ├── ports/manifest-writer.port.ts      (existing, modify) add writeDraft()
│   └── use-cases/
│       ├── orchestrate-content-generation.use-case.ts       (existing, modify) add executeDraft()
│       ├── orchestrate-content-generation.use-case.test.ts  (existing, extend)
│       ├── validate-package.use-case.ts   (existing, modify) add executeDraft(), same error type
│       └── validate-package.use-case.test.ts (new, only if no existing coverage fits)
├── infrastructure/persistence/
│   └── file-manifest-writer.ts            (existing, modify) implement writeDraft()
└── presentation/cli/
    └── generate-package.cli.ts            (existing, modify) --skip-art flag; Art model
                                            env var only required without it
evals/
├── cases.py                               (existing, modify) no `assets` → no `:art` case
├── goldens.json                           (existing, modify) add one draft golden
└── README.md                              (existing, modify) document drafts
AGENTS.md / CLAUDE.md                      (existing, modify) one line each on --skip-art
```

No `schemas/content-package.schema.json` change: the game's contract is
untouched. The draft schema is internal and gets no generated JSON Schema.

### Contracts

**CLI**

```
npm run generate -- --brief "<city>" --skip-art [--run-id <id>] [--existing-city <path>] [--yes]
```

- With `--skip-art`, `OPENROUTER_ART_MODEL` is not read. Missing it is fine.
- Without the flag, behavior is unchanged.
- The success output prints `Draft: <cityId>` plus the same entity counts as
  today, the draft path, and the hint
  `promote with: npm run generate -- --run-id <runId>`.

**Draft file**: `<outputRoot>/.drafts/<cityId>/draft.json`, written atomically
through `writeFileAtomic`:

```json
{
  "cityId": "porto-cinza",
  "generatedAt": "2026-11-19T12:00:00.000Z",
  "draft": true,
  "story": { "...": "StoryManifest" },
  "dev":   { "...": "DevContent" }
}
```

- `ContentDraftSchema` = `ContentPackageSchema` minus `assets`, plus
  `draft: z.literal(true)`. Because of the literal, a draft can never parse
  as a package, and a package can never parse as a draft.
- `story` and `dev` keep the shape a manifest uses, so `evals/cases.py`
  reads both files with the same code.

**Orchestrator**

- `executeDraft(input)` takes the same input as `execute()` and returns
  `{ draft, draftPath }`.
- `execute()` is unchanged: it stays the only path that writes a manifest
  or touches the world registry.

### Business Rules

1. **Order.** `executeDraft` runs the same steps as `execute()` up to the
   Dev result:
   - checkpoint recovery;
   - retrieval;
   - Story, followed by the guardrails, which keep blocking before Dev runs;
   - conventions;
   - Dev.

   It never calls `generateAssets`.
2. **Checkpointing.** After Dev, the checkpoint is
   `{ phase: "assets_and_dev", story, dev, completedAssets }`.
   `completedAssets` keeps whatever an earlier full attempt saved, and is
   `[]` otherwise. No new checkpoint phase is added.
3. **Promotion.** A later `execute()` with the same `runId` finds
   `assets_and_dev`, keeps the existing Dev result, and runs only Art. This
   is the existing resume path, unchanged.
4. **Resuming a finished run.** `executeDraft` on a runId whose checkpoint is
   `done` builds the draft from the saved story and dev. It writes the draft
   without calling any agent and leaves the checkpoint as `done`.
5. **Validation.** `checkDraftIntegrity(draft)` returns exactly the
   `checkStoryDevIntegrity` errors. The three "has no matching entry in
   assets[]" checks are the only ones a draft skips. A failure throws the
   existing `PackageValidationError`, with the same message format.
6. **Isolation.** A draft run never calls `manifestWriter.write` or
   `worldRegistryRepository.save`.
7. **Refactor safety.** Moving the asset checks to the end of
   `checkReferentialIntegrity` may change the order errors are reported in,
   but never which errors are reported. The existing
   `content-package.entity.test.ts` suite must stay green unchanged.

### Evals

- `build_cases` omits `:art` when the loaded file has no `assets` key. This
  is the same effect as `"skip": {"art": ...}`, but needs no golden entry.
- `goldens.json` gets one draft golden: a new brief, generated with
  `--skip-art` and free models, whose `manifest` points at
  `../output/.drafts/<cityId>/draft.json`.

## Testing Strategy

- `src/domain/entities/content-draft.entity.test.ts`:
  - the fixture's story + dev parses as a draft, and `checkDraftIntegrity`
    returns `[]`;
  - a story↔dev drift (an unknown quest target) is reported;
  - an object carrying `assets` and no `draft: true` fails to parse;
  - plain objects only, no mocks (AGENTS.md).
- `src/application/use-cases/orchestrate-content-generation.use-case.test.ts`,
  extended with the existing recording fakes:
  - `executeDraft` calls Story once, Dev once, Art never; writes one draft;
    calls neither `write` nor `registry.save`;
  - a Story guardrail violation stops `executeDraft` before Dev runs;
  - draft then `execute()` on the same runId calls Dev zero times and Art
    once, and writes the manifest;
  - `executeDraft` on a `done` checkpoint calls no agent and writes the
    draft.
- `src/domain/entities/content-package.entity.test.ts`: the existing suite,
  unchanged and green.
- Gates: `npm test`, `npm run typecheck`. `npm run build:schema` must
  produce no diff.
- Manual, real free models:
  - one `--skip-art` run on a new brief, counting OpenRouter requests from
    the CLI log or the OpenRouter activity page;
  - then `npm run eval -- <cityId>` runs 4 cases (no `:art`), with no
    errors.
