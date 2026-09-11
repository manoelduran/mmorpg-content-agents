import { z } from "zod";
import {
  CityNpcRosterSchema,
  CityQuestListSchema,
  CityFieldListSchema,
  CityPortalListSchema,
  CityInstanceListSchema,
} from "./city-template.value-object";

/**
 * What the Story/Lore agent produces. Everything downstream (Art, Dev)
 * treats this as their only input — neither agent invents narrative on its
 * own, they only realize what Story already decided. The exact
 * cardinalities (8 npcs, 10 quests, 4 portals/fields, 2 instances) come
 * from city-template.value-object.ts, not from this file — this is just
 * the narrative content that fills that fixed shape.
 */
export const StoryManifestSchema = z.object({
  cityId: z.string().describe("Stable slug for the whole package"),
  cityName: z.string(),
  lore: z
    .string()
    .describe("The city's backstory — what Art and Dev both anchor to"),
  atmosphereKeywords: z
    .array(z.string())
    .min(3)
    .describe(
      "Short mood/visual keywords for the Art agent, e.g. ['salt-worn wood', 'fog', 'rust']",
    ),
  levelRange: z.object({ min: z.number().int(), max: z.number().int() }),
  npcs: CityNpcRosterSchema,
  quests: CityQuestListSchema,
  fields: CityFieldListSchema,
  portals: CityPortalListSchema,
  instances: CityInstanceListSchema,
});

export type StoryManifest = z.infer<typeof StoryManifestSchema>;

export * from "./city-template.value-object";
