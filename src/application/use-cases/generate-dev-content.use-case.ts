import type { IDevAgent } from "../ports/dev-agent.port";
import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { TargetRepoConventions } from "../ports/target-repo-conventions.port";
import {
  DevContentSchema,
  type DevContent,
} from "../../domain/value-objects/dev-content.value-object";
import type { ExistingCityContext } from "../../domain/value-objects/existing-city-context.value-object";

export class GenerateDevContentUseCase {
  constructor(private readonly devAgent: IDevAgent) {}

  async execute(
    story: StoryManifest,
    conventions: TargetRepoConventions,
    existingCity?: ExistingCityContext,
  ): Promise<DevContent> {
    // Same reasoning as GenerateStoryUseCase.execute(): the pinned-map/
    // pinned-position check lives inside the agent's retry loop, not here.
    const raw = await this.devAgent.generate(story, conventions, existingCity);
    return DevContentSchema.parse(raw);
  }
}
