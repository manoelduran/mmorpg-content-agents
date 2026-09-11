import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReferentialIntegrity } from "./content-package.entity";
import { buildValidPackage } from "../../test-support/valid-city.fixture";

test("checkReferentialIntegrity: a well-formed city package has no violations", () => {
  assert.deepEqual(checkReferentialIntegrity(buildValidPackage()), []);
});

test("checkReferentialIntegrity: catches a quest given by a non-QUEST_GIVER npc", () => {
  const pkg = buildValidPackage();
  pkg.story.quests[0]!.giverNpcId = "merchant-1";

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(violations.some((v) => v.includes("not QUEST_GIVER")));
});

test("checkReferentialIntegrity: catches an instance mastered by a non-INSTANCE_MASTER npc", () => {
  const pkg = buildValidPackage();
  pkg.story.instances[0]!.instanceMasterNpcId = "merchant-1";

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(violations.some((v) => v.includes("not INSTANCE_MASTER")));
});

test("checkReferentialIntegrity: catches a portal pointing at an unknown field", () => {
  const pkg = buildValidPackage();
  pkg.story.portals[0]!.fieldId = "field-that-does-not-exist";

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(violations.some((v) => v.includes("unknown fieldId 'field-that-does-not-exist'")));
});

test("checkReferentialIntegrity: catches an npc with no matching asset", () => {
  const pkg = buildValidPackage();
  pkg.assets.assets = pkg.assets.assets.filter((a) => a.entityId !== "merchant-1");

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(violations.some((v) => v.includes("npc 'merchant-1' has no matching entry")));
});

test("checkReferentialIntegrity: catches a field monster with no matching asset", () => {
  const pkg = buildValidPackage();
  const monsterId = pkg.story.fields[0]!.monsters[0]!.id;
  pkg.assets.assets = pkg.assets.assets.filter((a) => a.entityId !== monsterId);

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(violations.some((v) => v.includes(`field monster '${monsterId}' has no matching entry`)));
});

test("checkReferentialIntegrity: catches dev.fieldMaps drifting from story's monster roster", () => {
  const pkg = buildValidPackage();
  pkg.dev.fieldMaps[0]!.monsterStats = pkg.dev.fieldMaps[0]!.monsterStats.slice(0, 1);

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(violations.some((v) => v.includes("monsterStats must cover exactly the monsters story defined")));
});

test("checkReferentialIntegrity: catches an npc that was never placed on the map", () => {
  const pkg = buildValidPackage();
  pkg.dev.npcPlacements = pkg.dev.npcPlacements.slice(1);

  const violations = checkReferentialIntegrity(pkg);

  assert.ok(violations.some((v) => v.includes("npcPlacements must place exactly the npcs")));
});
