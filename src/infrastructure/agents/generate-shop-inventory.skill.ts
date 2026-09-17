import { z } from "zod";
import type { Skill } from "../../application/ports/skill.port";
import {
  ShopInventorySchema,
  type ShopInventory,
} from "../../domain/value-objects/dev-content.value-object";
import { runStructuredOpenRouterAgent } from "./run-structured-openrouter-agent";
import type { ChatCompletionClient } from "./openrouter-client";

const SHOP_INVENTORY_SKILL_PROMPT = `You are generating a single NPC's shop inventory for
Aetherbound Online, a Ragnarok-style pixel-art MMORPG.

Given one MERCHANT or BLACKSMITH NPC and the city they live in, invent exactly 4 items for
their shop: itemName, itemType (EQUIPMENT, CONSUMABLE, or MATERIAL), a positive integer price,
and a one-line description. Every item must be newly invented for this shop — never reference
an item from a different city or assume one already exists in the live game. Fit the items to
the NPC's personality/role and the city's atmosphere; scale price to the given level range.

Respond with a single JSON object matching the given schema exactly — no prose, no markdown
fences, no commentary outside the JSON.`;

export interface GenerateShopInventoryInput {
  npcId: string;
  npcName: string;
  npcRole: "MERCHANT" | "BLACKSMITH";
  npcPersonality: string;
  cityName: string;
  atmosphereKeywords: string[];
  levelRange: { min: number; max: number };
}

/**
 * The first concrete Skill in this repo: everything shopInventories needs,
 * decomposed out of OpenRouterDevAgent's monolithic prompt into something
 * callable on its own. Reuses the exact same ShopInventorySchema the full
 * Dev pipeline already validates against, so its output slots straight
 * into an existing manifest.json's dev.shopInventories array unchanged —
 * see regenerate-shop.cli.ts for that standalone invocation.
 */
export class GenerateShopInventorySkill
  implements Skill<GenerateShopInventoryInput, ShopInventory>
{
  readonly name = "generate-shop-inventory";

  constructor(
    private readonly client: ChatCompletionClient,
    private readonly model: string,
  ) {}

  async execute(input: GenerateShopInventoryInput): Promise<ShopInventory> {
    const prompt = `NPC: ${input.npcName} (${input.npcRole}), personality: ${input.npcPersonality}
City: ${input.cityName}
Atmosphere: ${input.atmosphereKeywords.join(", ")}
Level range: ${input.levelRange.min}-${input.levelRange.max}
npcId (use exactly this value in your response): ${input.npcId}`;

    return runStructuredOpenRouterAgent<ShopInventory>(prompt, {
      agentType: this.name,
      systemPrompt: SHOP_INVENTORY_SKILL_PROMPT,
      model: this.model,
      schemaName: "shop_inventory",
      outputSchema: z.toJSONSchema(ShopInventorySchema) as Record<string, unknown>,
      zodSchema: ShopInventorySchema,
      client: this.client,
      extraValidation: (result) =>
        result.npcId === input.npcId
          ? []
          : [`npcId must be exactly '${input.npcId}', got '${result.npcId}'`],
    });
  }
}
