import { z } from "zod";
import type { StoryManifest } from "../value-objects/story-manifest.value-object";

/**
 * ── AI ENGINEERING CONCEPT: long-term memory + RAG, unified ──
 *
 * "Memory" for an agent system means state that outlives a single
 * pipeline run and gets read back in on the NEXT one — this file is that
 * state's shape. "RAG" (Retrieval-Augmented Generation) means searching
 * that state for what's relevant to the current request and injecting
 * only that into the prompt, instead of either ignoring history entirely
 * or dumping the whole history in every time (which would blow the
 * context window after a handful of cities). Those are the same
 * mechanism here: one persisted WorldRegistry, one search() function.
 *
 * search() below is classic term-overlap keyword retrieval (the same
 * family as BM25), not vector/embedding search. That's a deliberate,
 * honest choice for this project's scale — a handful to a few dozen past
 * cities fits trivially in memory and a linear scan, and pulling in an
 * embeddings API would be a second paid LLM-adjacent dependency to
 * justify for a corpus this small. If the registry ever grows into the
 * thousands of entries, that trade-off should be revisited.
 */

export const WorldRegistryEntrySchema = z.object({
  cityId: z.string(),
  cityName: z.string(),
  brief: z.string().describe("The original free-text brief that produced this city"),
  lore: z.string(),
  atmosphereKeywords: z.array(z.string()),
  npcNames: z.array(z.string()),
  questTitles: z.array(z.string()),
  monsterNames: z.array(z.string()),
});
export type WorldRegistryEntry = z.infer<typeof WorldRegistryEntrySchema>;

export const WorldRegistrySchema = z.object({
  entries: z.array(WorldRegistryEntrySchema),
});
export type WorldRegistry = z.infer<typeof WorldRegistrySchema>;

export const EMPTY_WORLD_REGISTRY: WorldRegistry = { entries: [] };

/**
 * Distills a finished StoryManifest down to what's worth remembering
 * long-term: names (so future runs don't collide with them) and enough
 * lore/keywords to judge relevance later. Deliberately does NOT store the
 * full manifest — the registry is memory for retrieval, not a backup of
 * every past run (the checkpoint store and output/<cityId>/ already are).
 */
export function buildWorldRegistryEntry(
  story: StoryManifest,
  brief: string,
): WorldRegistryEntry {
  return {
    cityId: story.cityId,
    cityName: story.cityName,
    brief,
    lore: story.lore,
    atmosphereKeywords: story.atmosphereKeywords,
    // Portal guardians/return-guides and instance quest-giver companions
    // are named characters too, just not part of the 8-slot roster (see
    // PortalGuardianBriefSchema/InstanceBossCompletionSchema) — folded in
    // here so a future city's Story agent won't collide with their names
    // either.
    npcNames: [
      ...story.npcs.map((npc) => npc.name),
      ...story.portals.flatMap((p) => [p.outboundGuardian.name, p.returnGuide.name]),
      ...story.instances.map((i) => i.bossCompletion.questGiverName),
    ],
    questTitles: [
      ...story.quests.map((quest) => quest.title),
      ...story.instances.map((i) => i.bossCompletion.questTitle),
    ],
    monsterNames: [
      ...story.fields.flatMap((field) => field.monsters.map((monster) => monster.name)),
      ...story.instances.flatMap((instance) => instance.monsters.map((monster) => monster.name)),
    ],
  };
}

/** Pure, immutable append — matches how the rest of domain/ avoids mutation. */
export function addEntry(registry: WorldRegistry, entry: WorldRegistryEntry): WorldRegistry {
  return { entries: [...registry.entries, entry] };
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9à-úãõâêîôûáéíóúç]+/i)
      .filter((word) => word.length > 2),
  );
}

function searchableText(entry: WorldRegistryEntry): string {
  return [
    entry.cityName,
    entry.brief,
    entry.lore,
    ...entry.atmosphereKeywords,
    ...entry.npcNames,
    ...entry.questTitles,
    ...entry.monsterNames,
  ].join(" ");
}

export interface WorldRegistryMatch {
  entry: WorldRegistryEntry;
  score: number;
}

/**
 * Scores every entry by how many distinct query terms it contains, then
 * returns the top K with score > 0 — entries sharing zero terms with the
 * query are dropped rather than padded in, so an unrelated brief (a
 * brand-new theme with no overlap in the registry) correctly retrieves
 * nothing instead of noise. Ties keep insertion order (older cities
 * first), via a stable sort on the original index.
 */
export function search(
  registry: WorldRegistry,
  query: string,
  topK: number,
): WorldRegistryMatch[] {
  const queryTerms = tokenize(query);
  if (queryTerms.size === 0) return [];

  return registry.entries
    .map((entry, index) => {
      const entryTerms = searchableText(entry);
      const entryTermSet = tokenize(entryTerms);
      let score = 0;
      for (const term of queryTerms) {
        if (entryTermSet.has(term)) score++;
      }
      return { entry, score, index };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, topK)
    .map(({ entry, score }) => ({ entry, score }));
}
