import type { IArtAgent, ArtGenerationResume } from "../ports/art-agent.port";
import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import {
  AssetManifestSchema,
  type AssetManifest,
} from "../../domain/value-objects/asset-manifest.value-object";

export class GenerateAssetsUseCase {
  constructor(private readonly artAgent: IArtAgent) {}

  async execute(
    story: StoryManifest,
    outputDir: string,
    resume?: ArtGenerationResume,
  ): Promise<AssetManifest> {
    const raw = await this.artAgent.generate(story, outputDir, resume);
    return AssetManifestSchema.parse(raw);
  }
}
