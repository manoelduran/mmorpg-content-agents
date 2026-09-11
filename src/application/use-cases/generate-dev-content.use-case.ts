import type { IDevAgent } from "../ports/dev-agent.port";
import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { TargetRepoConventions } from "../ports/target-repo-conventions.port";
import {
  DevContentSchema,
  type DevContent,
} from "../../domain/value-objects/dev-content.value-object";

export class GenerateDevContentUseCase {
  constructor(private readonly devAgent: IDevAgent) {}

  async execute(
    story: StoryManifest,
    conventions: TargetRepoConventions,
  ): Promise<DevContent> {
    const raw = await this.devAgent.generate(story, conventions);
    return DevContentSchema.parse(raw);
  }
}
