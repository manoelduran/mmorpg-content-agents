import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenRouterStoryAgent } from "./openrouter-story-agent";
import { CONTENT_LANGUAGE_INSTRUCTION } from "./content-language";
import type {
  ChatCompletionClient,
  StructuredCompletionRequest,
  StructuredCompletionResult,
} from "./openrouter-client";
import { buildValidStory } from "../../test-support/valid-city.fixture";

// Same fake-client shape as run-structured-openrouter-agent.test.ts — the
// retry/validation harness is tested there; these tests only cover what's
// specific to Story: the system prompt it sends.

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

async function capturedSystemPrompt(): Promise<string> {
  const client = new FakeChatCompletionClient(buildValidStory());
  await new OpenRouterStoryAgent(client, "test/model").generate("a quiet test town");
  return client.calls[0]!.systemPrompt;
}

test("OpenRouterStoryAgent: system prompt carries the shared content-language instruction", async () => {
  assert.ok((await capturedSystemPrompt()).includes(CONTENT_LANGUAGE_INSTRUCTION));
});
