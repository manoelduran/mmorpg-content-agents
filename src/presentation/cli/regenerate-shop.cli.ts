import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ContentPackageSchema,
  checkReferentialIntegrity,
} from "../../domain/entities/content-package.entity";
import { OpenRouterChatCompletionClient } from "../../infrastructure/agents/openrouter-client";
import { GenerateShopInventorySkill } from "../../infrastructure/agents/generate-shop-inventory.skill";
import { writeFileAtomic } from "../../infrastructure/persistence/atomic-file-writer";
import {
  AgentRefusalError,
  TransientAgentError,
  StructuredOutputValidationError,
  QuotaExceededError,
} from "../../domain/errors/agent-errors";

/**
 * The Skill abstraction's whole reason to exist: regenerate ONE npc's shop
 * inventory in an already-generated manifest.json, without rerunning
 * Story/Art/Dev for the whole city (generate-package.cli.ts). This is the
 * "Master invokes a skill on demand" capability described in
 * docs/ARCHITECTURE.md's Skills section — a separate, narrow entrypoint,
 * not a flag bolted onto the full-pipeline CLI (see AGENTS.md's "no DI
 * container, manual wiring per entrypoint" rule).
 */
interface CliArgs {
  manifestPath: string;
  npcId: string;
  model: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Copy .env.example to .env and set it — pick a\n` +
        `current model id from https://openrouter.ai/models.`,
    );
    process.exit(1);
  }
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const manifest = get("--manifest");
  const npcId = get("--npc-id");
  if (!manifest || !npcId) {
    console.error(
      "Usage: npm run regenerate:shop -- --manifest output/<cityId>/manifest.json --npc-id <merchant-or-blacksmith-npc-id>",
    );
    process.exit(1);
  }

  return {
    manifestPath: resolve(manifest),
    npcId,
    model: requireEnv("OPENROUTER_DEV_MODEL"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(await readFile(args.manifestPath, "utf-8"));
  const pkg = ContentPackageSchema.parse(raw);

  const npc = pkg.story.npcs.find((n) => n.id === args.npcId);
  if (!npc) {
    throw new Error(`No npc with id '${args.npcId}' in ${args.manifestPath}`);
  }
  if (npc.role !== "MERCHANT" && npc.role !== "BLACKSMITH") {
    throw new Error(
      `npc '${args.npcId}' has role '${npc.role}' — only MERCHANT/BLACKSMITH npcs have a shop`,
    );
  }

  const skill = new GenerateShopInventorySkill(new OpenRouterChatCompletionClient(), args.model);
  console.log(`Regenerating shop inventory for '${npc.name}' (${npc.id})...`);
  const inventory = await skill.execute({
    npcId: npc.id,
    npcName: npc.name,
    npcRole: npc.role,
    npcPersonality: npc.personality,
    cityName: pkg.story.cityName,
    atmosphereKeywords: pkg.story.atmosphereKeywords,
    levelRange: pkg.story.levelRange,
  });

  const updated = {
    ...pkg,
    dev: {
      ...pkg.dev,
      shopInventories: pkg.dev.shopInventories.map((s) => (s.npcId === npc.id ? inventory : s)),
    },
  };

  // Same referential-integrity check the full pipeline runs before ever
  // writing a manifest — a single-skill regeneration gets no less scrutiny
  // than the whole-city path does.
  const issues = checkReferentialIntegrity(updated);
  if (issues.length > 0) {
    throw new Error(`Regenerated shop broke referential integrity:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
  }

  await writeFileAtomic(args.manifestPath, JSON.stringify(updated, null, 2));

  console.log(`Done: ${npc.name}'s shop now sells:`);
  for (const item of inventory.items) {
    console.log(`  - ${item.itemName} (${item.itemType}, ${item.price}g): ${item.description}`);
  }
  console.log(`Updated: ${args.manifestPath}`);
}

main().catch((err) => {
  if (err instanceof AgentRefusalError) {
    console.error(`Agent refused (retrying won't help): ${err.message}`);
  } else if (err instanceof QuotaExceededError) {
    console.error(err.message);
  } else if (err instanceof TransientAgentError) {
    console.error(`Agent call failed after retrying (transient — safe to try again): ${err.message}`);
  } else if (err instanceof StructuredOutputValidationError) {
    console.error(
      `Agent output stayed invalid after retrying with corrective feedback:\n` +
        err.issues.map((i) => `  - ${i}`).join("\n"),
    );
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
