import { readdirSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { IArtAgent, ArtGenerationResume } from "../../application/ports/art-agent.port";
import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import {
  AssetManifestSchema,
  type AssetEntry,
  type AssetManifest,
} from "../../domain/value-objects/asset-manifest.value-object";
import { runStructuredOpenRouterAgent } from "./run-structured-openrouter-agent";
import type { ChatCompletionClient, UserContent } from "./openrouter-client";
import { untrustedBlock } from "./prompt-safety";

const ART_AGENT_SYSTEM_PROMPT = `You are the Art agent for Aetherbound Online, a pixel-art top-down MMORPG.

A human draws every sprite by hand from your description — you never reuse
or copy an existing file, even if one looks close enough. Every entity
gets its own freshly written prompt, always.

You're shown a handful of existing sprites already committed to the game,
purely as a STYLE reference (line weight, shading, palette approach,
background/transparency treatment) — describe what you actually see in
them and carry that same visual style into your prompt, but never suggest
reusing one of them outright, and never mention "the images above" in your
prompt itself (the person pasting it into a generator won't have them).

Write a complete, ready-to-paste image-generation prompt for this specific
entity, grounded in its narrative, in that established style. It must
stand entirely on its own.

Respond with a single JSON object matching the given schema exactly — no
prose, no markdown fences, no commentary outside the JSON.`;

const ArtPromptSchema = z.object({
  entityId: z.string(),
  generationPrompt: z.string().describe("A ready-to-paste pixel-art generation prompt"),
});
type ArtPromptResult = z.infer<typeof ArtPromptSchema>;

interface ArtEntity {
  entityId: string;
  kind: "npc" | "monster";
  narrative: string;
}

const MAX_STYLE_REFERENCE_IMAGES = 4;
const THUMBNAIL_MAX_DIMENSION = 160;

/** How many entities' prompts are written concurrently. A full city is
 * ~26 entities (8 npcs + field/instance monsters) and each call is
 * multimodal (image thumbnails), so fully sequential was the slowest part
 * of a run by far. Kept deliberately small (not "many", per the tradeoff
 * below) — OpenRouter's free tier caps at 20 requests/min per model, and
 * a failed attempt still burns quota, so a wide burst is the wrong place
 * to spend that budget. */
const ART_CONCURRENCY = 3;

/**
 * OpenRouter counterpart to the retired ClaudeArtAgent. Claude's version
 * had real tools (Bash/Read/Glob) to search mmorpg-frontend for a reusable
 * sprite; this agent doesn't search for one at all — every entity gets a
 * freshly written prompt for a human to draw, by explicit choice (reuse
 * kept producing repeats of sprites already in the game, which isn't
 * useful when a human is drawing everything anyway). The handful of
 * existing sprites shown to the model are style reference only, never
 * reuse candidates.
 *
 * One call per entity rather than one big batched call, issued in small
 * concurrent groups (ART_CONCURRENCY) rather than one giant Promise.all:
 * each call's image payload is small and independent, so this still
 * mirrors how Story/Dev treat one call as one unit of retryable work —
 * it's just several units in flight at once now instead of one. It's
 * also resumable at batch granularity (see the `resume` param): if a run
 * dies partway through ~26 entities (a timeout, a quota error), a retry
 * only redoes whatever batch was in flight when it died, not everyone.
 */
export class OpenRouterArtAgent implements IArtAgent {
  constructor(
    private readonly client: ChatCompletionClient,
    private readonly model: string,
    /** Absolute path to mmorpg-frontend's public/images — shown to the
     * model purely as a style reference, never copied from. */
    private readonly frontendImagesDir: string,
  ) {}

  // outputDir is part of IArtAgent's contract (where a reused/copied file
  // would land) but unused here on purpose — this agent never writes a
  // file, only a prompt (see class doc comment).
  async generate(
    story: StoryManifest,
    _outputDir: string,
    resume?: ArtGenerationResume,
  ): Promise<AssetManifest> {
    const referenceFiles = this.listReferenceFiles();
    const allEntities = this.collectEntities(story);

    // Entities a prior attempt already finished are neither re-requested
    // from the model nor re-counted — a resume where everything is
    // already done costs nothing beyond this filter (the loop below
    // simply never runs).
    const alreadyDone = resume?.alreadyCompleted ?? [];
    const doneIds = new Set(alreadyDone.map((e) => e.entityId));
    const pending = allEntities.filter((e) => !doneIds.has(e.entityId));

    const entries: AssetEntry[] = [...alreadyDone];
    for (let i = 0; i < pending.length; i += ART_CONCURRENCY) {
      const batch = pending.slice(i, i + ART_CONCURRENCY);
      const batchEntries = await Promise.all(
        batch.map(async (entity) => {
          const styleRefs = this.pickStyleReferences(referenceFiles, entity);
          const result = await this.writePromptFor(story, entity, styleRefs);
          return this.toAssetEntry(entity, result);
        }),
      );
      entries.push(...batchEntries);
      // Checkpointed after every batch, not every single entity: batches
      // already serialize (the next one doesn't start until this await
      // resolves), so there's no risk of two saves racing each other —
      // see checkpoint-store.port.ts's `completedAssets` doc comment.
      await resume?.onBatchComplete(entries);
    }

    return AssetManifestSchema.parse({ cityId: story.cityId, assets: entries });
  }

  private collectEntities(story: StoryManifest): ArtEntity[] {
    const npcEntities: ArtEntity[] = story.npcs.map((n) => ({
      entityId: n.id,
      kind: "npc",
      narrative: `NPC "${n.name}" (role: ${n.role}). Personality: ${n.personality}. Typical lines: ${n.dialogueHooks.join(" / ")}.`,
    }));
    const fieldMonsterEntities: ArtEntity[] = story.fields.flatMap((f) =>
      f.monsters.map((m) => ({
        entityId: m.id,
        kind: "monster" as const,
        narrative: `Monster "${m.name}" roaming the field "${f.name}" (atmosphere: ${f.atmosphere}). Flavor: ${m.flavor}`,
      })),
    );
    const instanceMonsterEntities: ArtEntity[] = story.instances.flatMap((i) =>
      i.monsters.map((m) => ({
        entityId: m.id,
        kind: "monster" as const,
        narrative: `${m.role === "BOSS" ? "Boss monster" : "Monster"} "${m.name}" inside the instance "${i.name}" (theme: ${i.theme}). Flavor: ${m.flavor}`,
      })),
    );
    return [...npcEntities, ...fieldMonsterEntities, ...instanceMonsterEntities];
  }

  private listReferenceFiles(): string[] {
    if (!existsSync(this.frontendImagesDir)) return [];
    return readdirSync(this.frontendImagesDir)
      .filter((f) => [".png", ".jpg", ".jpeg"].includes(extname(f).toLowerCase()))
      .sort();
  }

  /**
   * Cheap keyword overlap between the entity's own words and each
   * candidate filename's words, same shortlisting heuristic as before —
   * these are style anchors now, not reuse candidates, so the model sees
   * a small, thematically-close sample rather than the entire repo.
   */
  private pickStyleReferences(files: string[], entity: ArtEntity): string[] {
    const entityWords = new Set(entity.narrative.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const scored = files
      .map((file) => {
        const words = basename(file, extname(file)).toLowerCase().split(/[-_]+/);
        const score = words.filter((w) => entityWords.has(w)).length;
        return { file, score };
      })
      .sort((a, b) => b.score - a.score);

    const picked: string[] = [];
    for (const { file, score } of scored) {
      if (picked.length >= MAX_STYLE_REFERENCE_IMAGES) break;
      if (score > 0) picked.push(file);
    }
    for (const file of files) {
      if (picked.length >= MAX_STYLE_REFERENCE_IMAGES) break;
      if (!picked.includes(file)) picked.push(file);
    }
    return picked;
  }

  private async buildStyleReferenceParts(
    files: string[],
  ): Promise<{ text: string; parts: Extract<UserContent, unknown[]> }> {
    if (files.length === 0) {
      return { text: "No existing sprites are available as a style reference.", parts: [] };
    }
    const parts: Extract<UserContent, unknown[]> = [];
    for (const file of files) {
      const dataUrl = await this.thumbnail(join(this.frontendImagesDir, file));
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    }
    return {
      text: "Style reference only (do not suggest reusing any of these):",
      parts,
    };
  }

  private async thumbnail(absolutePath: string): Promise<string> {
    const buffer = await sharp(absolutePath)
      .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, { fit: "inside" })
      .flatten({ background: "#808080" }) // reference-only: style/shape matters, not alpha
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  }

  private async writePromptFor(
    story: StoryManifest,
    entity: ArtEntity,
    styleRefs: string[],
  ): Promise<ArtPromptResult> {
    const { text: refText, parts: imageParts } = await this.buildStyleReferenceParts(styleRefs);

    const promptText = `City: ${story.cityName} — atmosphere: ${story.atmosphereKeywords.join(", ")}

${untrustedBlock("NARRATIVE", entity.entityId, entity.narrative)}

${refText}`;

    const userContent: UserContent =
      imageParts.length === 0 ? promptText : [{ type: "text", text: promptText }, ...imageParts];

    return runStructuredOpenRouterAgent<ArtPromptResult>(userContent, {
      agentType: "art",
      systemPrompt: ART_AGENT_SYSTEM_PROMPT,
      model: this.model,
      schemaName: "art_prompt",
      outputSchema: z.toJSONSchema(ArtPromptSchema) as Record<string, unknown>,
      zodSchema: ArtPromptSchema,
      client: this.client,
      extraValidation: (result) => validatePrompt(result, entity),
    });
  }

  private toAssetEntry(entity: ArtEntity, result: ArtPromptResult): AssetEntry {
    const kindFolder = entity.kind === "npc" ? "npcs" : "monsters";
    return {
      entityId: entity.entityId,
      // No file exists — a human draws this by hand from the prompt below.
      // This is where the finished sprite should land once they do.
      relativePath: `assets/${kindFolder}/${entity.entityId}.png`,
      source: "generated",
      sourceDetail: result.generationPrompt,
      transparent: false,
    };
  }
}

function validatePrompt(result: ArtPromptResult, entity: ArtEntity): string[] {
  const issues: string[] = [];
  if (result.entityId !== entity.entityId) {
    issues.push(`entityId must be exactly '${entity.entityId}', got '${result.entityId}'`);
  }
  if (!result.generationPrompt || result.generationPrompt.trim().length === 0) {
    issues.push("generationPrompt is empty");
  }
  return issues;
}
