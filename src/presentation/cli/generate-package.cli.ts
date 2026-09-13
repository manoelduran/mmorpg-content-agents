import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { OrchestrateContentGenerationUseCase } from "../../application/use-cases/orchestrate-content-generation.use-case";
import { GenerateStoryUseCase } from "../../application/use-cases/generate-story.use-case";
import { GenerateAssetsUseCase } from "../../application/use-cases/generate-assets.use-case";
import { GenerateDevContentUseCase } from "../../application/use-cases/generate-dev-content.use-case";
import { LoadTargetRepoConventionsUseCase } from "../../application/use-cases/load-target-repo-conventions.use-case";
import { AssemblePackageUseCase } from "../../application/use-cases/assemble-package.use-case";
import { ValidatePackageUseCase } from "../../application/use-cases/validate-package.use-case";
import { ApplyContentGuardrailsUseCase, ContentGuardrailViolationError } from "../../application/use-cases/apply-content-guardrails.use-case";
import { OpenRouterStoryAgent } from "../../infrastructure/agents/openrouter-story-agent";
import { OpenRouterDevAgent } from "../../infrastructure/agents/openrouter-dev-agent";
import { OpenRouterChatCompletionClient, type ChatCompletionClient } from "../../infrastructure/agents/openrouter-client";
import { OpenRouterArtAgent } from "../../infrastructure/agents/openrouter-art-agent";
import { FilesystemTargetRepoConventions } from "../../infrastructure/persistence/filesystem-target-repo-conventions";
import { FileManifestWriter } from "../../infrastructure/persistence/file-manifest-writer";
import { FileCheckpointStore } from "../../infrastructure/persistence/file-checkpoint-store";
import { FileWorldRegistryRepository } from "../../infrastructure/persistence/file-world-registry-repository";
import { FilesystemExistingCityContextProvider } from "../../infrastructure/persistence/filesystem-existing-city-context-provider";
import { LoadExistingCityContextUseCase } from "../../application/use-cases/load-existing-city-context.use-case";
import { RetrieveWorldContextUseCase } from "../../application/use-cases/retrieve-world-context.use-case";
import {
  AgentRefusalError,
  TransientAgentError,
  StructuredOutputValidationError,
} from "../../domain/errors/agent-errors";
import { PackageValidationError } from "../../application/use-cases/validate-package.use-case";

interface CliArgs {
  brief: string;
  storyModel: string;
  devModel: string;
  artModel: string;
  outputRoot: string;
  backendPath: string;
  frontendPath: string;
  runId: string;
  isResumedRun: boolean;
  existingCityContextPath?: string;
}

/**
 * No default model id is hardcoded here on purpose: OpenRouter's free/cheap
 * lineup changes often enough that a value baked into this file today could
 * be gone or repriced by the time it's read. Failing fast with a pointer to
 * the live catalog is more honest than shipping a model id that might not
 * exist anymore.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Copy .env.example to .env and set it — pick a\n` +
        `current model id from https://openrouter.ai/models (the free/cheap\n` +
        `lineup rotates, so no default is baked into this code).`,
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

  const brief = get("--brief");
  if (!brief) {
    console.error(
      'Usage: npm run generate -- --brief "<city description>" [--backend-path ../mmorpg-backend] [--frontend-path ../mmorpg-frontend] [--output output] [--yes] [--run-id <id>] [--existing-city <path>]',
    );
    process.exit(1);
  }

  // --run-id is the idempotency key (see checkpoint-store.port.ts): pass
  // one back in to resume a failed run instead of redoing finished
  // phases. Left unset, we mint a fresh one and print it, since there's
  // nothing to resume on a brand-new run.
  const explicitRunId = get("--run-id");

  return {
    brief,
    storyModel: requireEnv("OPENROUTER_STORY_MODEL"),
    devModel: requireEnv("OPENROUTER_DEV_MODEL"),
    artModel: requireEnv("OPENROUTER_ART_MODEL"),
    outputRoot: resolve(get("--output") ?? "output"),
    backendPath: resolve(get("--backend-path") ?? "../mmorpg-backend"),
    frontendPath: get("--frontend-path")
      ? resolve(get("--frontend-path")!)
      : resolve("../mmorpg-frontend"),
    runId: explicitRunId ?? randomUUID(),
    isResumedRun: explicitRunId !== undefined,
    // A city that already partially exists — see
    // existing-city-context.value-object.ts and existing-cities/aethelgard.json
    // for a real example. Left resolved relative to cwd (not backendPath),
    // since this file lives in this repo, not the target one.
    existingCityContextPath: get("--existing-city")
      ? resolve(get("--existing-city")!)
      : undefined,
  };
}

// Manual constructor injection, no DI container — matches this project's
// "explicit code over abstractions without purpose" rule (see AGENTS.md).
// This is the only place every port gets wired to its concrete adapter.
function buildOrchestrator(
  outputRoot: string,
  frontendPath: string,
  openRouterClient: ChatCompletionClient,
  storyModel: string,
  devModel: string,
  artModel: string,
): OrchestrateContentGenerationUseCase {
  const worldRegistryRepository = new FileWorldRegistryRepository(outputRoot);
  return new OrchestrateContentGenerationUseCase(
    new GenerateStoryUseCase(new OpenRouterStoryAgent(openRouterClient, storyModel)),
    new LoadTargetRepoConventionsUseCase(new FilesystemTargetRepoConventions()),
    // Art now calls OpenRouter too, same as Story/Dev — the file-system
    // search that used to require the Claude Agent SDK's tool-execution
    // loop moved into this agent's own deterministic code (listing
    // mmorpg-frontend's sprites, copying the winner); the model's job
    // shrank to the genuinely creative part: looking at a few candidate
    // images and deciding reuse-vs-generate. See docs/ARCHITECTURE.md.
    new GenerateAssetsUseCase(
      new OpenRouterArtAgent(openRouterClient, artModel, join(frontendPath, "public/images")),
    ),
    new GenerateDevContentUseCase(new OpenRouterDevAgent(openRouterClient, devModel)),
    new AssemblePackageUseCase(),
    new ValidatePackageUseCase(),
    new FileManifestWriter(),
    new FileCheckpointStore(outputRoot),
    new RetrieveWorldContextUseCase(worldRegistryRepository),
    worldRegistryRepository,
    new ApplyContentGuardrailsUseCase(),
    new LoadExistingCityContextUseCase(new FilesystemExistingCityContextProvider()),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const openRouterClient = new OpenRouterChatCompletionClient();
  const orchestrator = buildOrchestrator(
    args.outputRoot,
    args.frontendPath,
    openRouterClient,
    args.storyModel,
    args.devModel,
    args.artModel,
  );

  if (args.isResumedRun) {
    console.log(`Resuming run ${args.runId} — already-completed phases won't be redone.`);
  } else {
    console.log(`Run id: ${args.runId} (pass --run-id ${args.runId} to resume this run if it fails)`);
  }
  if (args.existingCityContextPath) {
    console.log(`Extending existing city from: ${args.existingCityContextPath}`);
  }
  console.log(`Generating content package for brief: "${args.brief}"`);
  const { package: pkg, manifestPath } = await orchestrator.execute({
    brief: args.brief,
    outputRoot: args.outputRoot,
    backendPath: args.backendPath,
    frontendPath: args.frontendPath,
    runId: args.runId,
    existingCityContextPath: args.existingCityContextPath,
  });

  const fieldMonsterCount = pkg.story.fields.reduce((n, f) => n + f.monsters.length, 0);
  const instanceMonsterCount = pkg.story.instances.reduce((n, i) => n + i.monsters.length, 0);

  console.log(`\nDone: ${pkg.cityId}`);
  console.log(
    `  ${pkg.story.npcs.length} npcs, ${pkg.story.quests.length} quests, ` +
      `${pkg.story.portals.length} portals -> ${pkg.story.fields.length} fields (${fieldMonsterCount} monsters), ` +
      `${pkg.story.instances.length} instances (${instanceMonsterCount} monsters)`,
  );
  console.log(`  manifest: ${manifestPath}`);
}

// Categorized error output instead of a raw stack trace: which error
// class it is (see domain/errors/agent-errors.ts) tells the person
// running this exactly what kind of problem they're looking at and
// whether trying again is worth it.
main().catch((err) => {
  if (err instanceof AgentRefusalError) {
    console.error(`Agent refused (retrying won't help): ${err.message}`);
  } else if (err instanceof TransientAgentError) {
    console.error(
      `Agent call failed after retrying (transient — safe to try again): ${err.message}`,
    );
    // The generic catch-all in run-structured-agent.ts/run-structured-
    // openrouter-agent.ts wraps an unrecognized exception with a short
    // fixed message and keeps the real error as .cause — without printing
    // it, every unclassified failure looks identical and undebuggable.
    if (err.cause) {
      console.error(`  cause: ${err.cause instanceof Error ? err.cause.message : err.cause}`);
    }
  } else if (err instanceof StructuredOutputValidationError) {
    console.error(
      `Agent output stayed invalid after retrying with corrective feedback:\n` +
        err.issues.map((i) => `  - ${i}`).join("\n"),
    );
  } else if (err instanceof PackageValidationError) {
    console.error(err.message);
  } else if (err instanceof ContentGuardrailViolationError) {
    console.error(err.message);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
