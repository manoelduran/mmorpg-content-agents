import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";

export interface IStoryAgent {
  /**
   * Turns a free-text brief ("a coastal pirate town, level 15-20") into a
   * validated StoryManifest. The only agent that invents narrative — Art
   * and Dev only ever realize what this returns.
   */
  generate(brief: string): Promise<StoryManifest>;
}
