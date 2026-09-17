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
  cityId: z.string(),
  generatedAt: z.string().datetime(),
  story: StoryManifestSchema,
  assets: AssetManifestSchema,
  dev: DevContentSchema,
});

export type ContentPackage = z.infer<typeof ContentPackageSchema>;

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((id) => bSet.has(id));
}

/**
 * Referential-integrity checks that zod's shape validation can't express on
 * its own (cross-references between the three sub-manifests, and between
 * the narrative id namespace and the structural one). Returns every
 * violation found instead of throwing on the first one, since a human is
 * going to read this list to fix the source agent's output.
 */
export function checkReferentialIntegrity(pkg: ContentPackage): string[] {
  const errors: string[] = [];

  const npcsById = new Map(pkg.story.npcs.map((n) => [n.id, n]));
  const questIds = new Set(pkg.story.quests.map((q) => q.id));
  const fieldIds = new Set(pkg.story.fields.map((f) => f.id));
  const instanceIds = new Set(pkg.story.instances.map((i) => i.id));
  const assetEntityIds = new Set(pkg.assets.assets.map((a) => a.entityId));

  const fieldMonsterIds = new Set(
    pkg.story.fields.flatMap((f) => f.monsters.map((m) => m.id)),
  );
  const instanceMonsterIds = new Set(
    pkg.story.instances.flatMap((i) => i.monsters.map((m) => m.id)),
  );

  // --- Story-internal cross-references ---
  for (const quest of pkg.story.quests) {
    const giver = npcsById.get(quest.giverNpcId);
    if (!giver) {
      errors.push(`quest '${quest.id}' references unknown giverNpcId '${quest.giverNpcId}'`);
    } else if (giver.role !== "QUEST_GIVER") {
      errors.push(
        `quest '${quest.id}' is given by npc '${giver.id}', whose role is '${giver.role}', not QUEST_GIVER`,
      );
    }
  }

  for (const instance of pkg.story.instances) {
    const master = npcsById.get(instance.instanceMasterNpcId);
    if (!master) {
      errors.push(
        `instance '${instance.id}' references unknown instanceMasterNpcId '${instance.instanceMasterNpcId}'`,
      );
    } else if (master.role !== "INSTANCE_MASTER") {
      errors.push(
        `instance '${instance.id}' is mastered by npc '${master.id}', whose role is '${master.role}', not INSTANCE_MASTER`,
      );
    }
  }

  for (const portal of pkg.story.portals) {
    if (!fieldIds.has(portal.fieldId)) {
      errors.push(`portal '${portal.id}' references unknown fieldId '${portal.fieldId}'`);
    }
  }

  // --- Assets cover every npc and every monster (field + instance) ---
  for (const npc of pkg.story.npcs) {
    if (!assetEntityIds.has(npc.id)) {
      errors.push(`npc '${npc.id}' has no matching entry in assets[]`);
    }
  }
  for (const monsterId of fieldMonsterIds) {
    if (!assetEntityIds.has(monsterId)) {
      errors.push(`field monster '${monsterId}' has no matching entry in assets[]`);
    }
  }
  for (const monsterId of instanceMonsterIds) {
    if (!assetEntityIds.has(monsterId)) {
      errors.push(`instance monster '${monsterId}' has no matching entry in assets[]`);
    }
  }

  // --- Dev content covers every story entity, 1:1 ---
  const placedNpcIds = pkg.dev.npcPlacements.map((p) => p.npcId);
  if (!sameIdSet(placedNpcIds, [...npcsById.keys()])) {
    errors.push("npcPlacements must place exactly the npcs listed in story.npcs, 1:1");
  }

  const placedPortalIds = pkg.dev.portalPlacements.map((p) => p.portalId);
  if (!sameIdSet(placedPortalIds, pkg.story.portals.map((p) => p.id))) {
    errors.push("portalPlacements must place exactly the portals listed in story.portals, 1:1");
  }

  const devQuestIds = pkg.dev.questObjectives.map((q) => q.questId);
  if (!sameIdSet(devQuestIds, [...questIds])) {
    errors.push("dev.questObjectives must cover exactly the quests listed in story.quests, 1:1");
  }
  for (const objective of pkg.dev.questObjectives) {
    if (objective.objectiveType === "KILL_MONSTER" && !fieldMonsterIds.has(objective.objectiveTarget)) {
      errors.push(
        `questObjectives['${objective.questId}'] targets unknown field monster '${objective.objectiveTarget}'`,
      );
    }
    if (objective.objectiveType === "TALK_TO_NPC" && !npcsById.has(objective.objectiveTarget)) {
      errors.push(
        `questObjectives['${objective.questId}'] targets unknown npc '${objective.objectiveTarget}'`,
      );
    }
  }

  const devFieldIds = pkg.dev.fieldMaps.map((f) => f.fieldId);
  if (!sameIdSet(devFieldIds, [...fieldIds])) {
    errors.push("dev.fieldMaps must cover exactly the fields listed in story.fields, 1:1");
  }
  for (const fieldMap of pkg.dev.fieldMaps) {
    const storyField = pkg.story.fields.find((f) => f.id === fieldMap.fieldId);
    if (storyField) {
      const storyMonsterIds = storyField.monsters.map((m) => m.id);
      const devMonsterIds = fieldMap.monsterStats.map((m) => m.monsterId);
      if (!sameIdSet(devMonsterIds, storyMonsterIds)) {
        errors.push(
          `dev.fieldMaps['${fieldMap.fieldId}'].monsterStats must cover exactly the monsters story defined for that field, 1:1`,
        );
      }
    }
  }

  // --- Shop inventories: exactly the MERCHANT/BLACKSMITH npcs, 1:1 ---
  const shopNpcIds = pkg.story.npcs
    .filter((n) => n.role === "MERCHANT" || n.role === "BLACKSMITH")
    .map((n) => n.id);
  const devShopNpcIds = pkg.dev.shopInventories.map((s) => s.npcId);
  if (!sameIdSet(devShopNpcIds, shopNpcIds)) {
    errors.push(
      "dev.shopInventories must cover exactly the MERCHANT/BLACKSMITH npcs listed in story.npcs, 1:1",
    );
  }

  // --- Portal guardians: exactly the portals, 1:1 ---
  const devPortalGuardianIds = pkg.dev.portalGuardianPlacements.map((p) => p.portalId);
  if (!sameIdSet(devPortalGuardianIds, pkg.story.portals.map((p) => p.id))) {
    errors.push(
      "dev.portalGuardianPlacements must cover exactly the portals listed in story.portals, 1:1",
    );
  }

  // --- Instance companions: exactly the instances, 1:1 ---
  const devInstanceCompanionIds = pkg.dev.instanceCompanionPlacements.map((i) => i.instanceId);
  if (!sameIdSet(devInstanceCompanionIds, [...instanceIds])) {
    errors.push(
      "dev.instanceCompanionPlacements must cover exactly the instances listed in story.instances, 1:1",
    );
  }

  const devInstanceIds = pkg.dev.instances.map((i) => i.instanceId);
  if (!sameIdSet(devInstanceIds, [...instanceIds])) {
    errors.push("dev.instances must cover exactly the instances listed in story.instances, 1:1");
  }
  for (const instanceDef of pkg.dev.instances) {
    const storyInstance = pkg.story.instances.find((i) => i.id === instanceDef.instanceId);
    if (storyInstance) {
      const storyMonsterIds = storyInstance.monsters.map((m) => m.id);
      const devMonsterIds = instanceDef.monsterStats.map((m) => m.monsterId);
      if (!sameIdSet(devMonsterIds, storyMonsterIds)) {
        errors.push(
          `dev.instances['${instanceDef.instanceId}'].monsterStats must cover exactly the monsters story defined for that instance, 1:1`,
        );
      }
    }
  }

  return errors;
}
