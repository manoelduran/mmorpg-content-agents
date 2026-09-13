import OpenAI from "openai";

/**
 * Plain text for Story/Dev (zero tools, no reference material beyond
 * text). Art needs to actually look at existing sprites before deciding
 * whether to reuse one or write a fresh generation prompt — an array of
 * content parts (text interleaved with `image_url` data URIs) is the
 * standard OpenAI-compatible way to hand a vision-capable model both in
 * one message. This is a type-level widening only: the `openai` package's
 * own message content type already accepts either shape, so
 * `createStructuredCompletion` below needs no change to pass it through.
 */
export type UserContent = string | OpenAI.Chat.Completions.ChatCompletionContentPart[];

/**
 * ── AI ENGINEERING CONCEPT: a port around a third-party SDK ──
 *
 * A single chat-completion call is simple enough that wrapping it in an
 * interface costs almost nothing, and doing so buys something real:
 * `run-structured-openrouter-agent.ts` can be unit-tested against a fake
 * implementation of this interface instead of the real network call. This
 * is the same "port + adapter" pattern already used everywhere else in
 * application/ports — just applied to infrastructure this time, since
 * nothing in application/ orchestrates an LLM call directly.
 */
export interface StructuredCompletionRequest {
  model: string;
  systemPrompt: string;
  userPrompt: UserContent;
  /** Required by OpenAI's json_schema response format: a-z/A-Z/0-9/_/-, max 64 chars. */
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface StructuredCompletionResult {
  content: string | null;
  refusal: string | null;
  finishReason: string | null;
  /** From usage.prompt_tokens_details.cached_tokens when the provider
   * reports it — not asserted to always be present since OpenRouter
   * proxies many providers with uneven support for this field. */
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

    // Defensive: the `openai` package throws for a non-2xx HTTP response,
    // but a 200 with a body that doesn't match the expected shape (no
    // provider had an eligible route under provider.require_parameters,
    // an upstream proxy error returned as 200, ...) slips through as a
    // successful call with no `choices` — surface the raw body instead of
    // crashing on `completion.choices[0]` with no diagnostic information.
    if (!completion.choices || completion.choices.length === 0) {
      throw new Error(
        `OpenRouter returned a response with no choices for model '${request.model}': ${JSON.stringify(completion)}`,
      );
    }

    const choice = completion.choices[0];
    return {
      content: choice?.message.content ?? null,
      refusal: choice?.message.refusal ?? null,
      finishReason: choice?.finish_reason ?? null,
      cachedTokens: completion.usage?.prompt_tokens_details?.cached_tokens,
    };
  }
}
