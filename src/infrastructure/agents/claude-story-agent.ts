import { z } from "zod";
import type { IStoryAgent } from "../../application/ports/story-agent.port";
import {
  StoryManifestSchema,
  type StoryManifest,
} from "../../domain/value-objects/story-manifest.value-object";
import { runStructuredAgent } from "./run-structured-agent";

const STORY_AGENT_PROMPT = `You are the Story/Lore agent for Aetherbound Online, a fantasy MMORPG.

Given a short brief describing a new zone, invent:
- A zone lore paragraph that fits the existing world ("O Paradoxo das Eras" —
  a world fractured into temporal biomes anchored by the city Aethelgard).
- 2-4 NPCs with distinct personalities and dialogue hooks.
- 1-3 quests, each given by one of those NPCs, with a plain-language
  objective sketch (not mechanical numbers — the Dev agent turns those into
  concrete counters).
- 1-3 monster types with flavor text and a relative threat tier.
- Atmosphere keywords the Art agent will use for visual direction.

Write all narrative content in Brazilian Portuguese (pt-BR), matching the
rest of the game's text. Every id you invent (zoneId, npc ids, quest ids,
monster ids) must be a short, stable, kebab-case slug — Art and Dev will
reference these ids verbatim, so never reuse an id for two different things
and never rename one mid-response.`;

export class ClaudeStoryAgent implements IStoryAgent {
  async generate(brief: string): Promise<StoryManifest> {
    const raw = await runStructuredAgent<StoryManifest>(brief, {
      agentType: "story",
      definition: {
        description: "Generates zone lore, NPCs, quests and monster flavor",
        prompt: STORY_AGENT_PROMPT,
        tools: [],
      },
      outputSchema: z.toJSONSchema(StoryManifestSchema) as Record<
        string,
        unknown
      >,
    });
    return StoryManifestSchema.parse(raw);
  }
}
