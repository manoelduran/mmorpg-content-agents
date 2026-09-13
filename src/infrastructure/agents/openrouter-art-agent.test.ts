import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { OpenRouterArtAgent } from "./openrouter-art-agent";
import type {
  ChatCompletionClient,
  StructuredCompletionRequest,
  StructuredCompletionResult,
  UserContent,
} from "./openrouter-client";
import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";

// Real file I/O against a throwaway temp directory (not a fake filesystem)
// — the point of these tests is the listing/thumbnailing/copying logic
// this agent adds on top of what Dev/Story already have covered, so a real
// directory is more honest than mocking `node:fs`.

class FakeChatCompletionClient implements ChatCompletionClient {
  calls: StructuredCompletionRequest[] = [];
  constructor(private readonly responses: Array<() => Promise<StructuredCompletionResult>>) {}

  async createStructuredCompletion(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult> {
    this.calls.push(request);
    const next = this.responses[this.calls.length - 1];
    if (!next) throw new Error("FakeChatCompletionClient ran out of scripted responses");
    return next();
  }
}

function ok(content: unknown): () => Promise<StructuredCompletionResult> {
  return async () => ({ content: JSON.stringify(content), refusal: null, finishReason: "stop" });
}

function minimalStory(overrides: Partial<StoryManifest> = {}): StoryManifest {
  return {
    cityId: "test-city",
    cityName: "Test City",
    lore: "A city for testing.",
    atmosphereKeywords: ["dust", "brass", "fog"],
    levelRange: { min: 1, max: 10 },
    npcs: [
      {
        id: "npc-1",
        name: "Old Mira",
        role: "MERCHANT",
        personality: "Gruff but fair.",
        dialogueHooks: ["Buy something or move along."],
      },
    ],
    quests: [],
    fields: [
      {
        id: "field-1",
        name: "Rustfield",
        atmosphere: "rusted machinery",
        monsters: [{ id: "monster-1", name: "Rust Crawler", flavor: "A skittering pile of scrap." }],
      },
    ],
    portals: [],
    instances: [],
    ...overrides,
  } as StoryManifest;
}

async function writePng(path: string, opts: { alpha: number }): Promise<void> {
  await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: opts.alpha } },
  })
    .png()
    .toFile(path);
}

function asParts(userPrompt: UserContent) {
  assert.ok(Array.isArray(userPrompt), "expected multimodal content parts, got a plain string");
  return userPrompt;
}

test("OpenRouterArtAgent: reuses a candidate the model names, copying the real file and verifying transparency independently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-test-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    await writePng(join(dir, "transparent-slime.png"), { alpha: 0 });

    const client = new FakeChatCompletionClient([
      ok({ entityId: "monster-1", decision: "reuse", reuseFilename: "transparent-slime.png", generationPrompt: null }),
    ]);
    const agent = new OpenRouterArtAgent(client, "test/model", dir);

    const manifest = await agent.generate(
      minimalStory({ npcs: [] }),
      outputDir,
    );

    assert.equal(manifest.assets.length, 1);
    const entry = manifest.assets[0]!;
    assert.equal(entry.entityId, "monster-1");
    assert.equal(entry.source, "reused-from-repo");
    assert.equal(entry.relativePath, "assets/monsters/transparent-slime.png");
    // The model never claimed a transparent value — this proves it's the
    // agent's own pixel inspection of the copied file, not a pass-through.
    assert.equal(entry.transparent, true);
    assert.ok(existsSync(join(outputDir, "assets/monsters/transparent-slime.png")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: detects a copied file that isn't actually transparent, regardless of source claims", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-test-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    await writePng(join(dir, "opaque-slime.png"), { alpha: 255 });

    const client = new FakeChatCompletionClient([
      ok({ entityId: "monster-1", decision: "reuse", reuseFilename: "opaque-slime.png", generationPrompt: null }),
    ]);
    const agent = new OpenRouterArtAgent(client, "test/model", dir);

    const manifest = await agent.generate(minimalStory({ npcs: [] }), outputDir);

    assert.equal(manifest.assets[0]!.transparent, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: falls back to a generation prompt without creating any file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-test-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    const client = new FakeChatCompletionClient([
      ok({
        entityId: "monster-1",
        decision: "generate",
        reuseFilename: null,
        generationPrompt: "A rusted scrap-metal slime, pixel art, transparent background.",
      }),
    ]);
    const agent = new OpenRouterArtAgent(client, "test/model", dir);

    const manifest = await agent.generate(minimalStory({ npcs: [] }), outputDir);

    const entry = manifest.assets[0]!;
    assert.equal(entry.source, "generated");
    assert.equal(entry.relativePath, "assets/monsters/monster-1.png");
    assert.match(entry.sourceDetail, /rusted scrap-metal slime/);
    assert.equal(existsSync(join(outputDir, "assets/monsters/monster-1.png")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: self-corrects when the model names a file that wasn't offered as a candidate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-test-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    await writePng(join(dir, "real-candidate.png"), { alpha: 0 });

    const client = new FakeChatCompletionClient([
      ok({ entityId: "monster-1", decision: "reuse", reuseFilename: "made-up-file.png", generationPrompt: null }),
      ok({ entityId: "monster-1", decision: "reuse", reuseFilename: "real-candidate.png", generationPrompt: null }),
    ]);
    const agent = new OpenRouterArtAgent(client, "test/model", dir);

    const manifest = await agent.generate(minimalStory({ npcs: [] }), outputDir);

    assert.equal(client.calls.length, 2);
    assert.equal(manifest.assets[0]!.relativePath, "assets/monsters/real-candidate.png");
    const secondPrompt = client.calls[1]!.userPrompt;
    const text = Array.isArray(secondPrompt)
      ? secondPrompt.map((p) => ("text" in p ? p.text : "")).join("\n")
      : secondPrompt;
    assert.match(text, /was not one of the candidates shown/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: calls the client once per entity, sending image content parts when references exist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-test-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    await writePng(join(dir, "some-sprite.png"), { alpha: 0 });

    const client = new FakeChatCompletionClient([
      ok({ entityId: "npc-1", decision: "reuse", reuseFilename: "some-sprite.png", generationPrompt: null }),
      ok({ entityId: "monster-1", decision: "reuse", reuseFilename: "some-sprite.png", generationPrompt: null }),
    ]);
    const agent = new OpenRouterArtAgent(client, "test/model", dir);

    const manifest = await agent.generate(minimalStory(), outputDir);

    assert.equal(client.calls.length, 2);
    assert.equal(manifest.assets.length, 2);
    const firstParts = asParts(client.calls[0]!.userPrompt);
    assert.ok(firstParts.some((p) => p.type === "image_url"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: works with no reference images at all (plain text prompt, forced to generate)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-empty-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    const client = new FakeChatCompletionClient([
      ok({
        entityId: "monster-1",
        decision: "generate",
        reuseFilename: null,
        generationPrompt: "A rust crawler, pixel art.",
      }),
    ]);
    const agent = new OpenRouterArtAgent(client, "test/model", join(dir, "does-not-exist"));

    const manifest = await agent.generate(minimalStory({ npcs: [] }), outputDir);

    assert.equal(typeof client.calls[0]!.userPrompt, "string");
    assert.equal(manifest.assets[0]!.source, "generated");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});
