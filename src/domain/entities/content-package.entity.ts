import { z } from "zod";
import { StoryManifestSchema } from "../value-objects/story-manifest.value-object";
import { AssetManifestSchema } from "../value-objects/asset-manifest.value-object";
import { DevContentSchema } from "../value-objects/dev-content.value-object";

/**
 * The Master's final output: Story + Art + Dev merged into one
 * self-contained, installable unit. This is the actual contract between
 * this repo and the game — see schemas/content-package.schema.json (the
 * generated JSON Schema form of this same zod schema, kept in sync by
 * `npm run build:schema`).
 */
export const ContentPackageSchema = z.object({
  zoneId: z.string(),
  generatedAt: z.string().datetime(),
  story: StoryManifestSchema,
  assets: AssetManifestSchema,
  dev: DevContentSchema,
});

export type ContentPackage = z.infer<typeof ContentPackageSchema>;

/**
 * Referential-integrity checks that zod's shape validation can't express on
 * its own (cross-references between the three sub-manifests). Returns every
 * violation found instead of throwing on the first one, since a human is
 * going to read this list to fix the source agent's output.
 */
export function checkReferentialIntegrity(pkg: ContentPackage): string[] {
  const errors: string[] = [];

  const npcIds = new Set(pkg.story.npcs.map((n) => n.id));
  const monsterIds = new Set(pkg.story.monsters.map((m) => m.id));
  const questIds = new Set(pkg.story.quests.map((q) => q.id));
  const assetEntityIds = new Set(pkg.assets.assets.map((a) => a.entityId));

  for (const quest of pkg.story.quests) {
    if (!npcIds.has(quest.giverNpcId)) {
      errors.push(
        `quest '${quest.id}' references unknown giverNpcId '${quest.giverNpcId}'`,
      );
    }
  }

  for (const npc of pkg.story.npcs) {
    if (!assetEntityIds.has(npc.id)) {
      errors.push(`npc '${npc.id}' has no matching entry in assets[]`);
    }
  }
  for (const monster of pkg.story.monsters) {
    if (!assetEntityIds.has(monster.id)) {
      errors.push(`monster '${monster.id}' has no matching entry in assets[]`);
    }
  }

  for (const placement of pkg.dev.npcPlacements) {
    if (!npcIds.has(placement.npcId)) {
      errors.push(
        `npcPlacements references unknown npcId '${placement.npcId}'`,
      );
    }
  }
  for (const objective of pkg.dev.questObjectives) {
    if (!questIds.has(objective.questId)) {
      errors.push(
        `questObjectives references unknown questId '${objective.questId}'`,
      );
    }
  }
  for (const stats of pkg.dev.monsterStats) {
    if (!monsterIds.has(stats.monsterId)) {
      errors.push(
        `monsterStats references unknown monsterId '${stats.monsterId}'`,
      );
    }
  }

  const placedNpcIds = new Set(pkg.dev.npcPlacements.map((p) => p.npcId));
  for (const npc of pkg.story.npcs) {
    if (!placedNpcIds.has(npc.id)) {
      errors.push(`npc '${npc.id}' was never placed (missing from npcPlacements)`);
    }
  }

  return errors;
}
