import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { OrchestrateContentGenerationUseCase } from "../../application/use-cases/orchestrate-content-generation.use-case";
import { GenerateStoryUseCase } from "../../application/use-cases/generate-story.use-case";
import { GenerateAssetsUseCase } from "../../application/use-cases/generate-assets.use-case";
import { GenerateDevContentUseCase } from "../../application/use-cases/generate-dev-content.use-case";
import { LoadTargetRepoConventionsUseCase } from "../../application/use-cases/load-target-repo-conventions.use-case";
import { AssemblePackageUseCase } from "../../application/use-cases/assemble-package.use-case";
import { ValidatePackageUseCase } from "../../application/use-cases/validate-package.use-case";
import { ClaudeStoryAgent } from "../../infrastructure/agents/claude-story-agent";
import { ClaudeArtAgent } from "../../infrastructure/agents/claude-art-agent";
import { ClaudeDevAgent } from "../../infrastructure/agents/claude-dev-agent";
import { FilesystemTargetRepoConventions } from "../../infrastructure/persistence/filesystem-target-repo-conventions";
import { FileManifestWriter } from "../../infrastructure/persistence/file-manifest-writer";
import { FileCheckpointStore } from "../../infrastructure/persistence/file-checkpoint-store";
import { CliApprovalGate } from "../../infrastructure/security/cli-approval-gate";
import { AutoApproveGate } from "../../infrastructure/security/auto-approve-gate";
import type { IApprovalGate } from "../../application/ports/approval-gate.port";
import {
  AgentRefusalError,
  TransientAgentError,
  StructuredOutputValidationError,
} from "../../domain/errors/agent-errors";
import { PackageValidationError } from "../../application/use-cases/validate-package.use-case";

interface CliArgs {
  brief: string;
  outputRoot: string;
  backendPath: string;
  frontendPath?: string;
  autoApprove: boolean;
  runId: string;
  isResumedRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const brief = get("--brief");
  if (!brief) {
    console.error(
      'Usage: npm run generate -- --brief "<city description>" [--backend-path ../mmorpg-backend] [--frontend-path ../mmorpg-frontend] [--output output] [--yes] [--run-id <id>]',
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
    outputRoot: resolve(get("--output") ?? "output"),
    backendPath: resolve(get("--backend-path") ?? "../mmorpg-backend"),
    frontendPath: get("--frontend-path")
      ? resolve(get("--frontend-path")!)
      : resolve("../mmorpg-frontend"),
    // Secure by default: a human approves every side-effecting tool call
    // unless they explicitly opt out with --yes (for CI/unattended runs).
    // See cli-approval-gate.ts / auto-approve-gate.ts.
    autoApprove: argv.includes("--yes") || argv.includes("--auto-approve"),
    runId: explicitRunId ?? randomUUID(),
    isResumedRun: explicitRunId !== undefined,
  };
}

// Manual constructor injection, no DI container — matches this project's
// "explicit code over abstractions without purpose" rule (see AGENTS.md).
// This is the only place every port gets wired to its concrete adapter.
function buildOrchestrator(
  approvalGate: IApprovalGate,
  outputRoot: string,
): OrchestrateContentGenerationUseCase {
  return new OrchestrateContentGenerationUseCase(
    new GenerateStoryUseCase(new ClaudeStoryAgent(approvalGate)),
    new LoadTargetRepoConventionsUseCase(new FilesystemTargetRepoConventions()),
    new GenerateAssetsUseCase(new ClaudeArtAgent(approvalGate)),
    new GenerateDevContentUseCase(new ClaudeDevAgent(approvalGate)),
    new AssemblePackageUseCase(),
    new ValidatePackageUseCase(),
    new FileManifestWriter(),
    new FileCheckpointStore(outputRoot),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const approvalGate: IApprovalGate = args.autoApprove
    ? new AutoApproveGate()
    : new CliApprovalGate();
  const orchestrator = buildOrchestrator(approvalGate, args.outputRoot);

  if (args.autoApprove) {
    console.log("[--yes] Running unattended — every tool call is auto-approved and logged.");
  }
  if (args.isResumedRun) {
    console.log(`Resuming run ${args.runId} — already-completed phases won't be redone.`);
  } else {
    console.log(`Run id: ${args.runId} (pass --run-id ${args.runId} to resume this run if it fails)`);
  }
  console.log(`Generating content package for brief: "${args.brief}"`);
  const { package: pkg, manifestPath } = await orchestrator.execute({
    brief: args.brief,
    outputRoot: args.outputRoot,
    backendPath: args.backendPath,
    frontendPath: args.frontendPath,
    runId: args.runId,
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
  } else if (err instanceof StructuredOutputValidationError) {
    console.error(
      `Agent output stayed invalid after retrying with corrective feedback:\n` +
        err.issues.map((i) => `  - ${i}`).join("\n"),
    );
  } else if (err instanceof PackageValidationError) {
    console.error(err.message);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
