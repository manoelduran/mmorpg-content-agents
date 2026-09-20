import { z } from "zod";
import {
  CityQuestObjectiveTypeSchema,
  CITY_NPC_COUNT,
  CITY_QUEST_COUNT,
  CITY_PORTAL_COUNT,
  CITY_FIELD_COUNT,
  CITY_FIELD_MONSTER_COUNT,
  CITY_INSTANCE_COUNT,
  CITY_INSTANCE_MONSTER_COUNT,
  CITY_SHOP_NPC_COUNT,
  SHOP_ITEM_COUNT,
} from "./city-template.value-object";

/**
 * What the Fullstack Dev agent produces: the StoryManifest's narrative
 * turned into the concrete structural fields the game's schema actually
 * needs. Field names deliberately mirror mmorpg-backend's real tables
 * (see ../../../../mmorpg-backend/src/infrastructure/database/schema.ts and
 * src/database/seeds/01_game_simulation_data.ts) so a future installer can
 * map this 1:1 onto existing use-cases (CreateMapUseCase,
 * AddMonsterToMapUseCase, ...) without another translation layer. Array
 * lengths here mirror city-template.value-object.ts's cardinalities —
 * every list is imported and re-checked against the same constants Story
 * validates against, so Dev can't structurally drift from what Story
 * already committed to.
 */
export const PositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int().default(0),
});
export type Position = z.infer<typeof PositionSchema>;

export const MapDefinitionSchema = z.object({
  mapId: z.string().describe("Stable slug for this map"),
  name: z.string(),
  width: z.number().int().min(50),
  height: z.number().int().min(50),
  isCity: z.boolean().default(false),
});
export type MapDefinition = z.infer<typeof MapDefinitionSchema>;

export const NpcPlacementSchema = z.object({
  npcId: z.string().describe("Matches StoryManifest npcs[].id"),
  position: PositionSchema,
});
export type NpcPlacement = z.infer<typeof NpcPlacementSchema>;
export const CityNpcPlacementListSchema = z
  .array(NpcPlacementSchema)
  .length(CITY_NPC_COUNT);

export const PortalPlacementSchema = z.object({
  portalId: z.string().describe("Matches StoryManifest portals[].id"),
  position: PositionSchema.describe(
    "Must sit on the city map's edge matching the portal's direction",
  ),
});
export type PortalPlacement = z.infer<typeof PortalPlacementSchema>;
export const CityPortalPlacementListSchema = z
  .array(PortalPlacementSchema)
  .length(CITY_PORTAL_COUNT);

export const DropRaritySchema = z.enum(["COMMON", "RARE"]);
const FIELD_DROP_RARITY_COUNTS = { COMMON: 2, RARE: 1 } as const;
const FIELD_MONSTER_DROP_COUNT = 3;

export const MonsterDropSchema = z.object({
  itemId: z.string(),
  itemName: z.string(),
  rarity: DropRaritySchema,
  dropRate: z.number().min(0).max(100),
  description: z
    .string()
    .describe(
      "One sentence of item flavor text, specific to this item — what it looks like, what it's used for, or which monster/place it's tied to. Never a generic line reused across other drops.",
    ),
});
export type MonsterDrop = z.infer<typeof MonsterDropSchema>;

export const FieldMonsterStatsSchema = z.object({
  monsterId: z.string().describe("Matches a fields[].monsters[].id in StoryManifest"),
  level: z.number().int().positive(),
  maxHp: z.number().int().positive(),
  attack: z.number().int().nonnegative(),
  defense: z.number().int().nonnegative(),
  expReward: z.number().int().nonnegative(),
  goldReward: z.number().int().nonnegative(),
  respawnTimeSeconds: z.number().int().positive(),
  spawnPositions: z.array(PositionSchema).min(1),
  drops: z
    .array(MonsterDropSchema)
    .length(
      FIELD_MONSTER_DROP_COUNT,
      "Every field monster needs exactly 2 common drops + 1 rare drop",
    )
    .superRefine((drops, ctx) => {
      const counts: Partial<Record<"COMMON" | "RARE", number>> = {};
      for (const d of drops) counts[d.rarity] = (counts[d.rarity] ?? 0) + 1;
      for (const rarity of Object.keys(FIELD_DROP_RARITY_COUNTS) as (
        | "COMMON"
        | "RARE"
      )[]) {
        const expected = FIELD_DROP_RARITY_COUNTS[rarity];
        const actual = counts[rarity] ?? 0;
        if (actual !== expected) {
          ctx.addIssue({
            code: "custom",
            message: `Expected exactly ${expected} ${rarity} drop(s), got ${actual}`,
          });
        }
      }
    }),
});
export type FieldMonsterStats = z.infer<typeof FieldMonsterStatsSchema>;

export const FieldMapSchema = z.object({
  fieldId: z.string().describe("Matches StoryManifest fields[].id"),
  mapId: z.string(),
  name: z.string(),
  width: z.number().int().min(50),
  height: z.number().int().min(50),
  monsterStats: z
    .array(FieldMonsterStatsSchema)
    .length(CITY_FIELD_MONSTER_COUNT),
});
export type FieldMap = z.infer<typeof FieldMapSchema>;
export const CityFieldMapListSchema = z
  .array(FieldMapSchema)
  .length(CITY_FIELD_COUNT);

export const InstanceMonsterStatsSchema = z.object({
  monsterId: z.string().describe("Matches an instances[].monsters[].id in StoryManifest"),
  level: z.number().int().positive(),
  maxHp: z.number().int().positive(),
  attack: z.number().int().nonnegative(),
  defense: z.number().int().nonnegative(),
  expReward: z.number().int().nonnegative(),
  goldReward: z.number().int().nonnegative(),
  // Unlike field monsters, drop composition for instance monsters wasn't
  // specified — left open (including empty) rather than assuming a rule
  // that wasn't asked for.
  drops: z.array(MonsterDropSchema).default([]),
});
export type InstanceMonsterStats = z.infer<typeof InstanceMonsterStatsSchema>;

export const InstanceDefinitionSchema = z.object({
  instanceId: z.string().describe("Matches StoryManifest instances[].id"),
  mapId: z.string(),
  name: z.string(),
  width: z.number().int().min(20),
  height: z.number().int().min(20),
  monsterStats: z
    .array(InstanceMonsterStatsSchema)
    .length(CITY_INSTANCE_MONSTER_COUNT),
});
export type InstanceDefinition = z.infer<typeof InstanceDefinitionSchema>;
export const CityInstanceDefinitionListSchema = z
  .array(InstanceDefinitionSchema)
  .length(CITY_INSTANCE_COUNT);

export const QuestObjectiveSchema = z.object({
  questId: z.string().describe("Matches StoryManifest quests[].id"),
  objectiveType: CityQuestObjectiveTypeSchema,
  objectiveTarget: z
    .string()
    .describe(
      "A field monster id for KILL_MONSTER, or an npc id for TALK_TO_NPC",
    ),
  objectiveRequiredCount: z.number().int().positive(),
  minLevel: z.number().int(),
  expReward: z.number().int().nonnegative(),
  goldReward: z.number().int().nonnegative(),
  itemRewardIds: z.array(z.string()).default([]),
  prerequisiteQuestIds: z.array(z.string()).default([]),
});
export type QuestObjective = z.infer<typeof QuestObjectiveSchema>;
export const CityQuestObjectiveListSchema = z
  .array(QuestObjectiveSchema)
  .length(CITY_QUEST_COUNT);

export const ShopItemTypeSchema = z.enum(["EQUIPMENT", "CONSUMABLE", "MATERIAL"]);

export const ShopItemSchema = z.object({
  itemName: z.string(),
  itemType: ShopItemTypeSchema,
  price: z.number().int().positive(),
  description: z.string(),
});
export type ShopItem = z.infer<typeof ShopItemSchema>;

export const ShopInventorySchema = z.object({
  npcId: z.string().describe("Matches the MERCHANT or BLACKSMITH npc's id in StoryManifest"),
  items: z.array(ShopItemSchema).length(SHOP_ITEM_COUNT),
});
export type ShopInventory = z.infer<typeof ShopInventorySchema>;
export const CityShopInventoryListSchema = z
  .array(ShopInventorySchema)
  .length(CITY_SHOP_NPC_COUNT);

export const PortalGuardianPlacementSchema = z.object({
  portalId: z.string().describe("Matches StoryManifest portals[].id"),
  outboundGuardianPosition: PositionSchema.describe(
    "On the city map, right at the portal, matching its direction",
  ),
  returnGuidePosition: PositionSchema.describe(
    "On the destination field map (fieldMaps[].mapId for this portal's " +
      "fieldId), on the edge closest to the city",
  ),
});
export type PortalGuardianPlacement = z.infer<typeof PortalGuardianPlacementSchema>;
export const CityPortalGuardianPlacementListSchema = z
  .array(PortalGuardianPlacementSchema)
  .length(CITY_PORTAL_COUNT);

export const InstanceCompanionPlacementSchema = z.object({
  instanceId: z.string().describe("Matches StoryManifest instances[].id"),
  questGiverPosition: PositionSchema.describe("On this instance's own map"),
  returnPortalPosition: PositionSchema.describe(
    "On this instance's own map, near the quest giver",
  ),
});
export type InstanceCompanionPlacement = z.infer<typeof InstanceCompanionPlacementSchema>;
export const CityInstanceCompanionPlacementListSchema = z
  .array(InstanceCompanionPlacementSchema)
  .length(CITY_INSTANCE_COUNT);

export const DevContentSchema = z.object({
  cityId: z.string(),
  map: MapDefinitionSchema,
  npcPlacements: CityNpcPlacementListSchema,
  portalPlacements: CityPortalPlacementListSchema,
  portalGuardianPlacements: CityPortalGuardianPlacementListSchema,
  questObjectives: CityQuestObjectiveListSchema,
  fieldMaps: CityFieldMapListSchema,
  instances: CityInstanceDefinitionListSchema,
  instanceCompanionPlacements: CityInstanceCompanionPlacementListSchema,
  shopInventories: CityShopInventoryListSchema,
});

export type DevContent = z.infer<typeof DevContentSchema>;
