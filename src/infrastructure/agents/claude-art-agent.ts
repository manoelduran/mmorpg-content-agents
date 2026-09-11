import { z } from "zod";
import type { IArtAgent } from "../../application/ports/art-agent.port";
import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import {
  AssetManifestSchema,
  type AssetManifest,
} from "../../domain/value-objects/asset-manifest.value-object";
import { runStructuredAgent } from "./run-structured-agent";

const ART_AGENT_PROMPT = `You are the Art agent for Aetherbound Online, a pixel-art top-down MMORPG.

Claude cannot generate raster images itself. Your job is therefore split:

1. REUSE FIRST. Search two places for something that already fits:
   - The existing sprite files already committed in mmorpg-frontend
     (typically public/images/ and public/images/tiles/ — use Bash/Glob to
     list what's there).
   - Any local asset pack referenced in that repo's own notes (this project
     has previously used a pack called "Pixel Art Top Down - Basic";
     look for it, e.g. under ~/Downloads, before assuming it's absent).
   If you find a good match, record it with source: 'reused-from-pack' or
   'reused-from-repo' and copy the file into the given output directory
   yourself (Bash cp), setting relativePath to where you put it.

2. ONLY when nothing fits, record source: 'generated' and write a complete,
   ready-to-paste prompt in sourceDetail describing exactly what to
   generate — same pixel-art style as the reused references (32x32 ground
   tiles, transparent background, no external shadow), written the way a
   human would paste it into an image generator. Do NOT invent a file at
   relativePath in this case — leave it as the path the asset SHOULD land
   at once generated; a human (or a future pluggable image-gen step) fills
   it in from your prompt. Never claim transparent: true for something you
   haven't actually verified — for reused files, check with a quick script
   (e.g. PIL getbbox()/alpha inspection) before claiming it.

Cover every npc and every monster in the story with exactly one asset entry
each (entityId must match their id from the story).`;

export class ClaudeArtAgent implements IArtAgent {
  async generate(
    story: StoryManifest,
    outputDir: string,
  ): Promise<AssetManifest> {
    const prompt = `Zone: ${story.zoneName} (${story.zoneId})
Atmosphere: ${story.atmosphereKeywords.join(", ")}
Output directory for any reused/copied files: ${outputDir}

NPCs:
${story.npcs.map((n) => `- ${n.id}: ${n.name} (${n.role})`).join("\n")}

Monsters:
${story.monsters.map((m) => `- ${m.id}: ${m.name} — ${m.flavor}`).join("\n")}`;

    const raw = await runStructuredAgent<AssetManifest>(prompt, {
      agentType: "art",
      definition: {
        description: "Sources or specifies sprite assets for a zone",
        prompt: ART_AGENT_PROMPT,
        tools: ["Bash", "Read", "Glob", "Write"],
      },
      outputSchema: z.toJSONSchema(AssetManifestSchema) as Record<
        string,
        unknown
      >,
    });
    return AssetManifestSchema.parse(raw);
  }
}
