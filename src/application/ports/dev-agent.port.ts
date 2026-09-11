import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { DevContent } from "../../domain/value-objects/dev-content.value-object";
import type { TargetRepoConventions } from "./target-repo-conventions.port";
import type { ExistingCityContext } from "../../domain/value-objects/existing-city-context.value-object";

export interface IDevAgent {
  /**
   * Turns the story into the structural fields the game's schema needs
   * (map size, spawn positions, quest objective counters, monster stats
   * scaled to the story's levelRange). Produces data, never code or SQL —
   * see "Fora de escopo" in the project plan for why the actual installer
   * is a separate, future piece of work.
   *
   * `existingCity`, when present, pins the city's real map (already built)
   * and its existing NPCs' real positions — Dev must echo these exactly
   * rather than invent a new map or move an NPC that's already standing
   * somewhere in the live game. See existing-city-context.value-object.ts.
   */
  generate(
    story: StoryManifest,
    conventions: TargetRepoConventions,
    existingCity?: ExistingCityContext,
  ): Promise<DevContent>;
}
