import type { IStoryAgent } from "../ports/story-agent.port";
import {
  StoryManifestSchema,
  type StoryManifest,
} from "../../domain/value-objects/story-manifest.value-object";

export class GenerateStoryUseCase {
  constructor(private readonly storyAgent: IStoryAgent) {}

  async execute(brief: string): Promise<StoryManifest> {
    const raw = await this.storyAgent.generate(brief);
    // Re-validate at the boundary even though the agent's outputFormat
    // already enforces the schema — a second, explicit check here means
    // this use-case's correctness doesn't depend on trusting the
    // infrastructure layer wired it up right.
    return StoryManifestSchema.parse(raw);
  }
}
