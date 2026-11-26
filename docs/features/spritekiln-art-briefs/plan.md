# Implementation Plan — SpriteKiln Art Briefs

## Prerequisites
- mmorpg-content-agents on a feature branch, with `npm test` green before starting.
- Python 3.10+ and pipx, needed only for Phase 6 (the art workspace).
- An `OPENROUTER_ART_MODEL` that supports `response_format` + structured
  outputs. Vision is no longer required.

## Pipeline

### Phase 1 — Domain: SpriteKiln brief and the new AssetEntry
1. **Red:** write `spritekiln-brief.value-object.test.ts`: a valid brief parses;
   unknown kit, duplicate kits, too few `mustKeep` and an unknown `sizeClass`
   are rejected; `requiredAnimations` per kind.
2. **Green:** add `spritekiln-brief.value-object.ts`. Change `AssetEntrySchema`
   per spec.md. Move `valid-city.fixture.ts` assets to the new shape, so the
   existing content-package/validate tests stay green.
3. **Refactor:** run `npm run build:schema` and commit the regenerated schema.
4. Commit: `feat(domain): spritekiln brief value object and asset entry shape`

### Phase 2 — Art agent writes briefs, text only
1. **Red:** rewrite the affected cases in `openrouter-art-agent.test.ts`:
   no `image_url` parts in the request; entry fields (kind, brief, specPath,
   relativePath, source, sourceDetail); a corrective retry for each
   extra-validation rule; an old-shape resume entry is regenerated, and a
   new-shape one is skipped.
2. **Green:** new system prompt and output schema; build `ArtEntity` with
   `role` so the BOSS rule can be checked; derive paths in code; re-validate
   resume entries; remove thumbnails, `sharp` and the `frontendImagesDir` param.
3. **Refactor:** update the class doc comment and `art-agent.port.ts`'s comment
   (no reuse/pack checking); remove `sharp` from package.json; fix CLI wiring
   so typecheck passes.
4. Commit: `feat(art): spritekiln briefs instead of free-text prompts`

### Phase 3 — Stub renderer and writer
1. **Red:** `spritekiln-stub.test.ts` goldens; `file-art-spec-writer.test.ts`
   on a real temp dir.
2. **Green:** `renderSpritekilnStub`, the `IArtSpecWriter` port and `FileArtSpecWriter`.
3. **Refactor:** keep the renderer free of fs, and the writer free of formatting.
4. Commit: `feat(persistence): write spritekiln spec stubs per entity`

### Phase 4 — Orchestrator writes stubs
1. **Red:** extend `orchestrate-content-generation.use-case.test.ts`: the writer
   is called once after validation in `execute`; it is never called in
   `executeDraft`; it is never called when validation throws.
2. **Green:** inject `IArtSpecWriter` into the orchestrator and call it next to
   `manifestWriter.write`. Wire `FileArtSpecWriter` in
   `generate-package.cli.ts` and print the stub folder in the run summary.
3. **Refactor:** none expected.
4. Commit: `feat(pipeline): emit spritekiln stubs with the manifest`

### Phase 5 — Docs and evals
1. **Implement:** AGENTS.md (Art writes SpriteKiln briefs; drop the vision
   requirement; keep the no-tool-loop rule and add this feature as its new
   reason); docs/ARCHITECTURE.md (new section "SpriteKiln briefs: why Art
   still has no tools"); README asset section; `.env.example`'s
   `OPENROUTER_ART_MODEL` comment; `evals/cases.py` art metric per spec.md.
2. **Verify:** `npm run typecheck`, `npm test`; `npm run eval` on a golden
   whose manifest has assets (if none exists yet, after Phase 6's real run).
3. Commit: `docs: art pipeline produces spritekiln briefs` (+ `test(evals): judge spritekiln briefs`)

## Art workspace

### Phase 6 — mmorpg-art bootstrap and round trip (manual)
1. **Implement:** create `/Users/manoelduran/Documents/test/mmorpg-art` (git
   init); `pipx install "spritekiln[mcp]==0.4.0"`;
   `spritekiln init --engine godot --ai claude` (export root:
   `/Users/manoelduran/Documents/test/mmorpg-client`); run the style interview
   (topdown, 8 dirs, frame 64 px on 32 px tiles);
   write the README runbook per spec.md.
2. **Verify:** run one real `npm run generate -- --brief "..."` in
   content-agents. Copy `output/<cityId>/art-specs/*` into `art/specs/`. Pick
   one humanoid NPC and one `none`-base monster. Run `spritekiln validate` on
   the humanoid stub as-is. Then ask Claude Code in mmorpg-art to model,
   render and export both. Confirm `mmorpg-client/assets/spritekiln/<id>/`
   gets the atlas PNG + JSON, the `.tres` SpriteFrames and the `.tscn`, with
   the required animations.
3. Commit (in mmorpg-art): `chore: bootstrap spritekiln 0.4.0 workspace`

### Phase 7 — Player layer spike (manual, before any other modeling)
1. **Implement:** model `body-male`, `clothing-tunic`, `hat` and `weapon-sword`
   on one shared skeleton per spec.md's Player character section; render and export.
2. **Verify:** stack the four in a Godot test scene and step through idle,
   walk and attack in all 8 directions. Record the outcome in spec.md: either
   the layers line up, or the fallback applies (one sheet per gender × style).
3. Commit (in mmorpg-art): `art: player layer spike`

### Phase 8 — Player layers and backfill (manual)
1. **Implement:**
   - every player layer (or the fallback sheets);
   - one stub per current monster image (22) and NPC image (14), named after the file
     name, modeled and exported.
2. **Verify:** every name in the backend's `monsters.image` / `npcs.image` has an
   `assets/spritekiln/<name>/` folder in the client.
3. Commit (in mmorpg-art): `art: player layers and backfill of current sprites`
