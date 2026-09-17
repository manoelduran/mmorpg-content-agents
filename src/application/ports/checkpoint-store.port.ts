import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { AssetEntry, AssetManifest } from "../../domain/value-objects/asset-manifest.value-object";
import type { DevContent } from "../../domain/value-objects/dev-content.value-object";
import type { ContentPackage } from "../../domain/entities/content-package.entity";

/**
 * ── AI ENGINEERING CONCEPT: checkpointing for recovery ──
 *
 * Each phase of this pipeline calls a paid LLM API. Without checkpoints,
 * a crash after Story and Art succeed but before Dev finishes means
 * re-running the WHOLE pipeline from scratch — paying for Story and Art
 * again just to get back to where you already were.
 *
 * A checkpoint is just "what did we already finish, saved to disk, keyed
 * by a run id the caller controls." On resume, the orchestrator checks
 * for an existing checkpoint before calling each agent — if that phase is
 * already done, it loads the saved result instead of paying for it again.
 * This is the same idempotency-key pattern payment APIs use (a client
 * supplies an idempotency key; retrying a request with the same key
 * returns the original result instead of double-charging).
 */
export type PipelinePhase = "story" | "assets_and_dev" | "done";

export type Checkpoint =
  | { phase: "story"; story: StoryManifest }
  | {
      phase: "assets_and_dev";
      story: StoryManifest;
      /** Set once Dev finishes — independent of Art's own progress below.
       * Dev is one fast call; Art is ~26 slow multimodal ones, so Dev
       * shouldn't be held hostage by (or lost to a failure in) Art. See
       * OrchestrateContentGenerationUseCase. */
      dev?: DevContent;
      /** Entities Art has finished so far — may be a strict subset of the
       * full roster if a prior attempt crashed/errored partway through. A
       * resume only asks Art to regenerate whatever entityId isn't here
       * yet (see ArtGenerationResume in art-agent.port.ts). */
      completedAssets: AssetEntry[];
    }
  | { phase: "done"; story: StoryManifest; assets: AssetManifest; dev: DevContent; package: ContentPackage; manifestPath: string };

export interface ICheckpointStore {
  load(runId: string): Promise<Checkpoint | null>;
  save(runId: string, checkpoint: Checkpoint): Promise<void>;
}
