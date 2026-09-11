import { z } from "zod";

/**
 * What the Story/Lore agent produces. Everything downstream (Art, Dev)
 * treats this as their only input — neither agent invents narrative on its
 * own, they only realize what Story already decided.
 */
export const NpcBriefSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable slug, e.g. 'harbor-master'. Referenced by quests and by the Art/Dev agents' output — never renamed after Story produces it.",
    ),
  name: z.string(),
  role: z
    .string()
    .describe("QUEST_GIVER, MERCHANT, GATEKEEPER, or a short free-text role"),
  personality: z.string(),
  dialogueHooks: z
    .array(z.string())
    .min(1)
    .describe("Short lines/topics this NPC can open a conversation with"),
});

export const QuestBriefSchema = z.object({
  id: z.string(),
  title: z.string(),
  narrative: z.string().describe("Why the NPC is asking for this"),
  giverNpcId: z.string().describe("Must match an id in npcs[]"),
  objectiveSketch: z
    .string()
    .describe(
      "Plain-language objective, e.g. 'defeat 5 bilge rats near the docks' — the Dev agent turns this into concrete counters",
    ),
});

export const MonsterBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  flavor: z.string().describe("One or two sentences of monster flavor text"),
  threatTier: z
    .enum(["trivial", "standard", "elite", "boss"])
    .describe("Relative difficulty within this zone only"),
});

export const StoryManifestSchema = z.object({
  zoneId: z.string().describe("Stable slug for the whole package"),
  zoneName: z.string(),
  lore: z
    .string()
    .describe("The zone's backstory — what Art and Dev both anchor to"),
  atmosphereKeywords: z
    .array(z.string())
    .min(3)
    .describe(
      "Short mood/visual keywords for the Art agent, e.g. ['salt-worn wood', 'fog', 'rust']",
    ),
  levelRange: z.object({ min: z.number().int(), max: z.number().int() }),
  npcs: z.array(NpcBriefSchema).min(1),
  quests: z.array(QuestBriefSchema).min(1),
  monsters: z.array(MonsterBriefSchema).min(1),
});

export type NpcBrief = z.infer<typeof NpcBriefSchema>;
export type QuestBrief = z.infer<typeof QuestBriefSchema>;
export type MonsterBrief = z.infer<typeof MonsterBriefSchema>;
export type StoryManifest = z.infer<typeof StoryManifestSchema>;
