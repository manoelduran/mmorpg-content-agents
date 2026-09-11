import OpenAI from "openai";

/**
 * ── AI ENGINEERING CONCEPT: a port around a third-party SDK ──
 *
 * `run-structured-agent.ts` (the Claude Agent SDK path) talks to `query()`
 * directly, with no interface in between — the SDK's own async-generator
 * shape isn't something worth wrapping just to satisfy "always use a port."
 * Here it's different: a single chat-completion call is simple enough that
 * wrapping it costs almost nothing, and doing so buys something real —
 * `run-structured-openrouter-agent.ts` can be unit-tested against a fake
 * implementation of this interface instead of the real network call, which
 * is coverage the Claude-SDK path has never had (see its test file for why:
 * the SDK isn't easily fakeable). This is the same "port + adapter" pattern
 * already used everywhere else in application/ports — just applied to
 * infrastructure this time, since nothing in application/ orchestrates an
 * LLM call directly.
 */
export interface StructuredCompletionRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** Required by OpenAI's json_schema response format: a-z/A-Z/0-9/_/-, max 64 chars. */
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface StructuredCompletionResult {
  content: string | null;
  refusal: string | null;
  finishReason: string | null;
  /** From usage.prompt_tokens_details.cached_tokens when the provider
   * reports it — same honest, log-what's-real spirit as
   * run-structured-agent.ts's logCacheUsage(), not asserted to always be
   * present since OpenRouter proxies many providers with uneven support. */
  cachedTokens?: number;
}

export interface ChatCompletionClient {
  createStructuredCompletion(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult>;
}

/**
 * Talks to OpenRouter's OpenAI-compatible endpoint using the official
 * `openai` package pointed at OpenRouter's base URL — OpenRouter documents
 * and supports this directly, so no OpenRouter-specific SDK is needed.
 *
 * `maxRetries: 0` on the underlying client is deliberate: this project
 * already owns retry policy end-to-end via withRetry() (see
 * retry-policy.ts and run-structured-openrouter-agent.ts) — letting the
 * `openai` package ALSO retry internally would mean two uncoordinated
 * retry loops stacking delays on top of each other with neither one aware
 * of the other's attempt count.
 */
export class OpenRouterChatCompletionClient implements ChatCompletionClient {
  private readonly client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not set. Copy .env.example to .env and fill it in " +
          "(get a key at https://openrouter.ai/keys).",
      );
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      maxRetries: 0,
    });
  }

  async createStructuredCompletion(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult> {
    const completion = await this.client.chat.completions.create({
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.schemaName,
          schema: request.schema,
          strict: true,
        },
      },
      // OpenRouter-specific routing hint (not part of the OpenAI API
      // proper, passed through as an extra body field): restricts routing
      // to providers that actually support every parameter in this
      // request, notably structured JSON Schema output, instead of
      // silently falling back to a provider that ignores it. See
      // https://openrouter.ai/docs/features/provider-routing.
      // @ts-expect-error -- OpenRouter extension field, not in the openai package's types
      provider: { require_parameters: true },
    });

    const choice = completion.choices[0];
    return {
      content: choice?.message.content ?? null,
      refusal: choice?.message.refusal ?? null,
      finishReason: choice?.finish_reason ?? null,
      cachedTokens: completion.usage?.prompt_tokens_details?.cached_tokens,
    };
  }
}
