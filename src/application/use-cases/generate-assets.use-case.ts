import type { IArtAgent } from "../ports/art-agent.port";
import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import {
  AssetManifestSchema,
  type AssetManifest,
} from "../../domain/value-objects/asset-manifest.value-object";

export class GenerateAssetsUseCase {
  constructor(private readonly artAgent: IArtAgent) {}

  async execute(story: StoryManifest, outputDir: string): Promise<AssetManifest> {
    const raw = await this.artAgent.generate(story, outputDir);
    return AssetManifestSchema.parse(raw);
  }
}
