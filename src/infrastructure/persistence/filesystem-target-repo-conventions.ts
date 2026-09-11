import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ITargetRepoConventions,
  TargetRepoConventions,
} from "../../application/ports/target-repo-conventions.port";

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Reads mmorpg-backend/mmorpg-frontend's own governance docs live off disk.
 * Intentionally never copies them into this repo — see "Convenções do
 * repositório alvo" in the project plan for why.
 */
export class FilesystemTargetRepoConventions implements ITargetRepoConventions {
  async load(
    backendPath: string,
    frontendPath?: string,
  ): Promise<TargetRepoConventions> {
    const [claudeMd, agentsMd, ticketWorkflow, frontendClaudeMd] =
      await Promise.all([
        readIfExists(join(backendPath, "CLAUDE.md")),
        readIfExists(join(backendPath, "AGENTS.md")),
        readIfExists(join(backendPath, ".claude/docs/tdd-ticket-workflow.md")),
        frontendPath
          ? readIfExists(join(frontendPath, "CLAUDE.md"))
          : Promise.resolve(null),
      ]);

    const backendRules = [claudeMd, agentsMd].filter(Boolean).join("\n\n---\n\n");
    if (!backendRules) {
      throw new Error(
        `Neither CLAUDE.md nor AGENTS.md found under ${backendPath} — is --backend-path correct?`,
      );
    }

    return {
      backendRules,
      frontendRules: frontendClaudeMd,
      ticketWorkflow,
    };
  }
}
