/**
 * The conventions living in the game repos themselves (mmorpg-backend's
 * CLAUDE.md/AGENTS.md/tdd-ticket-workflow.md, and whatever equivalent
 * exists in mmorpg-frontend). Loaded live from disk every run — never
 * copied into this repo, so it can never drift from the real rules. See
 * the "Convenções do repositório alvo" section of the project plan for why.
 */
export interface TargetRepoConventions {
  backendRules: string;
  frontendRules: string | null;
  ticketWorkflow: string | null;
}

export interface ITargetRepoConventions {
  load(backendPath: string, frontendPath?: string): Promise<TargetRepoConventions>;
}
