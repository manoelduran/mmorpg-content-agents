import type { ZodType } from "zod";
import {
  RateLimitError,
  InternalServerError,
  APIConnectionError,
  APIConnectionTimeoutError,
} from "openai";
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
import type { ChatCompletionClient } from "./openrouter-client";

export interface OpenRouterAgentConfig<T> {
  agentType: string;
  systemPrompt: string;
  model: string;
  schemaName: string;
  outputSchema: Record<string, unknown>;
  zodSchema: ZodType<T>;
  client: ChatCompletionClient;
  retryPolicy?: RetryPolicy;
}

interface AttemptInput {
  userPrompt: string;
}

/**
 * The OpenRouter-path counterpart to run-structured-agent.ts — same
 * contract (retry + self-correction + zod defense-in-depth), same error
 * taxonomy (agent-errors.ts), different transport underneath. Story and
 * Dev call this; Art still calls the Claude Agent SDK version (see
 * claude-art-agent.ts) because it genuinely needs that SDK's tool-execution
 * loop (Bash/Read/Glob/Write) — see docs/ARCHITECTURE.md for the full
 * reasoning behind this split.
 */
export async function runStructuredOpenRouterAgent<T>(
  userPrompt: string,
  config: OpenRouterAgentConfig<T>,
): Promise<T> {
  return withRetry<AttemptInput, T>(
    { userPrompt },
    (attemptInput) => runOnce(attemptInput.userPrompt, config),
    (error, attemptInput) => classify(error, attemptInput),
    config.retryPolicy ?? DEFAULT_RETRY_POLICY,
  );
}

async function runOnce<T>(
  userPrompt: string,
  config: OpenRouterAgentConfig<T>,
): Promise<T> {
  let result;
  try {
    result = await config.client.createStructuredCompletion({
      model: config.model,
      systemPrompt: config.systemPrompt,
      userPrompt,
      schemaName: config.schemaName,
      schema: config.outputSchema,
    });
  } catch (err) {
    throw classifyClientError(config.agentType, err);
  }

  // Two distinct "the model declined" signals: `refusal` is OpenAI's own
  // Structured Outputs field (not guaranteed to survive every provider
  // OpenRouter proxies to — see openrouter-client.ts); `finish_reason ===
  // "content_filter"` is the more universally-supported OpenAI-compatible
  // signal. Checking both is the honest choice given OpenRouter's own
  // docs say json_schema conformance isn't guaranteed provider-to-provider.
  if (result.refusal) {
    throw new AgentRefusalError(
      `Agent '${config.agentType}' refused: ${result.refusal}`,
      "refusal",
    );
  }
  if (result.finishReason === "content_filter") {
    throw new AgentRefusalError(
      `Agent '${config.agentType}' response was blocked by a content filter`,
      "content_filter",
    );
  }
  if (!result.content) {
    throw new TransientAgentError(
      `Agent '${config.agentType}' returned empty content (finish_reason: ${result.finishReason ?? "unknown"})`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.content);
  } catch (err) {
    // response_format constrains the model but doesn't guarantee it —
    // malformed JSON is exactly the kind of one-off slip the
    // self-correction loop below exists to fix, so it's modeled the same
    // way a zod validation failure is, not as a hard failure.
    throw new StructuredOutputValidationError(
      `Agent '${config.agentType}' returned content that wasn't valid JSON`,
      [`response body was not parseable JSON: ${(err as Error).message}`],
    );
  }

  // ── Defense in depth ──
  // response_format's json_schema is a request, not a guarantee — OpenRouter
  // itself documents that strict conformance depends on which provider
  // ultimately serves the request. This zod re-validation is the real
  // enforcement, exactly like it already is for the Claude Agent SDK path.
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
 * Only the openai package's genuinely-transient error types (rate limit,
 * 5xx, connection drop/timeout) get wrapped as TransientAgentError.
 * Everything else (bad API key, malformed request, a provider rejecting
 * the schema outright, ...) is a configuration/request problem retrying
 * won't fix — rethrown unchanged so classify()'s catch-all below fails
 * fast, rather than mislabeling "we misconfigured something" as "the model
 * refused."
 */
function classifyClientError(agentType: string, err: unknown): unknown {
  if (
    err instanceof RateLimitError ||
    err instanceof InternalServerError ||
    err instanceof APIConnectionError ||
    err instanceof APIConnectionTimeoutError
  ) {
    return new TransientAgentError(`Agent '${agentType}' call failed`, err);
  }
  return err;
}

function classify(
  error: unknown,
  attemptInput: AttemptInput,
): { retryable: boolean; nextInput: AttemptInput } {
  if (error instanceof AgentRefusalError) {
    return { retryable: false, nextInput: attemptInput };
  }

  if (error instanceof StructuredOutputValidationError) {
    const feedback = [
      "",
      "--- YOUR PREVIOUS ANSWER WAS INVALID ---",
      "Fix these specific problems and answer again with the full corrected object:",
      ...error.issues.map((issue) => `- ${issue}`),
    ].join("\n");
    return {
      retryable: true,
      nextInput: { userPrompt: attemptInput.userPrompt + feedback },
    };
  }

  if (error instanceof TransientAgentError) {
    return { retryable: true, nextInput: attemptInput };
  }

  // An error shape we don't recognize (e.g. a raw, non-transient openai
  // APIError like BadRequestError/AuthenticationError) — safer to fail
  // fast than to retry something we don't understand the cause of.
  return { retryable: false, nextInput: attemptInput };
}
