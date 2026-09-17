import type { IManifestWriter } from "../ports/manifest-writer.port";
import type { ICheckpointStore } from "../ports/checkpoint-store.port";
import type { IWorldRegistryRepository } from "../ports/world-registry-repository.port";
import type { ContentPackage } from "../../domain/entities/content-package.entity";
import type { DevContent } from "../../domain/value-objects/dev-content.value-object";
import type { AssetEntry } from "../../domain/value-objects/asset-manifest.value-object";
import { addEntry, buildWorldRegistryEntry } from "../../domain/entities/world-registry.entity";
import { GenerateStoryUseCase } from "./generate-story.use-case";
import { GenerateAssetsUseCase } from "./generate-assets.use-case";
import { GenerateDevContentUseCase } from "./generate-dev-content.use-case";
import { LoadTargetRepoConventionsUseCase } from "./load-target-repo-conventions.use-case";
import { AssemblePackageUseCase } from "./assemble-package.use-case";
import { ValidatePackageUseCase } from "./validate-package.use-case";
import { RetrieveWorldContextUseCase } from "./retrieve-world-context.use-case";
import { ApplyContentGuardrailsUseCase } from "./apply-content-guardrails.use-case";
import { LoadExistingCityContextUseCase } from "./load-existing-city-context.use-case";

export interface OrchestrateContentGenerationInput {
  brief: string;
  outputRoot: string;
  backendPath: string;
  frontendPath?: string;
  /** Idempotency key, supplied by the caller (see checkpoint-store.port.ts
   * — same pattern payment APIs use). Re-running execute() with the same
   * runId resumes from the last completed phase instead of redoing (and
   * re-paying for) work already finished. */
  runId: string;
  /** Path to a JSON file describing a city that already partially exists
   * (see existing-city-context.value-object.ts) — e.g.
   * existing-cities/aethelgard.json. Omitted for a from-scratch city. */
  existingCityContextPath?: string;
}

export interface OrchestrateContentGenerationResult {
  package: ContentPackage;
  manifestPath: string;
}

/**
 * This IS the Master agent's logic — deliberately plain, deterministic
 * TypeScript, not an LLM making orchestration decisions. Story/Art/Dev are
 * the only steps that call a model; sequencing, fan-out, merging and
 * validation are ordinary code so they're testable without hitting the
 * Anthropic API and can never silently skip a step. See docs/ARCHITECTURE.md
 * for why this split (and not "Master is also an agent") was chosen.
 */
export class OrchestrateContentGenerationUseCase {
  constructor(
    private readonly generateStory: GenerateStoryUseCase,
    private readonly loadConventions: LoadTargetRepoConventionsUseCase,
    private readonly generateAssets: GenerateAssetsUseCase,
    private readonly generateDevContent: GenerateDevContentUseCase,
    private readonly assemblePackage: AssemblePackageUseCase,
    private readonly validatePackage: ValidatePackageUseCase,
    private readonly manifestWriter: IManifestWriter,
    private readonly checkpoints: ICheckpointStore,
    private readonly retrieveWorldContext: RetrieveWorldContextUseCase,
    private readonly worldRegistryRepository: IWorldRegistryRepository,
    private readonly applyContentGuardrails: ApplyContentGuardrailsUseCase,
    private readonly loadExistingCityContext: LoadExistingCityContextUseCase,
  ) {}

  async execute(
    input: OrchestrateContentGenerationInput,
  ): Promise<OrchestrateContentGenerationResult> {
    const existing = await this.checkpoints.load(input.runId);

    // ── Recovery: a "done" checkpoint means this exact runId already
    // finished successfully — return it as-is instead of calling any
    // agent again. This is what makes re-running the CLI with the same
    // --run-id safe (true idempotency, not just "probably fine"). ──
    if (existing?.phase === "done") {
      return { package: existing.package, manifestPath: existing.manifestPath };
    }

    // Loaded once here (not checkpointed — deterministically re-derivable
    // from the path on every resume, and skipped entirely above when the
    // run already finished) since both Story and Dev need it below.
    const existingCity = input.existingCityContextPath
      ? await this.loadExistingCityContext.execute(input.existingCityContextPath)
      : undefined;

    // 1. Story runs alone first — Art and Dev both depend on its output.
    // Skip it entirely if a checkpoint already has it (which also means
    // retrieval doesn't need to run again — its only job is feeding Story).
    let story;
    if (existing?.phase === "story" || existing?.phase === "assets_and_dev") {
      story = existing.story;
    } else {
      // Long-term memory / RAG: pull relevant past cities out of the World
      // Registry before Story runs (see retrieve-world-context.use-case.ts),
      // so Story can avoid colliding with names this world already used.
      const worldContext = await this.retrieveWorldContext.execute(input.brief);
      story = await this.generateStory.execute(input.brief, worldContext, existingCity);

      // Guardrail check happens BEFORE the phase is checkpointed and BEFORE
      // Art/Dev are ever dispatched — a story that fails here never reaches
      // disk and never costs a second agent call. See
      // apply-content-guardrails.use-case.ts for why this exists alongside
      // (not instead of) the prompt-level instructions already in place.
      this.applyContentGuardrails.execute(story);

      await this.checkpoints.save(input.runId, { phase: "story", story });
    }

    const assetsOutputDir = `${input.outputRoot}/${story.cityId}/assets`;

    // 2. Art and Dev don't depend on each other, only on Story — run them
    // CONCURRENTLY, each checkpointed independently of the other the
    // moment it makes progress (Dev the instant it finishes; Art after
    // every completed batch of its ~26 entity calls). This is the fix for
    // a real failure mode: Dev is fast and nearly always finishes first,
    // but the OLD code awaited Art and Dev sequentially in a way that
    // meant Dev's already-finished result got thrown away whenever Art
    // died later (a timeout, a quota error) — and a resumed Art call
    // redid all ~26 entities even if only the last few hadn't finished.
    // Neither problem exists once each side saves its own progress as
    // soon as it has any. A resume where both are already fully done
    // costs nothing extra: Dev is skipped outright below, and Art's own
    // todo list (see OpenRouterArtAgent.generate) comes back empty.
    let dev: DevContent | undefined =
      existing?.phase === "assets_and_dev" ? existing.dev : undefined;
    let completedAssets: AssetEntry[] =
      existing?.phase === "assets_and_dev" ? existing.completedAssets : [];

    const conventions = await this.loadConventions.execute(
      input.backendPath,
      input.frontendPath,
    );

    const saveProgress = () =>
      this.checkpoints.save(input.runId, {
        phase: "assets_and_dev",
        story,
        dev,
        completedAssets,
      });

    // Promise.allSettled, not Promise.all: if Art rejects while Dev is
    // still in flight, Promise.all would reject THIS await immediately,
    // returning control to the CLI's error handler (which calls
    // process.exit) potentially before Dev's own in-progress
    // `await saveProgress()` ever gets a turn to run — losing exactly the
    // finished work this whole change exists to protect. Waiting for both
    // to settle first guarantees whichever one succeeded is safely on
    // disk before anything can end the process.
    const [assetsResult, devResult] = await Promise.allSettled([
      this.generateAssets.execute(story, assetsOutputDir, {
        alreadyCompleted: completedAssets,
        onBatchComplete: async (updated) => {
          completedAssets = updated;
          await saveProgress();
        },
      }),
      (async () => {
        if (dev === undefined) {
          dev = await this.generateDevContent.execute(story, conventions, existingCity);
          await saveProgress();
        }
      })(),
    ]);

    if (assetsResult.status === "rejected") throw assetsResult.reason;
    if (devResult.status === "rejected") throw devResult.reason;
    const assets = assetsResult.value;

    if (dev === undefined) {
      // Unreachable: the IIFE above always assigns dev before resolving
      // successfully, and a rejection was already rethrown just above.
      // Guards the type only — TS can't see through the closure mutation.
      throw new Error("unreachable: dev must be set once the assets_and_dev phase resolves");
    }

    // 3. Merge + validate. A referential-integrity failure here means a
    // sub-agent drifted from the story (e.g. Dev invented an npcId Story
    // never defined) — surfaced as a single readable error, not a crash
    // three layers down. Note this step is NOT checkpointed as its own
    // phase — it's pure, cheap, deterministic code with no API cost, so
    // there's nothing worth saving a recovery point for; it just reruns
    // on every resume.
    const contentPackage = this.assemblePackage.execute(story, assets, dev);
    this.validatePackage.execute(contentPackage);

    const manifestPath = await this.manifestWriter.write(
      contentPackage,
      input.outputRoot,
    );

    // This is how long-term memory actually grows: only once a package has
    // passed validation does its city become a fact the next run can
    // retrieve. A failed/unresumed run never reaches this line, so the
    // registry never records a city that doesn't really exist in output/.
    const registry = await this.worldRegistryRepository.load();
    await this.worldRegistryRepository.save(
      addEntry(registry, buildWorldRegistryEntry(story, input.brief)),
    );

    await this.checkpoints.save(input.runId, {
      phase: "done",
      story,
      assets,
      dev,
      package: contentPackage,
      manifestPath,
    });

    return { package: contentPackage, manifestPath };
  }
}
