import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GenerateShopInventorySkill,
  type GenerateShopInventoryInput,
} from "./generate-shop-inventory.skill";
import type {
  ChatCompletionClient,
  StructuredCompletionRequest,
  StructuredCompletionResult,
  UserContent,
} from "./openrouter-client";

// Same fake-client shape as run-structured-openrouter-agent.test.ts — this
// skill is a thin prompt/schema wrapper around that already-tested harness,
// so these tests only need to cover what's specific to THIS skill: the
// prompt it builds and its npcId extraValidation check.

class FakeChatCompletionClient implements ChatCompletionClient {
  calls: StructuredCompletionRequest[] = [];
  constructor(private readonly responses: Array<() => Promise<StructuredCompletionResult>>) {}

  async createStructuredCompletion(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult> {
    this.calls.push(request);
    const next = this.responses[this.calls.length - 1];
    if (!next) throw new Error("FakeChatCompletionClient ran out of scripted responses");
    return next();
  }
}

function ok(content: unknown): () => Promise<StructuredCompletionResult> {
  return async () => ({ content: JSON.stringify(content), refusal: null, finishReason: "stop" });
}

function asString(userPrompt: UserContent): string {
  assert.equal(typeof userPrompt, "string");
  return userPrompt as string;
}

const INPUT: GenerateShopInventoryInput = {
  npcId: "harbor-merchant",
  npcName: "Old Sal",
  npcRole: "MERCHANT",
  npcPersonality: "gruff but fair",
  cityName: "Saltmoor",
  atmosphereKeywords: ["salt-worn wood", "fog"],
  levelRange: { min: 15, max: 20 },
};

const VALID_INVENTORY = {
  npcId: "harbor-merchant",
  items: [
    { itemName: "Tarred Rope Coil", itemType: "MATERIAL", price: 12, description: "Salt-cured, won't rot." },
    { itemName: "Fog Lantern", itemType: "EQUIPMENT", price: 40, description: "Burns green in mist." },
    { itemName: "Salted Ration Pack", itemType: "CONSUMABLE", price: 8, description: "A week's food, dockworker style." },
    { itemName: "Barnacle Scraper", itemType: "EQUIPMENT", price: 15, description: "Every sailor owns one." },
  ],
};

test("GenerateShopInventorySkill: names itself and returns the model's inventory unchanged", async () => {
  const client = new FakeChatCompletionClient([ok(VALID_INVENTORY)]);
  const skill = new GenerateShopInventorySkill(client, "test/model");

  assert.equal(skill.name, "generate-shop-inventory");
  const result = await skill.execute(INPUT);

  assert.deepEqual(result, VALID_INVENTORY);
  assert.equal(client.calls.length, 1);
});

test("GenerateShopInventorySkill: prompt carries the npc/city context the model needs", async () => {
  const client = new FakeChatCompletionClient([ok(VALID_INVENTORY)]);
  const skill = new GenerateShopInventorySkill(client, "test/model");

  await skill.execute(INPUT);

  const prompt = asString(client.calls[0]!.userPrompt);
  assert.match(prompt, /Old Sal/);
  assert.match(prompt, /MERCHANT/);
  assert.match(prompt, /Saltmoor/);
  assert.match(prompt, /salt-worn wood, fog/);
  assert.match(prompt, /15-20/);
  assert.match(prompt, /harbor-merchant/);
});

test("GenerateShopInventorySkill: a wrong npcId self-corrects instead of silently returning it", async () => {
  const wrongId = { ...VALID_INVENTORY, npcId: "some-other-npc" };
  const client = new FakeChatCompletionClient([ok(wrongId), ok(VALID_INVENTORY)]);
  const skill = new GenerateShopInventorySkill(client, "test/model");

  const result = await skill.execute(INPUT);

  assert.deepEqual(result, VALID_INVENTORY);
  assert.equal(client.calls.length, 2);
  assert.match(asString(client.calls[1]!.userPrompt), /npcId must be exactly 'harbor-merchant'/);
});
