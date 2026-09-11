import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkExistingNpcsPreserved,
  checkExistingMapAndPlacementsPreserved,
  type ExistingCityContext,
} from "./existing-city-context.value-object";
import { buildValidStory, buildValidDev } from "../../test-support/valid-city.fixture";

const EXISTING: ExistingCityContext = {
  cityId: "test-city",
  cityName: "Test City",
  map: { mapId: "aethelgard-map", name: "Aethelgard", width: 50, height: 50, isCity: true },
  existingNpcs: [
    { id: "merchant-1", name: "Merchant", role: "MERCHANT", position: { x: 20, y: 20, z: 0 } },
  ],
};

test("checkExistingNpcsPreserved: passes when the pinned npc appears unchanged", () => {
  const story = buildValidStory();
  // buildValidStory()'s cityId/cityName are "test-city"/"Test City" already
  // (see valid-city.fixture.ts), matching EXISTING above.
  assert.deepEqual(checkExistingNpcsPreserved(story, EXISTING), []);
});

test("checkExistingNpcsPreserved: catches a dropped pinned npc", () => {
  const story = buildValidStory();
  story.npcs = story.npcs.filter((npc) => npc.id !== "merchant-1");
  const violations = checkExistingNpcsPreserved(story, EXISTING);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /missing the existing npc 'merchant-1'/);
});

test("checkExistingNpcsPreserved: catches a renamed pinned npc", () => {
  const story = buildValidStory();
  story.npcs = story.npcs.map((npc) =>
    npc.id === "merchant-1" ? { ...npc, name: "Renamed Merchant" } : npc,
  );
  const violations = checkExistingNpcsPreserved(story, EXISTING);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /must keep its existing name 'Merchant'/);
});

test("checkExistingNpcsPreserved: catches a role change on a pinned npc", () => {
  const story = buildValidStory();
  story.npcs = story.npcs.map((npc) =>
    npc.id === "merchant-1" ? { ...npc, role: "BLACKSMITH" as const } : npc,
  );
  const violations = checkExistingNpcsPreserved(story, EXISTING);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /must keep its existing role 'MERCHANT'/);
});

test("checkExistingNpcsPreserved: catches cityId/cityName drift", () => {
  const story = buildValidStory();
  story.cityId = "some-other-city";
  const violations = checkExistingNpcsPreserved(story, EXISTING);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /story.cityId must be exactly 'test-city'/);
});

test("checkExistingMapAndPlacementsPreserved: passes when map + pinned position are unchanged", () => {
  const story = buildValidStory();
  const dev = buildValidDev(story);
  dev.map = { ...EXISTING.map };
  dev.npcPlacements = dev.npcPlacements.map((p) =>
    p.npcId === "merchant-1" ? { ...p, position: { x: 20, y: 20, z: 0 } } : p,
  );
  assert.deepEqual(checkExistingMapAndPlacementsPreserved(dev, EXISTING), []);
});

test("checkExistingMapAndPlacementsPreserved: catches a map that doesn't match the existing one", () => {
  const story = buildValidStory();
  const dev = buildValidDev(story);
  dev.map = { mapId: "a-brand-new-map", name: "New", width: 60, height: 60, isCity: true };
  const violations = checkExistingMapAndPlacementsPreserved(dev, EXISTING);
  assert.ok(violations.some((v) => v.includes("map.mapId must be exactly 'aethelgard-map'")));
  assert.ok(violations.some((v) => v.includes("dimensions must exactly match")));
});

test("checkExistingMapAndPlacementsPreserved: catches a pinned npc placed at the wrong position", () => {
  const story = buildValidStory();
  const dev = buildValidDev(story);
  dev.map = { ...EXISTING.map };
  dev.npcPlacements = dev.npcPlacements.map((p) =>
    p.npcId === "merchant-1" ? { ...p, position: { x: 0, y: 0, z: 0 } } : p,
  );
  const violations = checkExistingMapAndPlacementsPreserved(dev, EXISTING);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /already stands at \(20,20,0\)/);
});
