import type { IManifestWriter } from "../ports/manifest-writer.port";
import type { ICheckpointStore } from "../ports/checkpoint-store.port";
import type { IWorldRegistryRepository } from "../ports/world-registry-repository.port";
import type { ContentPackage } from "../../domain/entities/content-package.entity";
import { addEntry, buildWorldRegistryEntry } from "../../domain/entities/world-registry.entity";
import { GenerateStoryUseCase } from "./generate-story.use-case";
import { GenerateAssetsUseCase } from "./generate-assets.use-case";
import { GenerateDevContentUseCase } from "./generate-dev-content.use-case";
import { LoadTargetRepoConventionsUseCase } from "./load-target-repo-conventions.use-case";
import { AssemblePackageUseCase } from "./assemble-package.use-case";
import { ValidatePackageUseCase } from "./validate-package.use-case";
import { RetrieveWorldContextUseCase } from "./retrieve-world-context.use-case";

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
      story = await this.generateStory.execute(input.brief, worldContext);
      await this.checkpoints.save(input.runId, { phase: "story", story });
    }

    const assetsOutputDir = `${input.outputRoot}/${story.cityId}/assets`;

    // 2. Art and Dev don't depend on each other, only on Story — run them
    // together. Dev additionally needs the target repo's live conventions.
    // Skip both if a checkpoint already has them.
    let assets, dev;
    if (existing?.phase === "assets_and_dev") {
      ({ assets, dev } = existing);
    } else {
      const [conventions, generatedAssets] = await Promise.all([
        this.loadConventions.execute(input.backendPath, input.frontendPath),
        this.generateAssets.execute(story, assetsOutputDir),
      ]);
      assets = generatedAssets;
      dev = await this.generateDevContent.execute(story, conventions);
      await this.checkpoints.save(input.runId, {
        phase: "assets_and_dev",
        story,
        assets,
        dev,
      });
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
