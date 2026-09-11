import { createInterface } from "node:readline/promises";
import type {
  IApprovalGate,
  ApprovalContext,
} from "../../application/ports/approval-gate.port";

/**
 * The safe-by-default approval gate: prompts a real person in the
 * terminal before any tool with a side effect runs. This is what
 * "human-in-the-loop" concretely means here — not a policy document, an
 * actual y/n prompt that blocks execution until a person answers it.
 *
 * Read-only tools are auto-approved without asking, on purpose: a tool
 * that can only READ the filesystem can't do anything a person needs to
 * review. Asking permission for every single Glob call would train the
 * user to reflexively hit "y" without reading — the opposite of safety.
 * Reserve the interruption for the tools that can actually change
 * something (Bash, Write), so when the prompt DOES appear, it means
 * something.
 */
const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep"]);

export class CliApprovalGate implements IApprovalGate {
  async approve(
    toolName: string,
    input: Record<string, unknown>,
    context: ApprovalContext,
  ): Promise<boolean> {
    if (READ_ONLY_TOOLS.has(toolName)) {
      return true;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log(`\n[${context.agentType}] wants to use tool '${toolName}':`);
      console.log(JSON.stringify(input, null, 2));
      const answer = await rl.question("Allow this? (y/N) ");
      return answer.trim().toLowerCase() === "y";
    } finally {
      rl.close();
    }
  }
}
