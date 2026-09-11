import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { ExistingCityContext } from "../../domain/value-objects/existing-city-context.value-object";

export interface IStoryAgent {
  /**
   * Turns a free-text brief ("a coastal pirate town, level 15-20") into a
   * validated StoryManifest. The only agent that invents narrative — Art
   * and Dev only ever realize what this returns.
   *
   * `worldContext` is the retrieval block from RetrieveWorldContextUseCase
   * (see retrieve-world-context.use-case.ts) — relevant past cities pulled
   * from long-term memory, or "" when nothing is relevant / this is the
   * first run ever. Optional so fakes/tests that don't care about memory
   * can omit it entirely.
   *
   * `existingCity` pins facts that must survive into the output unchanged
   * — a city (like Aethelgard) that already partially exists, with real
   * NPCs already placed in the live game. See
   * existing-city-context.value-object.ts. Omitted for a from-scratch city.
   */
  generate(
    brief: string,
    worldContext?: string,
    existingCity?: ExistingCityContext,
  ): Promise<StoryManifest>;
}
