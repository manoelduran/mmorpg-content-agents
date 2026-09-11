import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { AssetManifest } from "../../domain/value-objects/asset-manifest.value-object";

export interface IArtAgent {
  /**
   * Produces one asset per npc/monster in the story. Implementations MUST
   * check existing packs/repo assets before generating anything new — that
   * discipline is enforced by prompt design in the infrastructure layer,
   * not by this port, but `AssetEntry.source`/`sourceDetail` exist
   * specifically so it's auditable after the fact.
   *
   * @param outputDir Absolute path assets get written under (this
   *   package's own assets/ folder — never a path inside mmorpg-frontend).
   */
  generate(story: StoryManifest, outputDir: string): Promise<AssetManifest>;
}
