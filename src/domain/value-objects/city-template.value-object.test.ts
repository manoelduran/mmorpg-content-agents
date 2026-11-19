import { test } from "node:test";
import assert from "node:assert/strict";
import { CityQuestSchema } from "./city-template.value-object";
import { StoryManifestSchema } from "./story-manifest.value-object";
import { buildValidStory } from "../../test-support/valid-city.fixture";

const TALK_QUEST = {
  id: "quest-talk",
  title: "Ecos do Porto",
  narrative: "O velho capitão quer que você ouça a história do naufrágio.",
  giverNpcId: "quest-giver-1",
  objectiveType: "TALK_TO_NPC" as const,
  objectiveSketch: "Fale com o ferreiro sobre o naufrágio do Albatroz.",
  loreReveal:
    "O Albatroz afundou na Baía Cinzenta há trinta invernos. Foi o ferro dele que forjou o primeiro portão da cidade.",
};

const KILL_QUEST = {
  id: "quest-kill",
  title: "Ratos do Cais",
  narrative: "Os ratos estão roendo os cabos do cais.",
  giverNpcId: "quest-giver-1",
  objectiveType: "KILL_MONSTER" as const,
  objectiveSketch: "defeat 5 bilge rats",
};

function issueMessages(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  return result.error?.issues.map((i) => i.message) ?? [];
}

test("CityQuestSchema: TALK_TO_NPC quest with a loreReveal passes", () => {
  assert.equal(CityQuestSchema.safeParse(TALK_QUEST).success, true);
});

test("CityQuestSchema: TALK_TO_NPC quest without a loreReveal fails, naming the quest", () => {
  const { loreReveal: _, ...withoutReveal } = TALK_QUEST;
  const result = CityQuestSchema.safeParse(withoutReveal);
  assert.equal(result.success, false);
  assert.ok(issueMessages(result).some((m) => m.includes("quest-talk") && m.includes("loreReveal")));
});

test("CityQuestSchema: TALK_TO_NPC quest with a blank loreReveal fails", () => {
  const result = CityQuestSchema.safeParse({ ...TALK_QUEST, loreReveal: "   " });
  assert.equal(result.success, false);
  assert.ok(issueMessages(result).some((m) => m.includes("quest-talk")));
});

test("CityQuestSchema: KILL_MONSTER quest without a loreReveal passes", () => {
  assert.equal(CityQuestSchema.safeParse(KILL_QUEST).success, true);
});

test("CityQuestSchema: KILL_MONSTER quest with a loreReveal fails, naming the quest", () => {
  const result = CityQuestSchema.safeParse({ ...KILL_QUEST, loreReveal: "Algo que ninguém pediu." });
  assert.equal(result.success, false);
  assert.ok(issueMessages(result).some((m) => m.includes("quest-kill") && m.includes("loreReveal")));
});

test("StoryManifestSchema: the fixture city (both quest types) still parses", () => {
  assert.equal(StoryManifestSchema.safeParse(buildValidStory()).success, true);
});
