import { z } from "zod";
import type { IDevAgent } from "../../application/ports/dev-agent.port";
import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { TargetRepoConventions } from "../../application/ports/target-repo-conventions.port";
import {
  DevContentSchema,
  type DevContent,
} from "../../domain/value-objects/dev-content.value-object";
import { runStructuredAgent } from "./run-structured-agent";

const DEV_AGENT_PROMPT = `You are the Fullstack Dev agent for Aetherbound Online.

Turn a zone's story into the structural fields the game's real schema
needs — map size, NPC positions, quest objective counters, monster stats —
following the target repo's own conventions given to you below verbatim
(Clean Architecture / DDD rules from mmorpg-backend's CLAUDE.md and
AGENTS.md). You are producing DATA (a DevContent JSON object), never code
or SQL — a separate installer consumes this later using the target repo's
own use-cases, so nothing you output should assume direct database access.

Scale monster stats and quest rewards to the story's levelRange. Keep map
width/height at least 50, matching every existing map in this world. Every
npcId/questId/monsterId you reference must come from the story manifest
exactly as given — never invent a new one here.`;

export class ClaudeDevAgent implements IDevAgent {
  async generate(
    story: StoryManifest,
    conventions: TargetRepoConventions,
  ): Promise<DevContent> {
    const prompt = `--- TARGET REPO CONVENTIONS (mmorpg-backend) ---
${conventions.backendRules}

${conventions.ticketWorkflow ? `--- TDD/TICKET WORKFLOW ---\n${conventions.ticketWorkflow}\n` : ""}
${conventions.frontendRules ? `--- TARGET REPO CONVENTIONS (mmorpg-frontend) ---\n${conventions.frontendRules}\n` : ""}
--- STORY MANIFEST ---
${JSON.stringify(story, null, 2)}`;

    const raw = await runStructuredAgent<DevContent>(prompt, {
      agentType: "dev",
      definition: {
        description: "Produces structural game-content data from a story manifest",
        prompt: DEV_AGENT_PROMPT,
        tools: [],
      },
      outputSchema: z.toJSONSchema(DevContentSchema) as Record<
        string,
        unknown
      >,
    });
    return DevContentSchema.parse(raw);
  }
}
