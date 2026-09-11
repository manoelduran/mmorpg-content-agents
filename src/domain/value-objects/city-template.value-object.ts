import { z } from "zod";

/**
 * The fixed structural template every generated city must follow — the
 * exact numbers the user specified, encoded as zod validation instead of
 * prompt instructions the model might drift from. A StoryManifest that
 * doesn't match these counts fails at the domain boundary before Art or
 * Dev ever see it (see generate-story.use-case.ts's re-validation).
 *
 * ROSTER (8 NPCs total):
 *   1 MERCHANT, 1 TELEPORTER, 3 QUEST_GIVER, 1 BLACKSMITH, 2 INSTANCE_MASTER
 * QUESTS: exactly 10, KILL_MONSTER or TALK_TO_NPC, given by the 3 QUEST_GIVERs
 * PORTALS: exactly 4, one per cardinal direction, each leading to one field
 * FIELDS: exactly 4 (1:1 with portals), each with exactly 3 monster types
 * FIELD MONSTER DROPS: exactly 2 COMMON + 1 RARE per monster
 * INSTANCES: exactly 2, each with exactly 2 NORMAL monsters + 1 BOSS
 */

export const NpcRoleSchema = z.enum([
  "MERCHANT",
  "TELEPORTER",
  "QUEST_GIVER",
  "BLACKSMITH",
  "INSTANCE_MASTER",
]);
export type NpcRole = z.infer<typeof NpcRoleSchema>;

export const CITY_NPC_ROLE_COUNTS: Record<NpcRole, number> = {
  MERCHANT: 1,
  TELEPORTER: 1,
  QUEST_GIVER: 3,
  BLACKSMITH: 1,
  INSTANCE_MASTER: 2,
};
export const CITY_NPC_COUNT = Object.values(CITY_NPC_ROLE_COUNTS).reduce(
  (a, b) => a + b,
  0,
); // 8

export const CityNpcSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable slug, e.g. 'harbor-master'. Referenced by quests/instances and by the Art/Dev agents' output — never renamed after Story produces it.",
    ),
  name: z.string(),
  role: NpcRoleSchema,
  personality: z.string(),
  dialogueHooks: z
    .array(z.string())
    .min(1)
    .describe("Short lines/topics this NPC can open a conversation with"),
});
export type CityNpc = z.infer<typeof CityNpcSchema>;

function roleCountIssues(
  npcs: CityNpc[],
): { role: NpcRole; expected: number; actual: number }[] {
  const counts: Partial<Record<NpcRole, number>> = {};
  for (const npc of npcs) counts[npc.role] = (counts[npc.role] ?? 0) + 1;
  const issues: { role: NpcRole; expected: number; actual: number }[] = [];
  for (const role of Object.keys(CITY_NPC_ROLE_COUNTS) as NpcRole[]) {
    const expected = CITY_NPC_ROLE_COUNTS[role];
    const actual = counts[role] ?? 0;
    if (actual !== expected) issues.push({ role, expected, actual });
  }
  return issues;
}

export const CityNpcRosterSchema = z
  .array(CityNpcSchema)
  .length(
    CITY_NPC_COUNT,
    `A city must have exactly ${CITY_NPC_COUNT} NPCs (${Object.entries(CITY_NPC_ROLE_COUNTS)
      .map(([role, n]) => `${n} ${role}`)
      .join(", ")})`,
  )
  .superRefine((npcs, ctx) => {
    for (const { role, expected, actual } of roleCountIssues(npcs)) {
      ctx.addIssue({
        code: "custom",
        message: `Expected exactly ${expected} NPC(s) with role '${role}', got ${actual}`,
      });
    }
  });

export const CityQuestObjectiveTypeSchema = z.enum([
  "KILL_MONSTER",
  "TALK_TO_NPC",
]);

export const CityQuestSchema = z.object({
  id: z.string(),
  title: z.string(),
  narrative: z.string().describe("Why the NPC is asking for this"),
  giverNpcId: z
    .string()
    .describe("Must match one of the 3 QUEST_GIVER npcs' id"),
  objectiveType: CityQuestObjectiveTypeSchema,
  objectiveSketch: z
    .string()
    .describe(
      "For KILL_MONSTER: plain-language target, e.g. 'defeat 5 bilge rats' — Dev turns this into a concrete counter. " +
        "For TALK_TO_NPC: which NPC to talk to and what lore/history of this package the conversation reveals — these exist to teach the player about the new content, on top of the XP reward.",
    ),
});
export type CityQuest = z.infer<typeof CityQuestSchema>;

export const CITY_QUEST_COUNT = 10;
export const CityQuestListSchema = z
  .array(CityQuestSchema)
  .length(CITY_QUEST_COUNT);

export const FieldMonsterBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  flavor: z.string().describe("One or two sentences of monster flavor text"),
});
export type FieldMonsterBrief = z.infer<typeof FieldMonsterBriefSchema>;

export const CITY_FIELD_MONSTER_COUNT = 3;
export const CompassDirectionSchema = z.enum(["NORTH", "SOUTH", "EAST", "WEST"]);
export type CompassDirection = z.infer<typeof CompassDirectionSchema>;

export const FieldBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  atmosphere: z.string(),
  monsters: z.array(FieldMonsterBriefSchema).length(CITY_FIELD_MONSTER_COUNT),
});
export type FieldBrief = z.infer<typeof FieldBriefSchema>;

export const CITY_FIELD_COUNT = 4;
export const CityFieldListSchema = z
  .array(FieldBriefSchema)
  .length(CITY_FIELD_COUNT);

export const PortalBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  direction: CompassDirectionSchema.describe(
    "The city edge this portal sits at — exactly one portal per direction",
  ),
  fieldId: z.string().describe("Matches exactly one fields[].id — 1:1"),
});
export type PortalBrief = z.infer<typeof PortalBriefSchema>;

export const CITY_PORTAL_COUNT = 4;
export const CityPortalListSchema = z
  .array(PortalBriefSchema)
  .length(CITY_PORTAL_COUNT)
  .superRefine((portals, ctx) => {
    const directions = new Set(portals.map((p) => p.direction));
    if (directions.size !== CITY_PORTAL_COUNT) {
      ctx.addIssue({
        code: "custom",
        message:
          "Every portal must sit at a distinct cardinal direction (one NORTH, one SOUTH, one EAST, one WEST)",
      });
    }
    const fieldIds = new Set(portals.map((p) => p.fieldId));
    if (fieldIds.size !== portals.length) {
      ctx.addIssue({
        code: "custom",
        message: "Each portal must lead to its own field — no two portals sharing a fieldId",
      });
    }
  });

export const InstanceMonsterRoleSchema = z.enum(["NORMAL", "BOSS"]);
export const INSTANCE_MONSTER_ROLE_COUNTS = { NORMAL: 2, BOSS: 1 } as const;
export const CITY_INSTANCE_MONSTER_COUNT = 3;

export const InstanceMonsterBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  flavor: z.string(),
  role: InstanceMonsterRoleSchema,
});
export type InstanceMonsterBrief = z.infer<typeof InstanceMonsterBriefSchema>;

export const InstanceBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  theme: z.string(),
  instanceMasterNpcId: z
    .string()
    .describe("Must match one of the 2 INSTANCE_MASTER npcs' id"),
  monsters: z
    .array(InstanceMonsterBriefSchema)
    .length(CITY_INSTANCE_MONSTER_COUNT)
    .superRefine((monsters, ctx) => {
      const counts: Partial<Record<"NORMAL" | "BOSS", number>> = {};
      for (const m of monsters) counts[m.role] = (counts[m.role] ?? 0) + 1;
      for (const role of Object.keys(INSTANCE_MONSTER_ROLE_COUNTS) as (
        | "NORMAL"
        | "BOSS"
      )[]) {
        const expected = INSTANCE_MONSTER_ROLE_COUNTS[role];
        const actual = counts[role] ?? 0;
        if (actual !== expected) {
          ctx.addIssue({
            code: "custom",
            message: `Instance must have exactly ${expected} ${role} monster(s), got ${actual}`,
          });
        }
      }
    }),
});
export type InstanceBrief = z.infer<typeof InstanceBriefSchema>;

export const CITY_INSTANCE_COUNT = 2;
export const CityInstanceListSchema = z
  .array(InstanceBriefSchema)
  .length(CITY_INSTANCE_COUNT)
  .superRefine((instances, ctx) => {
    const masterIds = new Set(instances.map((i) => i.instanceMasterNpcId));
    if (masterIds.size !== instances.length) {
      ctx.addIssue({
        code: "custom",
        message:
          "Each instance must have its own INSTANCE_MASTER npc — no two instances sharing one",
      });
    }
  });
