import { z } from "zod";

/**
 * What the Fullstack Dev agent produces: the StoryManifest's narrative
 * turned into the concrete structural fields the game's schema actually
 * needs. Field names deliberately mirror mmorpg-backend's real tables
 * (see ../../../../mmorpg-backend/src/infrastructure/database/schema.ts and
 * src/database/seeds/01_game_simulation_data.ts) so a future installer can
 * map this 1:1 onto existing use-cases (CreateMapUseCase,
 * AddMonsterToMapUseCase, ...) without another translation layer.
 */
export const PositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int().default(0),
});

export const NpcPlacementSchema = z.object({
  npcId: z.string().describe("Matches StoryManifest npcs[].id"),
  position: PositionSchema,
});

export const QuestObjectiveSchema = z.object({
  questId: z.string().describe("Matches StoryManifest quests[].id"),
  objectiveType: z.enum(["KILL_MONSTER", "COLLECT_ITEM", "TALK_TO_NPC"]),
  objectiveTarget: z
    .string()
    .describe("Monster/item id/name this objective counts against"),
  objectiveRequiredCount: z.number().int().positive(),
  minLevel: z.number().int(),
  expReward: z.number().int().nonnegative(),
  goldReward: z.number().int().nonnegative(),
  itemRewardIds: z.array(z.string()).default([]),
  prerequisiteQuestIds: z.array(z.string()).default([]),
});

export const MonsterStatsSchema = z.object({
  monsterId: z.string().describe("Matches StoryManifest monsters[].id"),
  level: z.number().int().positive(),
  maxHp: z.number().int().positive(),
  attack: z.number().int().nonnegative(),
  defense: z.number().int().nonnegative(),
  expReward: z.number().int().nonnegative(),
  goldReward: z.number().int().nonnegative(),
  respawnTimeSeconds: z.number().int().positive(),
  spawnPositions: z.array(PositionSchema).min(1),
});

export const MapDefinitionSchema = z.object({
  mapId: z.string().describe("Stable slug for this zone's map"),
  name: z.string(),
  width: z.number().int().min(50),
  height: z.number().int().min(50),
  isCity: z.boolean().default(false),
});

export const DevContentSchema = z.object({
  zoneId: z.string(),
  map: MapDefinitionSchema,
  npcPlacements: z.array(NpcPlacementSchema).min(1),
  questObjectives: z.array(QuestObjectiveSchema).min(1),
  monsterStats: z.array(MonsterStatsSchema).min(1),
});

export type Position = z.infer<typeof PositionSchema>;
export type NpcPlacement = z.infer<typeof NpcPlacementSchema>;
export type QuestObjective = z.infer<typeof QuestObjectiveSchema>;
export type MonsterStats = z.infer<typeof MonsterStatsSchema>;
export type MapDefinition = z.infer<typeof MapDefinitionSchema>;
export type DevContent = z.infer<typeof DevContentSchema>;
