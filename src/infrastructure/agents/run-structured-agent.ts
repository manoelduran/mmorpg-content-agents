import { query, type AgentDefinition, type ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import type { ZodType } from "zod";
import {
  withRetry,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
} from "../resilience/retry-policy";
import {
  TransientAgentError,
  AgentRefusalError,
  StructuredOutputValidationError,
} from "../../domain/errors/agent-errors";
import type { IApprovalGate } from "../../application/ports/approval-gate.port";

export interface StructuredAgentConfig<T> {
  agentType: string;
  definition: AgentDefinition;
  /** JSON Schema (from z.toJSONSchema(...)) — handed to the SDK's
   * outputFormat so the API itself constrains the model's final turn. */
  outputSchema: Record<string, unknown>;
  /** The SAME shape, as the actual zod schema — used for our own
   * re-validation (defense in depth, see AGENTS.md) AND to power the
   * self-correction retry loop below, which the SDK-level JSON Schema
   * check alone can't do (it can reject a bad answer, but it can't feed
   * the specific mistake back into the next attempt — that's ours to do). */
  zodSchema: ZodType<T>;
  /** Every tool call this agent makes is checked against this gate before
   * it's allowed to run — see approval-gate.port.ts. */
  approvalGate: IApprovalGate;
  cwd?: string;
  retryPolicy?: RetryPolicy;
}

/** The unit of work retried by withRetry — just the prompt text, since
 * that's the only thing that changes between attempts (see classify()'s
 * self-correction branch). */
interface AttemptInput {
  prompt: string;
}

/**
 * Every agent in this repo (Story, Art, Dev) follows the same shape: one
 * system-prompted persona, one user prompt, one JSON-Schema-constrained
 * result — now wrapped in retry-with-self-correction and a permission
 * gate. This is still the only place that talks to the Claude Agent SDK
 * directly; Story/Art/Dev infra classes stay thin config around it.
 */
export async function runStructuredAgent<T>(
  userPrompt: string,
  config: StructuredAgentConfig<T>,
): Promise<T> {
  return withRetry<AttemptInput, T>(
    { prompt: userPrompt },
    (attemptInput) => runOnce(attemptInput.prompt, config),
    (error, attemptInput) => classify(error, attemptInput),
    config.retryPolicy ?? DEFAULT_RETRY_POLICY,
  );
}

async function runOnce<T>(
  prompt: string,
  config: StructuredAgentConfig<T>,
): Promise<T> {
  const result = query({
    prompt,
    options: {
      agent: config.agentType,
      agents: { [config.agentType]: config.definition },
      outputFormat: { type: "json_schema", schema: config.outputSchema },
      cwd: config.cwd,
      // ── The permission gate in action ──
      // The SDK calls this before EVERY tool use, no matter how deep in
      // the agent's own tool loop it happens. Returning "deny" blocks
      // just that call — the agent sees a denial and can adapt, the whole
      // run doesn't crash. See approval-gate.port.ts for the reasoning.
      canUseTool: async (toolName, input) => {
        const allowed = await config.approvalGate.approve(toolName, input, {
          agentType: config.agentType,
        });
        return allowed
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "Denied by approval gate" };
      },
    },
  });

  let raw: unknown;
  try {
    for await (const message of result) {
      if (message.type === "result") {
        if (message.subtype !== "success") {
          throw classifyResultError(message);
        }
        if (message.structured_output === undefined) {
          throw new Error(
            `Agent '${config.agentType}' returned no structured_output — check outputFormat wiring`,
          );
        }
        raw = message.structured_output;
        logCacheUsage(config.agentType, message.modelUsage);
        break;
      }
    }
  } catch (err) {
    // Errors we already classified (refusal/transient) pass through
    // unchanged; anything else (a thrown JS exception while iterating the
    // stream — a dropped connection, an auth failure) is treated as
    // transient by default, since we can't tell it apart from a network
    // blip without more specific handling.
    if (err instanceof AgentRefusalError || err instanceof TransientAgentError) {
      throw err;
    }
    throw new TransientAgentError(`Agent '${config.agentType}' call failed`, err);
  }

  if (raw === undefined) {
    throw new TransientAgentError(
      `Agent '${config.agentType}' stream ended without a result message`,
    );
  }

  // ── Defense in depth + the input to self-correction ──
  // The SDK's outputFormat already rejected wildly malformed JSON, but
  // our zod schemas express invariants JSON Schema can't (see
  // city-template.value-object.ts's .superRefine() role-count checks).
  // safeParse (not parse) because a failure here isn't a bug to crash on
  // — it's expected input to the retry loop below.
  const parsed = config.zodSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new StructuredOutputValidationError(
      `Agent '${config.agentType}' produced output that failed validation`,
      issues,
    );
  }

  return parsed.data;
}

/**
 * ── AI ENGINEERING CONCEPT: prompt caching, honestly ──
 *
 * The SDK exposes a real cache-boundary mechanism — `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`
 * inside a `string[]` `Options.systemPrompt`, and `systemPromptSnapshot` for
 * reusing a recorded system prompt verbatim across a resumed session's later
 * turns (see sdk.d.ts). Neither applies here: both are about the MAIN
 * thread's session-level system prompt persisting across multiple resumed
 * turns of the SAME session. Every call this file makes is a one-shot
 * `query()` that delegates to a named subagent (`agent`/`agents`) and never
 * resumes — a brand new implicit session every time. There is no documented
 * SDK option to declare a cache boundary on `AgentDefinition.prompt` itself.
 *
 * What we DO control, and already do correctly: each agent's persona
 * (`config.definition.prompt`) is 100% static across every call for that
 * agent type — Story/Art/Dev's prompt constants never change per-call, only
 * the user message (built fresh each time with the specific brief/story/
 * conventions) does. A byte-identical, repeated prefix is the one
 * precondition ANY prompt cache — automatic server-side or explicit
 * cache_control — needs to ever hit. Getting that shape right is the actual
 * "best effort" here; whether the API exploits it underneath this SDK
 * surface isn't something we can force from the outside.
 *
 * Rather than assert caching is "on" with no way to check, we log the real
 * numbers the API reports back on every successful call. `modelUsage` (not
 * the top-level `usage` field — that one explicitly excludes Task-subagent
 * calls, which is what every single agent call in this project is)
 * reports `cacheReadInputTokens`/`cacheCreationInputTokens` per model.
 * cacheReadInputTokens > 0 on a later call is the real, verifiable signal
 * that caching happened — not a hope stated in a comment.
 */
function logCacheUsage(
  agentType: string,
  modelUsage: Record<string, ModelUsage>,
): void {
  for (const [model, usage] of Object.entries(modelUsage)) {
    if (usage.cacheReadInputTokens === 0 && usage.cacheCreationInputTokens === 0) {
      continue;
    }
    console.log(
      `[cache] ${agentType} (${model}): ${usage.cacheReadInputTokens} tokens read from cache, ` +
        `${usage.cacheCreationInputTokens} tokens newly written to cache`,
    );
  }
}

function classifyResultError(message: {
  subtype: string;
  errors?: string[];
}): Error {
  const detail = message.errors?.join("; ") ?? "(no details)";
  if (message.subtype === "error_max_budget_usd") {
    // Retrying without raising the budget would just hit the same wall —
    // this is the "retrying wastes money" case from agent-errors.ts.
    return new AgentRefusalError(
      `Agent hit its budget cap: ${detail}`,
      message.subtype,
    );
  }
  // error_max_turns, error_during_execution, error_max_structured_output_retries:
  // all plausibly one-off — worth a retry.
  return new TransientAgentError(
    `Agent call ended with '${message.subtype}': ${detail}`,
  );
}

function classify(
  error: unknown,
  attemptInput: AttemptInput,
): { retryable: boolean; nextInput: AttemptInput } {
  if (error instanceof AgentRefusalError) {
    return { retryable: false, nextInput: attemptInput };
  }

  if (error instanceof StructuredOutputValidationError) {
    // ── Self-correction, not blind repetition ──
    // Appending the specific validation issues to the prompt gives the
    // model something concrete to fix, instead of hoping a second
    // identical attempt happens to come out differently.
    const feedback = [
      "",
      "--- YOUR PREVIOUS ANSWER WAS INVALID ---",
      "Fix these specific problems and answer again with the full corrected object:",
      ...error.issues.map((issue) => `- ${issue}`),
    ].join("\n");
    return {
      retryable: true,
      nextInput: { prompt: attemptInput.prompt + feedback },
    };
  }

  if (error instanceof TransientAgentError) {
    return { retryable: true, nextInput: attemptInput };
  }

  // An error shape we don't recognize — safer to fail fast than to retry
  // something we don't understand the cause of.
  return { retryable: false, nextInput: attemptInput };
}
