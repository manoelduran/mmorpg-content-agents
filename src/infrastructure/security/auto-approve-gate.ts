import type {
  IApprovalGate,
  ApprovalContext,
} from "../../application/ports/approval-gate.port";

/**
 * For unattended/scripted runs (CI, a scheduled job) where no person is
 * watching the terminal to answer CliApprovalGate's prompts. This is an
 * explicit opt-in — see the `--yes` flag in generate-package.cli.ts — never
 * the default, because silently approving every tool call is exactly the
 * `bypassPermissions` behavior this whole feature replaces.
 *
 * The one thing it still does: LOG every approval. Removing the human
 * from the loop doesn't have to mean removing the audit trail — if
 * something goes wrong later, this log is how you reconstruct what the
 * agent was allowed to do and when.
 */
export class AutoApproveGate implements IApprovalGate {
  async approve(
    toolName: string,
    input: Record<string, unknown>,
    context: ApprovalContext,
  ): Promise<boolean> {
    console.log(
      `[auto-approve] ${context.agentType} used '${toolName}': ${JSON.stringify(input)}`,
    );
    return true;
  }
}
