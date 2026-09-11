import { query, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

export interface StructuredAgentConfig {
  agentType: string;
  definition: AgentDefinition;
  /** JSON Schema (from z.toJSONSchema(...)) the final result must match. */
  outputSchema: Record<string, unknown>;
  cwd?: string;
}

/**
 * Every agent in this repo (Story, Art, Dev) follows the same shape: one
 * system-prompted persona, one user prompt, one JSON-Schema-constrained
 * result. This is the only place that talks to the Claude Agent SDK
 * directly — Story/Art/Dev infra classes are thin config around this.
 *
 * `outputFormat: {type: 'json_schema', ...}` (see @anthropic-ai/claude-agent-sdk
 * sdk.d.ts) makes the SDK itself enforce the shape; we still re-validate
 * with zod one layer up in the application use-cases, so correctness never
 * depends on trusting this function alone.
 */
export async function runStructuredAgent<T>(
  userPrompt: string,
  config: StructuredAgentConfig,
): Promise<T> {
  const result = query({
    prompt: userPrompt,
    options: {
      agent: config.agentType,
      agents: { [config.agentType]: config.definition },
      outputFormat: { type: "json_schema", schema: config.outputSchema },
      cwd: config.cwd,
      permissionMode: "bypassPermissions",
    },
  });

  for await (const message of result) {
    if (message.type === "result") {
      if (message.subtype !== "success") {
        throw new Error(
          `Agent '${config.agentType}' failed: ${message.subtype}`,
        );
      }
      if (message.structured_output === undefined) {
        throw new Error(
          `Agent '${config.agentType}' returned no structured_output — check outputFormat wiring`,
        );
      }
      return message.structured_output as T;
    }
  }

  throw new Error(`Agent '${config.agentType}' stream ended without a result message`);
}
