import { z } from "zod";

/**
 * What the Art agent produces. One entry per generated or reused sprite —
 * `source` records whether it came from the existing asset pack/repo
 * (preferred) or had to be generated, which is the auditable trail proving
 * the agent actually checked before generating (see AGENTS.md).
 */
export const AssetEntrySchema = z.object({
  entityId: z
    .string()
    .describe("Matches an npc/monster/prop id from the StoryManifest"),
  relativePath: z
    .string()
    .describe("Path under this package's assets/ folder, e.g. 'assets/npcs/harbor-master.png'"),
  source: z.enum(["reused-from-pack", "reused-from-repo", "generated"]),
  sourceDetail: z
    .string()
    .describe(
      "Which pack/file it was cropped from, or a one-line description of the generation prompt",
    ),
  transparent: z
    .boolean()
    .describe("Verified real alpha transparency, not a baked-in checkerboard"),
});

export const AssetManifestSchema = z.object({
  zoneId: z.string(),
  assets: z.array(AssetEntrySchema).min(1),
});

export type AssetEntry = z.infer<typeof AssetEntrySchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
