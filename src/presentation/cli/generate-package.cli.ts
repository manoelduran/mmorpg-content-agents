import { resolve } from "node:path";
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

interface CliArgs {
  brief: string;
  outputRoot: string;
  backendPath: string;
  frontendPath?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const brief = get("--brief");
  if (!brief) {
    console.error(
      'Usage: npm run generate -- --brief "<zone description>" [--backend-path ../mmorpg-backend] [--frontend-path ../mmorpg-frontend] [--output output]',
    );
    process.exit(1);
  }

  return {
    brief,
    outputRoot: resolve(get("--output") ?? "output"),
    backendPath: resolve(get("--backend-path") ?? "../mmorpg-backend"),
    frontendPath: get("--frontend-path")
      ? resolve(get("--frontend-path")!)
      : resolve("../mmorpg-frontend"),
  };
}

// Manual constructor injection, no DI container — matches this project's
// "explicit code over abstractions without purpose" rule (see AGENTS.md).
// This is the only place every port gets wired to its concrete adapter.
function buildOrchestrator(): OrchestrateContentGenerationUseCase {
  return new OrchestrateContentGenerationUseCase(
    new GenerateStoryUseCase(new ClaudeStoryAgent()),
    new LoadTargetRepoConventionsUseCase(new FilesystemTargetRepoConventions()),
    new GenerateAssetsUseCase(new ClaudeArtAgent()),
    new GenerateDevContentUseCase(new ClaudeDevAgent()),
    new AssemblePackageUseCase(),
    new ValidatePackageUseCase(),
    new FileManifestWriter(),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orchestrator = buildOrchestrator();

  console.log(`Generating content package for brief: "${args.brief}"`);
  const { package: pkg, manifestPath } = await orchestrator.execute({
    brief: args.brief,
    outputRoot: args.outputRoot,
    backendPath: args.backendPath,
    frontendPath: args.frontendPath,
  });

  console.log(`\nDone: ${pkg.zoneId}`);
  console.log(`  ${pkg.story.npcs.length} npcs, ${pkg.story.quests.length} quests, ${pkg.story.monsters.length} monsters`);
  console.log(`  manifest: ${manifestPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
