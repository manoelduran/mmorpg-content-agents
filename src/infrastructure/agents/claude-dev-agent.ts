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

Turn a city's story into the structural fields the game's real schema
needs, following the target repo's own conventions given to you below
verbatim (Clean Architecture / DDD rules from mmorpg-backend's CLAUDE.md
and AGENTS.md). You are producing DATA (a DevContent JSON object), never
code or SQL — a separate installer consumes this later using the target
repo's own use-cases, so nothing you output should assume direct database
access.

You must produce, 1:1 with what the story defined:
- map: the city's own map (width/height >= 50, isCity: true)
- npcPlacements: a position for every npc in the roster
- portalPlacements: a position for every portal, on the city map's edge
  matching its direction (NORTH means y near 0, SOUTH near height, EAST
  near width, WEST near 0 — leave a few tiles of margin from the literal
  border)
- questObjectives: one per quest — for KILL_MONSTER, objectiveTarget is a
  field monster id; for TALK_TO_NPC, objectiveTarget is an npc id
- fieldMaps: one per field, each with its own map (width/height >= 50) and
  monster stats (level, hp, attack, defense, rewards, spawn positions, and
  exactly 2 COMMON + 1 RARE drops) for every monster that field defined
- instances: one per instance, each with its own map (smaller is fine,
  width/height >= 20) and monster stats for its 2 NORMAL + 1 BOSS monsters
  (boss stats should clearly exceed normal — meaningfully higher hp/attack)

Scale every monster's stats and every quest's rewards to the story's
levelRange — an instance boss should be noticeably stronger than a field
monster in the same city. Every npcId/questId/fieldId/portalId/monsterId
you reference must come from the story manifest exactly as given — never
invent a new one here.`;

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
