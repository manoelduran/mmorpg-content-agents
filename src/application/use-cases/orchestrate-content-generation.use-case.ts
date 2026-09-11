import type { IManifestWriter } from "../ports/manifest-writer.port";
import type { ContentPackage } from "../../domain/entities/content-package.entity";
import { GenerateStoryUseCase } from "./generate-story.use-case";
import { GenerateAssetsUseCase } from "./generate-assets.use-case";
import { GenerateDevContentUseCase } from "./generate-dev-content.use-case";
import { LoadTargetRepoConventionsUseCase } from "./load-target-repo-conventions.use-case";
import { AssemblePackageUseCase } from "./assemble-package.use-case";
import { ValidatePackageUseCase } from "./validate-package.use-case";

export interface OrchestrateContentGenerationInput {
  brief: string;
  outputRoot: string;
  backendPath: string;
  frontendPath?: string;
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
  ) {}

  async execute(
    input: OrchestrateContentGenerationInput,
  ): Promise<OrchestrateContentGenerationResult> {
    // 1. Story runs alone first — Art and Dev both depend on its output.
    const story = await this.generateStory.execute(input.brief);

    const assetsOutputDir = `${input.outputRoot}/${story.zoneId}/assets`;

    // 2. Art and Dev don't depend on each other, only on Story — run them
    // together. Dev additionally needs the target repo's live conventions.
    const [conventions, assets] = await Promise.all([
      this.loadConventions.execute(input.backendPath, input.frontendPath),
      this.generateAssets.execute(story, assetsOutputDir),
    ]);
    const dev = await this.generateDevContent.execute(story, conventions);

    // 3. Merge + validate. A referential-integrity failure here means a
    // sub-agent drifted from the story (e.g. Dev invented an npcId Story
    // never defined) — surfaced as a single readable error, not a crash
    // three layers down.
    const contentPackage = this.assemblePackage.execute(story, assets, dev);
    this.validatePackage.execute(contentPackage);

    const manifestPath = await this.manifestWriter.write(
      contentPackage,
      input.outputRoot,
    );

    return { package: contentPackage, manifestPath };
  }
}
