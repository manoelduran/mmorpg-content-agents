import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenRouterDevAgent } from "./openrouter-dev-agent";
import { CONTENT_LANGUAGE_INSTRUCTION } from "./content-language";
import type {
  ChatCompletionClient,
  StructuredCompletionRequest,
  StructuredCompletionResult,
} from "./openrouter-client";
import { buildValidStory, buildValidDev } from "../../test-support/valid-city.fixture";

// Same fake-client shape as run-structured-openrouter-agent.test.ts — these
// tests only cover what's specific to Dev: the system prompt it sends.

class FakeChatCompletionClient implements ChatCompletionClient {
  calls: StructuredCompletionRequest[] = [];
  constructor(private readonly content: unknown) {}

  async createStructuredCompletion(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult> {
    this.calls.push(request);
    return { content: JSON.stringify(this.content), refusal: null, finishReason: "stop" };
  }
}

test("OpenRouterDevAgent: system prompt carries the shared content-language instruction", async () => {
  const story = buildValidStory();
  const client = new FakeChatCompletionClient(buildValidDev(story));

  await new OpenRouterDevAgent(client, "test/model").generate(story, {
    backendRules: "backend rules",
    frontendRules: null,
    ticketWorkflow: null,
  });

  assert.ok(client.calls[0]!.systemPrompt.includes(CONTENT_LANGUAGE_INSTRUCTION));
});
