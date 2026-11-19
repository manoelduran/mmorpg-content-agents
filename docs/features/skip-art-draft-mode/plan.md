# Implementation Plan — Skip-Art Draft Mode

## Prerequisites

- The `eval-findings-fixes` work, including `loreReveal`, is on the current
  branch. The draft golden is generated with it in place.
- `.env` has `OPENROUTER_STORY_MODEL` and `OPENROUTER_DEV_MODEL` set to
  `:free` ids, and `OPENROUTER_JUDGE_MODEL` for the eval. Phase 4's manual
  run deliberately leaves `OPENROUTER_ART_MODEL` unset in the shell, to
  prove it isn't needed.
- Budget: Phase 4 costs about 2 generation requests plus about 4 judge
  requests per eval run.

## Pipeline

### Phase 1 — Draft entity and split integrity check
1. **Red:** write `content-draft.entity.test.ts` with the draft parse cases
   and the integrity cases listed in spec.md's Testing Strategy, and confirm
   they fail because the module doesn't exist yet.
2. **Green:** in `content-package.entity.ts`, extract
   `checkStoryDevIntegrity`. Add `content-draft.entity.ts` with
   `ContentDraftSchema` and `checkDraftIntegrity`.
3. **Refactor:** `checkReferentialIntegrity` should only combine the shared
   checks with asset coverage. The existing `content-package.entity.test.ts`
   must stay green unchanged.
4. Commit: `feat(domain): add content draft entity without asset coverage`

### Phase 2 — Draft validation and writer port
1. **Red:** write tests for:
   - `ValidatePackageUseCase.executeDraft`, which throws
     `PackageValidationError` on drift;
   - `FileManifestWriter.writeDraft`, which writes under `.drafts/<cityId>/`
     inside a temp dir, the same pattern as `atomic-file-writer.test.ts`.

   Confirm the tests fail.
2. **Green:** add `writeDraft` to `IManifestWriter` and `FileManifestWriter`,
   and add `executeDraft` to `ValidatePackageUseCase`.
3. **Refactor:** update the orchestrator test's
   `RecordingFakeManifestWriter` so it records draft writes separately.
4. Commit: `feat(application): validate and write content drafts`

### Phase 3 — `executeDraft` in the orchestrator
1. **Red:** add the four orchestrator tests from spec.md's Testing Strategy
   (run, guardrail stop, promotion, `done` resume) and confirm they fail.
2. **Green:** implement `executeDraft` per spec.md Business Rules 1–6.
   Reuse `execute()`'s Story and checkpoint steps instead of copying them.
3. **Refactor:** pull the shared "story from checkpoint or generate +
   guardrail" step into a private method used by both paths. All existing
   orchestrator tests must stay green.
4. Commit: `feat(orchestrator): add executeDraft that skips Art`

### Phase 4 — CLI flag
1. **Implement:**
   - parse `--skip-art`;
   - require `OPENROUTER_ART_MODEL` only without the flag;
   - construct `OpenRouterArtAgent` only when it's needed, or with the model
     id left unused;
   - call `executeDraft` and print the draft summary and the promotion hint
     (spec.md Contracts);
   - update the usage string.
2. **Verify:**
   - `npm test` and `npm run typecheck`;
   - with `OPENROUTER_ART_MODEL` unset, run
     `npm run generate -- --brief "<new brief>" --skip-art --yes`;
   - expected: the draft lands in `output/.drafts/<cityId>/draft.json`,
     nothing is written to `output/<cityId>/`, `output/world-registry.json`
     is unchanged, and OpenRouter shows ≤ 4 requests for the run.
3. Commit: `feat(cli): add --skip-art draft mode`

### Phase 5 — Evals accept drafts
1. **Implement:**
   - in `cases.py`, omit `:art` when `assets` is absent;
   - add the Phase 4 draft to `goldens.json`;
   - document `--skip-art` drafts in `evals/README.md`, and add one line each
     to `AGENTS.md` and `CLAUDE.md`.
2. **Verify:**
   - `npm run eval -- <draft cityId>` runs exactly 4 cases with no
     exception;
   - `npm run eval` with no filter still runs 5 cases for `mare-funda`.
3. Commit: `feat(evals): accept skip-art drafts as goldens`
