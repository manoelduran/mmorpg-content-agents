import type { IStoryAgent } from "../ports/story-agent.port";
import {
  StoryManifestSchema,
  type StoryManifest,
} from "../../domain/value-objects/story-manifest.value-object";
import type { ExistingCityContext } from "../../domain/value-objects/existing-city-context.value-object";

export class GenerateStoryUseCase {
  constructor(private readonly storyAgent: IStoryAgent) {}

  async execute(
    brief: string,
    worldContext = "",
    existingCity?: ExistingCityContext,
  ): Promise<StoryManifest> {
    // Preserving existingCity's pinned NPCs is enforced inside the agent's
    // own retry loop (extraValidation, see run-structured-openrouter-agent.ts)
    // so a violation can trigger self-correction — checking it again here,
    // after the agent already succeeded, would be too late for that.
    const raw = await this.storyAgent.generate(brief, worldContext, existingCity);
    // Re-validate at the boundary even though the agent's outputFormat
    // already enforces the schema — a second, explicit check here means
    // this use-case's correctness doesn't depend on trusting the
    // infrastructure layer wired it up right.
    return StoryManifestSchema.parse(raw);
  }
}
