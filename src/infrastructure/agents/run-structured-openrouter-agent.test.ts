import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { RateLimitError, AuthenticationError } from "openai";
import { runStructuredOpenRouterAgent } from "./run-structured-openrouter-agent";
import type {
  ChatCompletionClient,
  StructuredCompletionRequest,
  StructuredCompletionResult,
  UserContent,
} from "./openrouter-client";
import type { RetryPolicy } from "../resilience/retry-policy";
import { AgentRefusalError } from "../../domain/errors/agent-errors";

// A single chat-completion call behind a small interface is easy to fake
// end-to-end, unlike a stateful SDK's own async-generator shape would be.
// See openrouter-client.ts's doc comment for why this port exists.

const TestSchema = z.object({ name: z.string(), count: z.number() });

// Every scripted request in this file is plain text (Story/Dev's shape) —
// Art's multimodal array shape is covered by openrouter-art-agent.test.ts
// instead. This narrows for the handful of assert.match calls below.
function asString(userPrompt: UserContent): string {
  assert.equal(typeof userPrompt, "string");
  return userPrompt as string;
}

const FAST_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1,
  maxDelayMs: 2,
  backoffFactor: 2,
};

class FakeChatCompletionClient implements ChatCompletionClient {
  calls: StructuredCompletionRequest[] = [];
  constructor(
    private readonly responses: Array<() => Promise<StructuredCompletionResult>>,
  ) {}

  async createStructuredCompletion(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult> {
    this.calls.push(request);
    const next = this.responses[this.calls.length - 1];
    if (!next) {
      throw new Error("FakeChatCompletionClient ran out of scripted responses");
    }
    return next();
  }
}

function ok(content: unknown): () => Promise<StructuredCompletionResult> {
  return async () => ({
    content: JSON.stringify(content),
    refusal: null,
    finishReason: "stop",
  });
}

function baseConfig(client: ChatCompletionClient) {
  return {
    agentType: "test",
    systemPrompt: "system prompt",
    model: "test/model",
    schemaName: "test_schema",
    outputSchema: z.toJSONSchema(TestSchema) as Record<string, unknown>,
    zodSchema: TestSchema,
    client,
    retryPolicy: FAST_POLICY,
  };
}

test("runStructuredOpenRouterAgent: succeeds on the first attempt", async () => {
  const client = new FakeChatCompletionClient([ok({ name: "a", count: 1 })]);
  const result = await runStructuredOpenRouterAgent("prompt", baseConfig(client));

  assert.deepEqual(result, { name: "a", count: 1 });
  assert.equal(client.calls.length, 1);
});

test("runStructuredOpenRouterAgent: retries a transient client error, then succeeds", async () => {
  const client = new FakeChatCompletionClient([
    async () => {
      throw new RateLimitError(429, {}, "rate limited", new Headers());
    },
    ok({ name: "b", count: 2 }),
  ]);

  const result = await runStructuredOpenRouterAgent("prompt", baseConfig(client));

  assert.deepEqual(result, { name: "b", count: 2 });
  assert.equal(client.calls.length, 2);
});

test("runStructuredOpenRouterAgent: a refusal fails without retrying", async () => {
  const client = new FakeChatCompletionClient([
    async () => ({ content: null, refusal: "cannot help with that", finishReason: "stop" }),
  ]);

  await assert.rejects(
    () => runStructuredOpenRouterAgent("prompt", baseConfig(client)),
    AgentRefusalError,
  );
  assert.equal(client.calls.length, 1);
});

test("runStructuredOpenRouterAgent: a non-transient API error (e.g. bad key) fails without retrying", async () => {
  const client = new FakeChatCompletionClient([
    async () => {
      throw new AuthenticationError(401, {}, "invalid API key", new Headers());
    },
  ]);

  await assert.rejects(() => runStructuredOpenRouterAgent("prompt", baseConfig(client)));
  assert.equal(client.calls.length, 1);
});

test("runStructuredOpenRouterAgent: self-corrects after invalid output, feeding issues back into the next prompt", async () => {
  const client = new FakeChatCompletionClient([
    ok({ name: "c" }), // missing `count` -> fails zod, should trigger self-correction
    ok({ name: "c", count: 3 }),
  ]);

  const result = await runStructuredOpenRouterAgent("original prompt", baseConfig(client));

  assert.deepEqual(result, { name: "c", count: 3 });
  assert.equal(client.calls.length, 2);
  assert.match(asString(client.calls[1]!.userPrompt), /YOUR PREVIOUS ANSWER WAS INVALID/);
  assert.match(asString(client.calls[1]!.userPrompt), /original prompt/);
});

test("runStructuredOpenRouterAgent: malformed JSON is treated as a self-correctable validation failure", async () => {
  const client = new FakeChatCompletionClient([
    async () => ({ content: "not actually json", refusal: null, finishReason: "stop" }),
    ok({ name: "d", count: 4 }),
  ]);

  const result = await runStructuredOpenRouterAgent("prompt", baseConfig(client));

  assert.deepEqual(result, { name: "d", count: 4 });
  assert.equal(client.calls.length, 2);
});

test("runStructuredOpenRouterAgent: extraValidation failures trigger the same self-correction as a schema failure", async () => {
  const client = new FakeChatCompletionClient([
    ok({ name: "wrong-name", count: 1 }), // passes zod, fails extraValidation below
    ok({ name: "pinned-name", count: 1 }),
  ]);

  const result = await runStructuredOpenRouterAgent("original prompt", {
    ...baseConfig(client),
    extraValidation: (data) =>
      data.name === "pinned-name" ? [] : [`name must be exactly 'pinned-name', got '${data.name}'`],
  });

  assert.deepEqual(result, { name: "pinned-name", count: 1 });
  assert.equal(client.calls.length, 2);
  assert.match(asString(client.calls[1]!.userPrompt), /YOUR PREVIOUS ANSWER WAS INVALID/);
  assert.match(asString(client.calls[1]!.userPrompt), /must be exactly 'pinned-name'/);
});
