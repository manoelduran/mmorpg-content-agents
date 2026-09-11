import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";

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
   */
  generate(brief: string, worldContext?: string): Promise<StoryManifest>;
}
