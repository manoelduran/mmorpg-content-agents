import type { StoryManifest } from "../domain/value-objects/story-manifest.value-object";
import type { DevContent } from "../domain/value-objects/dev-content.value-object";
import type { AssetManifest } from "../domain/value-objects/asset-manifest.value-object";
import type { ContentPackage } from "../domain/entities/content-package.entity";

/**
 * A single, fully valid City content package, built programmatically
 * (rather than hand-typed) so it stays exactly in sync with
 * city-template.value-object.ts's cardinalities as they evolve. Tests
 * mutate a deep clone of this rather than hand-rolling their own fixture —
 * see tests for the pattern.
 */
export function buildValidStory(): StoryManifest {
  const fieldNames = ["north-reach", "south-marsh", "east-cliffs", "west-woods"];
  const directions = ["NORTH", "SOUTH", "EAST", "WEST"] as const;

  const fields = fieldNames.map((fieldSlug, fi) => ({
    id: `field-${fieldSlug}`,
    name: `Field ${fi + 1}`,
    atmosphere: "windswept, quiet",
    monsters: [0, 1, 2].map((mi) => ({
      id: `field-${fieldSlug}-monster-${mi}`,
      name: `Field Monster ${fi}-${mi}`,
      flavor: "a creature native to this field",
    })),
  }));

  const portals = directions.map((direction, i) => ({
    id: `portal-${direction.toLowerCase()}`,
    name: `${direction} Gate`,
    direction,
    fieldId: fields[i]!.id,
    outboundGuardian: { name: `${direction} Outbound Guardian`, flavor: "watches the gate out" },
    returnGuide: { name: `${direction} Return Guide`, flavor: "watches the gate back" },
  }));

  const instances = [0, 1].map((ii) => ({
    id: `instance-${ii}`,
    name: `Instance ${ii}`,
    theme: "a forgotten ruin",
    instanceMasterNpcId: `instance-master-${ii}`,
    bossCompletion: {
      questGiverName: `Instance ${ii} Herald`,
      questTitle: `Defeat the Boss of Instance ${ii}`,
      questNarrative: "The herald wants proof the boss is dead.",
      lockedMessage: "The way back is sealed.",
      unlockedMessage: "The way back is open.",
    },
    monsters: [
      { id: `instance-${ii}-normal-0`, name: "Normal Foe A", flavor: "flavor", role: "NORMAL" as const },
      { id: `instance-${ii}-normal-1`, name: "Normal Foe B", flavor: "flavor", role: "NORMAL" as const },
      { id: `instance-${ii}-boss`, name: "Boss Foe", flavor: "flavor", role: "BOSS" as const },
    ],
  }));

  const npcs = [
    { id: "merchant-1", name: "Merchant", role: "MERCHANT" as const, personality: "shrewd", dialogueHooks: ["Wares?"] },
    { id: "teleporter-1", name: "Teleporter", role: "TELEPORTER" as const, personality: "calm", dialogueHooks: ["Where to?"] },
    { id: "quest-giver-1", name: "Quest Giver 1", role: "QUEST_GIVER" as const, personality: "eager", dialogueHooks: ["Help me."] },
    { id: "quest-giver-2", name: "Quest Giver 2", role: "QUEST_GIVER" as const, personality: "stern", dialogueHooks: ["Listen."] },
    { id: "quest-giver-3", name: "Quest Giver 3", role: "QUEST_GIVER" as const, personality: "kind", dialogueHooks: ["Please."] },
    { id: "blacksmith-1", name: "Blacksmith", role: "BLACKSMITH" as const, personality: "gruff", dialogueHooks: ["Refine?"] },
    { id: "instance-master-0", name: "Instance Master 0", role: "INSTANCE_MASTER" as const, personality: "wise", dialogueHooks: ["Enter?"] },
    { id: "instance-master-1", name: "Instance Master 1", role: "INSTANCE_MASTER" as const, personality: "grim", dialogueHooks: ["Beware."] },
  ];

  const questGiverIds = ["quest-giver-1", "quest-giver-2", "quest-giver-3"];
  const quests = Array.from({ length: 10 }, (_, i) => {
    const isKill = i % 2 === 0;
    return {
      id: `quest-${i}`,
      title: `Quest ${i}`,
      narrative: "narrative",
      giverNpcId: questGiverIds[i % questGiverIds.length]!,
      objectiveType: (isKill ? "KILL_MONSTER" : "TALK_TO_NPC") as "KILL_MONSTER" | "TALK_TO_NPC",
      objectiveSketch: isKill ? "defeat some monsters" : "go talk to the blacksmith",
    };
  });

  return {
    cityId: "test-city",
    cityName: "Test City",
    lore: "A city built for tests.",
    atmosphereKeywords: ["stone", "moss", "quiet"],
    levelRange: { min: 10, max: 15 },
    npcs,
    quests,
    fields,
    portals,
    instances,
  };
}

function questObjectiveTarget(
  story: StoryManifest,
  quest: StoryManifest["quests"][number],
): string {
  if (quest.objectiveType === "KILL_MONSTER") {
    return story.fields[0]!.monsters[0]!.id;
  }
  return "blacksmith-1";
}

export function buildValidDev(story: StoryManifest): DevContent {
  return {
    cityId: story.cityId,
    map: { mapId: "test-city-map", name: story.cityName, width: 50, height: 50, isCity: true },
    npcPlacements: story.npcs.map((n, i) => ({ npcId: n.id, position: { x: 10 + i, y: 10, z: 0 } })),
    portalPlacements: story.portals.map((p, i) => ({
      portalId: p.id,
      position: { x: 25, y: i % 2 === 0 ? 1 : 48, z: 0 },
    })),
    portalGuardianPlacements: story.portals.map((p, i) => ({
      portalId: p.id,
      outboundGuardianPosition: { x: 25, y: i % 2 === 0 ? 1 : 48, z: 0 },
      returnGuidePosition: { x: 25, y: i % 2 === 0 ? 48 : 1, z: 0 },
    })),
    questObjectives: story.quests.map((q) => ({
      questId: q.id,
      objectiveType: q.objectiveType,
      objectiveTarget: questObjectiveTarget(story, q),
      objectiveRequiredCount: 5,
      minLevel: story.levelRange.min,
      expReward: 100,
      goldReward: 50,
      itemRewardIds: [],
      prerequisiteQuestIds: [],
    })),
    fieldMaps: story.fields.map((f) => ({
      fieldId: f.id,
      mapId: `${f.id}-map`,
      name: f.name,
      width: 50,
      height: 50,
      monsterStats: f.monsters.map((m) => ({
        monsterId: m.id,
        level: 12,
        maxHp: 80,
        attack: 10,
        defense: 4,
        expReward: 20,
        goldReward: 5,
        respawnTimeSeconds: 30,
        spawnPositions: [{ x: 5, y: 5, z: 0 }],
        drops: [
          { itemId: "item-common-1", itemName: "Common Item 1", rarity: "COMMON" as const, dropRate: 40 },
          { itemId: "item-common-2", itemName: "Common Item 2", rarity: "COMMON" as const, dropRate: 30 },
          { itemId: "item-rare-1", itemName: "Rare Item", rarity: "RARE" as const, dropRate: 5 },
        ],
      })),
    })),
    instances: story.instances.map((inst) => ({
      instanceId: inst.id,
      mapId: `${inst.id}-map`,
      name: inst.name,
      width: 20,
      height: 20,
      monsterStats: inst.monsters.map((m) => ({
        monsterId: m.id,
        level: m.role === "BOSS" ? 18 : 13,
        maxHp: m.role === "BOSS" ? 500 : 100,
        attack: m.role === "BOSS" ? 40 : 12,
        defense: m.role === "BOSS" ? 15 : 5,
        expReward: m.role === "BOSS" ? 300 : 30,
        goldReward: m.role === "BOSS" ? 150 : 10,
        drops: [],
      })),
    })),
    instanceCompanionPlacements: story.instances.map((inst) => ({
      instanceId: inst.id,
      questGiverPosition: { x: 10, y: 10, z: 0 },
      returnPortalPosition: { x: 11, y: 10, z: 0 },
    })),
    shopInventories: story.npcs
      .filter((n) => n.role === "MERCHANT" || n.role === "BLACKSMITH")
      .map((n) => ({
        npcId: n.id,
        items: Array.from({ length: 4 }, (_, i) => ({
          itemName: `${n.name} Item ${i}`,
          itemType: "MATERIAL" as const,
          price: 10 + i,
          description: "a shop item",
        })),
      })),
  };
}

export function buildValidAssets(story: StoryManifest): AssetManifest {
  const entityIds = [
    ...story.npcs.map((n) => n.id),
    ...story.fields.flatMap((f) => f.monsters.map((m) => m.id)),
    ...story.instances.flatMap((i) => i.monsters.map((m) => m.id)),
  ];

  return {
    cityId: story.cityId,
    assets: entityIds.map((entityId) => ({
      entityId,
      relativePath: `assets/${entityId}.png`,
      source: "generated" as const,
      sourceDetail: "prompt",
      transparent: true,
    })),
  };
}

export function buildValidPackage(): ContentPackage {
  const story = buildValidStory();
  return {
    cityId: story.cityId,
    generatedAt: new Date().toISOString(),
    story,
    assets: buildValidAssets(story),
    dev: buildValidDev(story),
  };
}
