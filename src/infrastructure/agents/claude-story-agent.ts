import { z } from "zod";
import type { IStoryAgent } from "../../application/ports/story-agent.port";
import {
  StoryManifestSchema,
  type StoryManifest,
  CITY_NPC_ROLE_COUNTS,
  CITY_QUEST_COUNT,
  CITY_PORTAL_COUNT,
  CITY_FIELD_COUNT,
  CITY_FIELD_MONSTER_COUNT,
  CITY_INSTANCE_COUNT,
  CITY_INSTANCE_MONSTER_COUNT,
  INSTANCE_MONSTER_ROLE_COUNTS,
} from "../../domain/value-objects/story-manifest.value-object";
import { runStructuredAgent } from "./run-structured-agent";
import type { IApprovalGate } from "../../application/ports/approval-gate.port";

const STORY_AGENT_PROMPT = `You are the Story/Lore agent for Aetherbound Online, a fantasy MMORPG.

Given a short brief describing a new city, invent everything needed to fill
the game's fixed city template exactly — not roughly, exactly, because the
output is schema-validated against these counts:

NPCs — exactly ${Object.values(CITY_NPC_ROLE_COUNTS).reduce((a, b) => a + b, 0)} total, with roles:
${Object.entries(CITY_NPC_ROLE_COUNTS)
  .map(([role, n]) => `  - ${n}x ${role}`)
  .join("\n")}
(MERCHANT sells goods, TELEPORTER travels the player to nearby cities,
QUEST_GIVER hands out the city's quests, BLACKSMITH refines equipment,
INSTANCE_MASTER lets the player enter one of the city's 2 instances.)

QUESTS — exactly ${CITY_QUEST_COUNT}, each given by one of the 3 QUEST_GIVER npcs (giverNpcId
must be one of their ids), each objectiveType either:
  - KILL_MONSTER: objectiveSketch names a field monster to defeat
  - TALK_TO_NPC: objectiveSketch names which npc to talk to and what piece
    of this city's lore/history that conversation teaches the player — these
    exist to teach players about the new content, on top of granting XP

PORTALS — exactly ${CITY_PORTAL_COUNT}, one per cardinal direction (NORTH/SOUTH/EAST/WEST),
each leading to exactly one FIELD (1:1, no sharing).

FIELDS — exactly ${CITY_FIELD_COUNT}, each with exactly ${CITY_FIELD_MONSTER_COUNT} distinct monster types
(flavor only here — the Dev agent assigns their stats/drops later).

INSTANCES — exactly ${CITY_INSTANCE_COUNT}, each owned by one of the 2 INSTANCE_MASTER npcs
(instanceMasterNpcId, one each, never shared), each with exactly
${CITY_INSTANCE_MONSTER_COUNT} monsters: ${INSTANCE_MONSTER_ROLE_COUNTS.NORMAL}x role NORMAL + ${INSTANCE_MONSTER_ROLE_COUNTS.BOSS}x role BOSS.

Also write: a city lore paragraph fitting the existing world ("O Paradoxo
das Eras" — a world fractured into temporal biomes anchored by the city
Aethelgard), a level range, and atmosphere keywords for the Art agent.

Write all narrative content (names, lore, dialogue, flavor text) in
Brazilian Portuguese (pt-BR), matching the rest of the game's text. Every id
you invent (cityId, npc/quest/field/portal/instance/monster ids) must be a
short, stable, kebab-case slug — Art and Dev reference these ids verbatim,
so never reuse an id for two different things and never rename one
mid-response.`;

export class ClaudeStoryAgent implements IStoryAgent {
  constructor(private readonly approvalGate: IApprovalGate) {}

  async generate(brief: string): Promise<StoryManifest> {
    // Story has tools: [] (see below) — it never calls a tool, so
    // approvalGate never actually fires for this agent. We still pass it
    // through (rather than special-casing "tool-less agents") so the
    // wiring stays uniform across all three agents and doesn't silently
    // break if Story ever gains a tool later.
    return runStructuredAgent<StoryManifest>(brief, {
      agentType: "story",
      definition: {
        description:
          "Generates city lore, NPC roster, quests, portals/fields and instances",
        prompt: STORY_AGENT_PROMPT,
        tools: [],
      },
      outputSchema: z.toJSONSchema(StoryManifestSchema) as Record<
        string,
        unknown
      >,
      zodSchema: StoryManifestSchema,
      approvalGate: this.approvalGate,
    });
  }
}
