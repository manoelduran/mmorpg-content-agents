import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { AssetManifest } from "../../domain/value-objects/asset-manifest.value-object";
import type { DevContent } from "../../domain/value-objects/dev-content.value-object";
import {
  ContentPackageSchema,
  type ContentPackage,
} from "../../domain/entities/content-package.entity";

export class AssemblePackageUseCase {
  execute(
    story: StoryManifest,
    assets: AssetManifest,
    dev: DevContent,
  ): ContentPackage {
    return ContentPackageSchema.parse({
      zoneId: story.zoneId,
      generatedAt: new Date().toISOString(),
      story,
      assets,
      dev,
    });
  }
}
