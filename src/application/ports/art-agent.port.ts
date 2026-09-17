import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { AssetEntry, AssetManifest } from "../../domain/value-objects/asset-manifest.value-object";

/**
 * Lets a caller resume a partially-finished Art run instead of redoing
 * every entity from scratch — Art issues one model call per entity
 * (~26 for a full city), so a crash/timeout/quota error partway through
 * used to throw away everything already produced. See
 * OrchestrateContentGenerationUseCase for how this gets wired to the
 * checkpoint store.
 */
export interface ArtGenerationResume {
  /** Entries a previous attempt already produced for this run — these
   * entityIds are skipped entirely, no model call made for them again. */
  alreadyCompleted: AssetEntry[];
  /** Called after every completed batch with the FULL list finished so
   * far (alreadyCompleted plus everything new up to this point), so the
   * caller can checkpoint incrementally instead of only at the very end. */
  onBatchComplete: (completedSoFar: AssetEntry[]) => Promise<void>;
}

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
   * @param resume Optional recovery state from a prior, incomplete attempt
   *   at this same run — see ArtGenerationResume.
   */
  generate(
    story: StoryManifest,
    outputDir: string,
    resume?: ArtGenerationResume,
  ): Promise<AssetManifest>;
}
