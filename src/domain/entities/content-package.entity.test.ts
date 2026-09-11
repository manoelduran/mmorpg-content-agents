import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReferentialIntegrity, type ContentPackage } from "./content-package.entity";

function validPackage(): ContentPackage {
  return {
    zoneId: "pirate-cove",
    generatedAt: new Date().toISOString(),
    story: {
      zoneId: "pirate-cove",
      zoneName: "Pirate Cove",
      lore: "A smugglers' harbor lost to fog.",
      atmosphereKeywords: ["salt-worn wood", "fog", "rust"],
      levelRange: { min: 15, max: 20 },
      npcs: [
        {
          id: "harbor-master",
          name: "Old Bess",
          role: "QUEST_GIVER",
          personality: "gruff, protective of the docks",
          dialogueHooks: ["Watch the tide, stranger."],
        },
      ],
      quests: [
        {
          id: "clear-the-bilge-rats",
          title: "Clear the Bilge Rats",
          narrative: "Rats have overrun the lower docks.",
          giverNpcId: "harbor-master",
          objectiveSketch: "defeat 5 bilge rats near the docks",
        },
      ],
      monsters: [
        {
          id: "bilge-rat",
          name: "Bilge Rat",
          flavor: "A rat the size of a small dog, unafraid of water.",
          threatTier: "trivial",
        },
      ],
    },
    assets: {
      zoneId: "pirate-cove",
      assets: [
        {
          entityId: "harbor-master",
          relativePath: "assets/npcs/harbor-master.png",
          source: "generated",
          sourceDetail: "prompt for a weathered dockmaster sprite",
          transparent: true,
        },
        {
          entityId: "bilge-rat",
          relativePath: "assets/monsters/bilge-rat.png",
          source: "generated",
          sourceDetail: "prompt for a rat monster sprite",
          transparent: true,
        },
      ],
    },
    dev: {
      zoneId: "pirate-cove",
      map: { mapId: "pirate-cove-map", name: "Pirate Cove", width: 50, height: 50, isCity: false },
      npcPlacements: [{ npcId: "harbor-master", position: { x: 10, y: 10, z: 0 } }],
      questObjectives: [
        {
          questId: "clear-the-bilge-rats",
          objectiveType: "KILL_MONSTER",
          objectiveTarget: "bilge-rat",
          objectiveRequiredCount: 5,
          minLevel: 15,
          expReward: 100,
          goldReward: 50,
          itemRewardIds: [],
          prerequisiteQuestIds: [],
        },
      ],
      monsterStats: [
        {
          monsterId: "bilge-rat",
          level: 15,
          maxHp: 80,
          attack: 12,
          defense: 4,
          expReward: 20,
          goldReward: 5,
          respawnTimeSeconds: 30,
          spawnPositions: [{ x: 12, y: 12, z: 0 }],
        },
      ],
    },
  };
}

test("checkReferentialIntegrity: a well-formed package has no violations", () => {
  assert.deepEqual(checkReferentialIntegrity(validPackage()), []);
});

test("checkReferentialIntegrity: catches a quest referencing an unknown NPC", () => {
  const pkg = validPackage();
  pkg.story.quests[0]!.giverNpcId = "someone-who-does-not-exist";

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(
    violations.some((v) => v.includes("unknown giverNpcId 'someone-who-does-not-exist'")),
  );
});

test("checkReferentialIntegrity: catches an NPC with no matching asset", () => {
  const pkg = validPackage();
  pkg.assets.assets = pkg.assets.assets.filter((a) => a.entityId !== "harbor-master");

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(violations.some((v) => v.includes("npc 'harbor-master' has no matching entry")));
});

test("checkReferentialIntegrity: catches an NPC that was never placed on the map", () => {
  const pkg = validPackage();
  pkg.dev.npcPlacements = [];

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(violations.some((v) => v.includes("was never placed")));
});
