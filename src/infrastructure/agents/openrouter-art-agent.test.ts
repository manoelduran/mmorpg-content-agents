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
// — the point of these tests is the listing/thumbnailing logic this agent
// adds on top of what Dev/Story already have covered, so a real directory
// is more honest than mocking `node:fs`.

// Keyed by entityId, not by arrival order: OpenRouterArtAgent now issues
// several entities' calls concurrently (ART_CONCURRENCY), so which one
// physically reaches this fake first is a race, not something a test can
// assume. Every prompt carries its entityId in the untrustedBlock label
// (see prompt-safety.ts) — extracting it lets each entity get its own
// scripted response sequence regardless of interleaving.
function extractEntityId(userPrompt: UserContent): string {
  const text =
    typeof userPrompt === "string"
      ? userPrompt
      : (userPrompt.find((p): p is { type: "text"; text: string } => p.type === "text")?.text ?? "");
  const match = text.match(/--- UNTRUSTED NARRATIVE: (\S+) /);
  if (!match) throw new Error(`Could not find entityId in request text: ${text}`);
  return match[1]!;
}

class FakeChatCompletionClient implements ChatCompletionClient {
  calls: StructuredCompletionRequest[] = [];
  private callCounts = new Map<string, number>();
  constructor(
    private readonly responsesByEntity: Record<
      string,
      Array<() => Promise<StructuredCompletionResult>>
    >,
  ) {}

  async createStructuredCompletion(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResult> {
    this.calls.push(request);
    const entityId = extractEntityId(request.userPrompt);
    const responses = this.responsesByEntity[entityId];
    if (!responses) throw new Error(`No scripted responses for entityId '${entityId}'`);
    const count = this.callCounts.get(entityId) ?? 0;
    this.callCounts.set(entityId, count + 1);
    const next = responses[count];
    if (!next) {
      throw new Error(`FakeChatCompletionClient ran out of scripted responses for '${entityId}'`);
    }
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

async function writePng(path: string): Promise<void> {
  await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 255 } },
  })
    .png()
    .toFile(path);
}

function asParts(userPrompt: UserContent) {
  assert.ok(Array.isArray(userPrompt), "expected multimodal content parts, got a plain string");
  return userPrompt;
}

test("OpenRouterArtAgent: always writes a generation prompt, never a reused file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-test-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    await writePng(join(dir, "some-existing-sprite.png"));

    const client = new FakeChatCompletionClient({
      "monster-1": [
        ok({
          entityId: "monster-1",
          generationPrompt: "A rusted scrap-metal crawler, pixel art, transparent background.",
        }),
      ],
    });
    const agent = new OpenRouterArtAgent(client, "test/model", dir);

    const manifest = await agent.generate(minimalStory({ npcs: [] }), outputDir);

    const entry = manifest.assets[0]!;
    assert.equal(entry.entityId, "monster-1");
    assert.equal(entry.source, "generated");
    assert.equal(entry.relativePath, "assets/monsters/monster-1.png");
    assert.match(entry.sourceDetail, /rusted scrap-metal crawler/);
    // No file should ever be copied/created — a human draws it by hand.
    assert.equal(existsSync(join(outputDir, "assets/monsters/monster-1.png")), false);
    assert.equal(existsSync(join(outputDir, "assets")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: sends existing sprites as style reference images, not reuse candidates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-test-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    await writePng(join(dir, "some-sprite.png"));

    const client = new FakeChatCompletionClient({
      "npc-1": [ok({ entityId: "npc-1", generationPrompt: "An old merchant, pixel art." })],
      "monster-1": [ok({ entityId: "monster-1", generationPrompt: "A scrap crawler, pixel art." })],
    });
    const agent = new OpenRouterArtAgent(client, "test/model", dir);

    const manifest = await agent.generate(minimalStory(), outputDir);

    assert.equal(client.calls.length, 2);
    assert.equal(manifest.assets.length, 2);
    // Both entities run concurrently (ART_CONCURRENCY) and share the same
    // single reference file, so every call — regardless of which arrived
    // first — should carry it as a style reference image.
    assert.ok(client.calls.every((c) => asParts(c.userPrompt).some((p) => p.type === "image_url")));
    // Every entry is "generated" — the reference images never turn into a
    // reused file for any entity.
    assert.ok(manifest.assets.every((a) => a.source === "generated"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: self-corrects when the model returns an empty prompt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-empty-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    const client = new FakeChatCompletionClient({
      "monster-1": [
        ok({ entityId: "monster-1", generationPrompt: "" }),
        ok({ entityId: "monster-1", generationPrompt: "A rust crawler, pixel art." }),
      ],
    });
    const agent = new OpenRouterArtAgent(client, "test/model", join(dir, "does-not-exist"));

    const manifest = await agent.generate(minimalStory({ npcs: [] }), outputDir);

    assert.equal(client.calls.length, 2);
    assert.equal(manifest.assets[0]!.sourceDetail, "A rust crawler, pixel art.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: works with no reference images at all (plain text prompt)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-empty-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    const client = new FakeChatCompletionClient({
      "monster-1": [ok({ entityId: "monster-1", generationPrompt: "A rust crawler, pixel art." })],
    });
    const agent = new OpenRouterArtAgent(client, "test/model", join(dir, "does-not-exist"));

    const manifest = await agent.generate(minimalStory({ npcs: [] }), outputDir);

    assert.equal(typeof client.calls[0]!.userPrompt, "string");
    assert.equal(manifest.assets[0]!.source, "generated");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: batches entities concurrently (ART_CONCURRENCY) but still returns them in original order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-empty-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    // 5 entities, more than ART_CONCURRENCY(3) — this spans two batches.
    // Nothing in the fake makes the same-batch calls resolve in entity
    // order (createStructuredCompletion is matched by entityId, not
    // arrival order — see extractEntityId above), so a passing result here
    // is real evidence completion order doesn't leak into output order.
    const story = minimalStory({
      npcs: [
        { id: "npc-1", name: "A", role: "MERCHANT", personality: "p", dialogueHooks: ["hi"] },
        { id: "npc-2", name: "B", role: "TELEPORTER", personality: "p", dialogueHooks: ["hi"] },
      ],
      fields: [
        {
          id: "field-1",
          name: "Rustfield",
          atmosphere: "rust",
          monsters: [
            { id: "monster-1", name: "M1", flavor: "f" },
            { id: "monster-2", name: "M2", flavor: "f" },
            { id: "monster-3", name: "M3", flavor: "f" },
          ],
        },
      ],
    });
    const client = new FakeChatCompletionClient({
      "npc-1": [ok({ entityId: "npc-1", generationPrompt: "npc-1 prompt" })],
      "npc-2": [ok({ entityId: "npc-2", generationPrompt: "npc-2 prompt" })],
      "monster-1": [ok({ entityId: "monster-1", generationPrompt: "monster-1 prompt" })],
      "monster-2": [ok({ entityId: "monster-2", generationPrompt: "monster-2 prompt" })],
      "monster-3": [ok({ entityId: "monster-3", generationPrompt: "monster-3 prompt" })],
    });
    const agent = new OpenRouterArtAgent(client, "test/model", join(dir, "does-not-exist"));

    const manifest = await agent.generate(story, outputDir);

    assert.equal(client.calls.length, 5);
    assert.deepEqual(
      manifest.assets.map((a) => a.entityId),
      ["npc-1", "npc-2", "monster-1", "monster-2", "monster-3"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

const FIVE_ENTITY_STORY = minimalStory({
  npcs: [
    { id: "npc-1", name: "A", role: "MERCHANT", personality: "p", dialogueHooks: ["hi"] },
    { id: "npc-2", name: "B", role: "TELEPORTER", personality: "p", dialogueHooks: ["hi"] },
  ],
  fields: [
    {
      id: "field-1",
      name: "Rustfield",
      atmosphere: "rust",
      monsters: [
        { id: "monster-1", name: "M1", flavor: "f" },
        { id: "monster-2", name: "M2", flavor: "f" },
        { id: "monster-3", name: "M3", flavor: "f" },
      ],
    },
  ],
});

test("OpenRouterArtAgent: resume skips already-completed entities entirely, no model call for them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-resume-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    // Only the 3 monsters are scripted — if the agent re-requested either
    // already-completed npc, the fake client would throw "no scripted
    // responses" and fail this test.
    const client = new FakeChatCompletionClient({
      "monster-1": [ok({ entityId: "monster-1", generationPrompt: "monster-1 prompt" })],
      "monster-2": [ok({ entityId: "monster-2", generationPrompt: "monster-2 prompt" })],
      "monster-3": [ok({ entityId: "monster-3", generationPrompt: "monster-3 prompt" })],
    });
    const agent = new OpenRouterArtAgent(client, "test/model", join(dir, "does-not-exist"));

    const alreadyCompleted = [
      { entityId: "npc-1", relativePath: "assets/npcs/npc-1.png", source: "generated" as const, sourceDetail: "earlier prompt A", transparent: false },
      { entityId: "npc-2", relativePath: "assets/npcs/npc-2.png", source: "generated" as const, sourceDetail: "earlier prompt B", transparent: false },
    ];

    const manifest = await agent.generate(FIVE_ENTITY_STORY, outputDir, {
      alreadyCompleted,
      onBatchComplete: async () => {},
    });

    assert.equal(client.calls.length, 3);
    assert.deepEqual(
      new Set(manifest.assets.map((a) => a.entityId)),
      new Set(["npc-1", "npc-2", "monster-1", "monster-2", "monster-3"]),
    );
    // The resumed entries are passed through unchanged, not re-derived.
    const npc1 = manifest.assets.find((a) => a.entityId === "npc-1");
    assert.equal(npc1?.sourceDetail, "earlier prompt A");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("OpenRouterArtAgent: resume reports progress after every batch, so a later crash loses at most one batch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "art-agent-resume-"));
  const outputDir = mkdtempSync(join(tmpdir(), "art-agent-output-"));
  try {
    const client = new FakeChatCompletionClient({
      "npc-1": [ok({ entityId: "npc-1", generationPrompt: "p" })],
      "npc-2": [ok({ entityId: "npc-2", generationPrompt: "p" })],
      "monster-1": [ok({ entityId: "monster-1", generationPrompt: "p" })],
      "monster-2": [ok({ entityId: "monster-2", generationPrompt: "p" })],
      "monster-3": [ok({ entityId: "monster-3", generationPrompt: "p" })],
    });
    const agent = new OpenRouterArtAgent(client, "test/model", join(dir, "does-not-exist"));

    const progressSnapshots: string[][] = [];
    const manifest = await agent.generate(FIVE_ENTITY_STORY, outputDir, {
      alreadyCompleted: [],
      onBatchComplete: async (completedSoFar) => {
        progressSnapshots.push(completedSoFar.map((a) => a.entityId));
      },
    });

    // ART_CONCURRENCY is 3: 5 entities means one batch of 3, one of 2 —
    // onBatchComplete fires twice, each time with the FULL list so far,
    // not just that batch's own entries.
    assert.equal(progressSnapshots.length, 2);
    assert.equal(progressSnapshots[0]!.length, 3);
    assert.equal(progressSnapshots[1]!.length, 5);
    assert.equal(manifest.assets.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});
