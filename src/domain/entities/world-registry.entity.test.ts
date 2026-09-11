import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_WORLD_REGISTRY,
  addEntry,
  search,
  buildWorldRegistryEntry,
  type WorldRegistry,
  type WorldRegistryEntry,
} from "./world-registry.entity";
import { buildValidStory } from "../../test-support/valid-city.fixture";

function entry(overrides: Partial<WorldRegistryEntry>): WorldRegistryEntry {
  return {
    cityId: "test-city",
    cityName: "Test City",
    brief: "a plain brief",
    lore: "some lore",
    atmosphereKeywords: [],
    npcNames: [],
    questTitles: [],
    monsterNames: [],
    ...overrides,
  };
}

test("search: retrieval is deterministic and requires no API call", () => {
  const registry: WorldRegistry = addEntry(EMPTY_WORLD_REGISTRY, entry({ cityId: "a" }));
  const first = search(registry, "a plain brief", 3);
  const second = search(registry, "a plain brief", 3);
  assert.deepEqual(first, second);
});

test("search: a query sharing zero terms with the registry retrieves nothing", () => {
  const registry: WorldRegistry = addEntry(
    EMPTY_WORLD_REGISTRY,
    entry({
      cityId: "pirate-cove",
      cityName: "Pirate Cove",
      brief: "a coastal pirate town",
      lore: "salt and rust",
    }),
  );
  // Deliberately no shared terms at all with the entry above (not even via
  // "Test City", the default cityName entry() would otherwise carry).
  const results = search(registry, "an underground dwarven mine tunnels", 3);
  assert.deepEqual(results, []);
});

test("search: ranks by term overlap and returns at most topK", () => {
  const registry = [
    entry({ cityId: "high-overlap", brief: "coastal pirate smuggler town" }),
    entry({ cityId: "low-overlap", brief: "coastal fishing village" }),
    entry({ cityId: "no-overlap", brief: "volcanic dwarven forge" }),
  ].reduce(addEntry, EMPTY_WORLD_REGISTRY);

  const results = search(registry, "a coastal pirate town", 1);

  assert.equal(results.length, 1);
  assert.equal(results[0].entry.cityId, "high-overlap");
});

test("search: ties keep insertion order (older entries first)", () => {
  const registry = [
    entry({ cityId: "first", brief: "misty forest" }),
    entry({ cityId: "second", brief: "misty forest" }),
  ].reduce(addEntry, EMPTY_WORLD_REGISTRY);

  const results = search(registry, "misty forest", 5);

  assert.equal(results[0].entry.cityId, "first");
  assert.equal(results[1].entry.cityId, "second");
});

test("buildWorldRegistryEntry: pulls names out of every part of a story manifest", () => {
  const story = buildValidStory();
  const built = buildWorldRegistryEntry(story, "a coastal pirate town");

  assert.equal(built.cityId, story.cityId);
  assert.equal(built.npcNames.length, story.npcs.length);
  assert.equal(built.questTitles.length, story.quests.length);
  const expectedMonsterCount =
    story.fields.reduce((n, f) => n + f.monsters.length, 0) +
    story.instances.reduce((n, i) => n + i.monsters.length, 0);
  assert.equal(built.monsterNames.length, expectedMonsterCount);
});
