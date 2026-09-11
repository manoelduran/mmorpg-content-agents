import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { DevContent } from "../../domain/value-objects/dev-content.value-object";
import type { TargetRepoConventions } from "./target-repo-conventions.port";

export interface IDevAgent {
  /**
   * Turns the story into the structural fields the game's schema needs
   * (map size, spawn positions, quest objective counters, monster stats
   * scaled to the story's levelRange). Produces data, never code or SQL —
   * see "Fora de escopo" in the project plan for why the actual installer
   * is a separate, future piece of work.
   */
  generate(
    story: StoryManifest,
    conventions: TargetRepoConventions,
  ): Promise<DevContent>;
}
