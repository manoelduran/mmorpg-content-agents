import { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { IArtAgent } from "../../application/ports/art-agent.port";
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

You cannot generate raster images yourself. For every entity you're asked
about, you're shown a handful of existing sprites already committed to the
game (as images, numbered, with their real filenames) alongside that
entity's narrative. Decide ONE of two things:

1. "reuse" — one of the shown candidates already fits this entity well
   enough to stand in for it (a generic monster/NPC silhouette that suits
   the flavor, not necessarily a perfect thematic match). Set
   reuseFilename to that candidate's EXACT filename as given — never a
   filename you weren't shown, never a modified or invented one.
2. "generate" — nothing shown fits. Write a complete, ready-to-paste
   image-generation prompt in generationPrompt, in the SAME pixel-art
   style as the reference images you were shown (describe what you
   actually see in them: line weight, shading style, palette approach,
   background/transparency treatment) applied to this entity's own
   narrative. Someone will paste this directly into an image generator, so
   it must stand alone with no reference to "the images above."

Respond with a single JSON object matching the given schema exactly — no
prose, no markdown fences, no commentary outside the JSON.`;

const ArtDecisionSchema = z.object({
  entityId: z.string(),
  decision: z.enum(["reuse", "generate"]),
  reuseFilename: z
    .string()
    .nullable()
    .describe(
      "Exact filename from the numbered candidate list, required when decision is 'reuse'; null otherwise",
    ),
  generationPrompt: z
    .string()
    .nullable()
    .describe(
      "A ready-to-paste pixel-art generation prompt, required when decision is 'generate'; null otherwise",
    ),
});
type ArtDecision = z.infer<typeof ArtDecisionSchema>;

interface ArtEntity {
  entityId: string;
  kind: "npc" | "monster";
  narrative: string;
}

const MAX_REFERENCE_IMAGES = 6;
const THUMBNAIL_MAX_DIMENSION = 160;

/**
 * OpenRouter counterpart to the retired ClaudeArtAgent. Claude's version
 * had real tools (Bash/Read/Glob) to search mmorpg-frontend for a reusable
 * sprite; a plain chat-completion model has none of that, so the search
 * itself moves into this deterministic TypeScript (listing files, picking
 * candidates, copying the winner) — the model's only job is the genuinely
 * creative part: looking at a handful of candidate images plus the
 * entity's narrative and deciding reuse-vs-generate, exactly the kind of
 * judgment call this project already keeps behind an LLM boundary while
 * everything mechanical stays in code (see docs/ARCHITECTURE.md's "Why a
 * Master that isn't itself an LLM call").
 *
 * One call per entity rather than one big batched call: each call's image
 * payload is small and independent, so a single entity's transient
 * failure or self-correction retry doesn't touch the other ~25 in the
 * same city, and it mirrors how Story/Dev already treat one call as one
 * unit of retryable work.
 */
export class OpenRouterArtAgent implements IArtAgent {
  constructor(
    private readonly client: ChatCompletionClient,
    private readonly model: string,
    /** Absolute path to mmorpg-frontend's public/images — the "images we
     * already have" this agent looks at, both for reuse candidates and as
     * a style reference when nothing fits. */
    private readonly frontendImagesDir: string,
  ) {}

  async generate(story: StoryManifest, outputDir: string): Promise<AssetManifest> {
    const referenceFiles = this.listReferenceFiles();
    const entities = this.collectEntities(story);

    const entries: AssetEntry[] = [];
    for (const entity of entities) {
      const candidates = this.pickReferenceCandidates(referenceFiles, entity);
      const decision = await this.decideOne(story, entity, candidates);
      entries.push(await this.materialize(entity, decision, candidates, outputDir));
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
   * Cheap keyword overlap between the entity's own words (name split on
   * non-alphanumerics) and each candidate filename's words — no embeddings,
   * no extra model call just to shortlist. Ties/no-matches fall back to the
   * first files alphabetically, so every entity still gets *some* visual
   * style reference even when nothing looks like a thematic match.
   */
  private pickReferenceCandidates(files: string[], entity: ArtEntity): string[] {
    const entityWords = new Set(
      entity.narrative.toLowerCase().match(/[a-z0-9]+/g) ?? [],
    );
    const scored = files
      .map((file) => {
        const words = basename(file, extname(file)).toLowerCase().split(/[-_]+/);
        const score = words.filter((w) => entityWords.has(w)).length;
        return { file, score };
      })
      .sort((a, b) => b.score - a.score);

    const picked: string[] = [];
    for (const { file, score } of scored) {
      if (picked.length >= MAX_REFERENCE_IMAGES) break;
      if (score > 0) picked.push(file);
    }
    for (const file of files) {
      if (picked.length >= MAX_REFERENCE_IMAGES) break;
      if (!picked.includes(file)) picked.push(file);
    }
    return picked;
  }

  private async buildImageContentParts(
    candidates: string[],
  ): Promise<{ text: string; parts: Extract<UserContent, unknown[]> }> {
    if (candidates.length === 0) {
      return {
        text: "No existing sprites are available to reference — you must choose 'generate'.",
        parts: [],
      };
    }

    const parts: Extract<UserContent, unknown[]> = [];
    const lines: string[] = ["Candidate existing sprites (numbered, matching the images below in order):"];
    for (const [index, file] of candidates.entries()) {
      lines.push(`${index + 1}. ${file}`);
      const dataUrl = await this.thumbnail(join(this.frontendImagesDir, file));
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    }
    return { text: lines.join("\n"), parts };
  }

  private async thumbnail(absolutePath: string): Promise<string> {
    const buffer = await sharp(absolutePath)
      .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, { fit: "inside" })
      .flatten({ background: "#808080" }) // reference-only: style/shape matters, not alpha
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  }

  private async decideOne(
    story: StoryManifest,
    entity: ArtEntity,
    candidates: string[],
  ): Promise<ArtDecision> {
    const { text: candidateList, parts: imageParts } = await this.buildImageContentParts(candidates);

    const promptText = `City: ${story.cityName} — atmosphere: ${story.atmosphereKeywords.join(", ")}

${untrustedBlock("NARRATIVE", entity.entityId, entity.narrative)}

${candidateList}`;

    const userContent: UserContent =
      imageParts.length === 0 ? promptText : [{ type: "text", text: promptText }, ...imageParts];

    return runStructuredOpenRouterAgent<ArtDecision>(userContent, {
      agentType: "art",
      systemPrompt: ART_AGENT_SYSTEM_PROMPT,
      model: this.model,
      schemaName: "art_decision",
      outputSchema: z.toJSONSchema(ArtDecisionSchema) as Record<string, unknown>,
      zodSchema: ArtDecisionSchema,
      client: this.client,
      extraValidation: (decision) => validateDecision(decision, entity, candidates),
    });
  }

  private async materialize(
    entity: ArtEntity,
    decision: ArtDecision,
    candidates: string[],
    outputDir: string,
  ): Promise<AssetEntry> {
    const kindFolder = entity.kind === "npc" ? "npcs" : "monsters";

    if (decision.decision === "reuse") {
      // extraValidation already confirmed reuseFilename is one of `candidates`.
      const filename = decision.reuseFilename!;
      const sourcePath = join(this.frontendImagesDir, filename);
      const destDir = join(outputDir, "assets", kindFolder);
      mkdirSync(destDir, { recursive: true });
      const destPath = join(destDir, filename);
      copyFileSync(sourcePath, destPath);

      return {
        entityId: entity.entityId,
        relativePath: `assets/${kindFolder}/${filename}`,
        source: "reused-from-repo",
        sourceDetail: `Reused from mmorpg-frontend/public/images/${filename} (matched by the art agent from ${candidates.length} candidate(s) shown).`,
        // Never trust the model's own claim about a file it didn't inspect
        // pixel-by-pixel — verify the real alpha channel on the actual
        // bytes we just copied, same discipline the original Claude-tool
        // prompt asked for ("check with a quick script").
        transparent: await hasRealTransparency(readFileSync(sourcePath)),
      };
    }

    return {
      entityId: entity.entityId,
      // No file exists yet — this is where the asset SHOULD land once a
      // human (or a future pluggable image-gen step) turns the prompt into
      // a real file. Matches the pre-refactor ClaudeArtAgent convention.
      relativePath: `assets/${kindFolder}/${entity.entityId}.png`,
      source: "generated",
      sourceDetail: decision.generationPrompt!,
      transparent: false,
    };
  }
}

function validateDecision(decision: ArtDecision, entity: ArtEntity, candidates: string[]): string[] {
  const issues: string[] = [];
  if (decision.entityId !== entity.entityId) {
    issues.push(`entityId must be exactly '${entity.entityId}', got '${decision.entityId}'`);
  }
  if (decision.decision === "reuse") {
    if (!decision.reuseFilename) {
      issues.push("decision is 'reuse' but reuseFilename is null");
    } else if (!candidates.includes(decision.reuseFilename)) {
      issues.push(
        `reuseFilename '${decision.reuseFilename}' was not one of the candidates shown: ${candidates.join(", ")}`,
      );
    }
  } else {
    if (!decision.generationPrompt || decision.generationPrompt.trim().length === 0) {
      issues.push("decision is 'generate' but generationPrompt is empty");
    }
  }
  return issues;
}

async function hasRealTransparency(buffer: Buffer): Promise<boolean> {
  const img = sharp(buffer);
  const meta = await img.metadata();
  if (!meta.hasAlpha) return false;
  const stats = await img.stats();
  const alphaChannel = stats.channels[stats.channels.length - 1];
  return (alphaChannel?.min ?? 255) < 255;
}
