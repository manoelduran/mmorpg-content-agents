/**
 * ── AI ENGINEERING CONCEPT: permissions and human-in-the-loop ──
 *
 * An agent with tool access (Bash, Write, ...) can take real actions on
 * your machine — run shell commands, create/overwrite files. The Claude
 * Agent SDK calls a `canUseTool` callback right before EVERY tool
 * invocation, and only proceeds if it returns "allow". That's the actual
 * control point for permissions in this system — not a suggestion in a
 * prompt, an enforced gate the SDK itself checks every single time.
 *
 * Two things make a good gate:
 *   1. Risk-proportionate: read-only tools (Read, Glob) can't damage
 *      anything, so auto-approving them is fine. Tools with side effects
 *      (Bash, Write) can — those are the ones worth a human's attention.
 *   2. Secure by default: an unattended pipeline still needs SOME gate
 *      (see AutoApproveGate) but it should be an explicit opt-in
 *      (`--yes`), never the silent default — see generate-package.cli.ts.
 *
 * This port exists so "how approval works" is swappable infrastructure
 * (a CLI prompt today, maybe a Slack approval workflow tomorrow) without
 * touching the agents that use it.
 */
export interface ApprovalContext {
  /** Which agent is asking (e.g. "art") — helps a human judge whether the
   * request makes sense for that agent's job. */
  agentType: string;
}

export interface IApprovalGate {
  /**
   * Called once per tool invocation, before the SDK lets it run.
   * Returning false blocks that specific call — the agent sees it as a
   * denied tool use and can try a different approach or give up, it does
   * NOT crash the whole run.
   */
  approve(
    toolName: string,
    input: Record<string, unknown>,
    context: ApprovalContext,
  ): Promise<boolean>;
}
