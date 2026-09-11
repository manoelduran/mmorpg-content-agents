import { z } from "zod";
import { NpcRoleSchema } from "./city-template.value-object";
import { MapDefinitionSchema, PositionSchema } from "./dev-content.value-object";
import type { StoryManifest } from "./story-manifest.value-object";
import type { DevContent } from "./dev-content.value-object";

/**
 * ── AI ENGINEERING CONCEPT: extending, not just generating ──
 *
 * Every other value-object in this pipeline assumes a city is invented
 * whole, from nothing. Real content doesn't always start that way —
 * Aethelgard (this game's actual anchor city) already exists as a
 * hand-built 50x50 map with 2 NPCs placed on it, discovered by reading
 * mmorpg-backend's own seed data directly rather than assuming. Story and
 * Dev need to complete a city like that without inventing a competing map
 * or renaming/duplicating NPCs that already exist.
 *
 * `ExistingCityContext` is how a caller pins down the facts that are NOT
 * up for invention — an existing map's identity/dimensions, and specific
 * NPCs with their real id/name/role/position. Everything else (the
 * remaining NPCs, all quests, portals/fields, instances) is still
 * generated fresh, exactly like a from-scratch city — this just adds
 * constraints Story/Dev output must respect on top of that.
 */
export const ExistingNpcSchema = z.object({
  id: z.string().describe("Kept verbatim in Story's output — never renamed"),
  name: z.string(),
  role: NpcRoleSchema,
  position: PositionSchema.describe(
    "Kept verbatim in Dev's npcPlacements — this NPC already stands here in the live game",
  ),
});
export type ExistingNpc = z.infer<typeof ExistingNpcSchema>;

export const ExistingCityContextSchema = z.object({
  cityId: z.string(),
  cityName: z.string(),
  map: MapDefinitionSchema.describe(
    "The city's real, already-built map — Dev must echo this exactly, never invent a new one",
  ),
  existingNpcs: z.array(ExistingNpcSchema),
});
export type ExistingCityContext = z.infer<typeof ExistingCityContextSchema>;

/**
 * Pure check, no mocking needed — same shape as checkReferentialIntegrity
 * in content-package.entity.ts. Returns every violation, not just the
 * first, since these issues get fed straight back to the model as
 * self-correction feedback (see run-structured-openrouter-agent.ts's
 * extraValidation hook) and a model fixing one mistake at a time wastes
 * retry attempts.
 */
export function checkExistingNpcsPreserved(
  story: StoryManifest,
  existing: ExistingCityContext,
): string[] {
  const errors: string[] = [];

  if (story.cityId !== existing.cityId) {
    errors.push(
      `story.cityId must be exactly '${existing.cityId}' (this city already exists), got '${story.cityId}'`,
    );
  }
  if (story.cityName !== existing.cityName) {
    errors.push(
      `story.cityName must be exactly '${existing.cityName}' (this city already exists), got '${story.cityName}'`,
    );
  }

  const npcsById = new Map(story.npcs.map((npc) => [npc.id, npc]));
  for (const expected of existing.existingNpcs) {
    const actual = npcsById.get(expected.id);
    if (!actual) {
      errors.push(
        `npcs[] is missing the existing npc '${expected.id}' (${expected.name}) — it must appear unchanged, not be dropped or replaced`,
      );
      continue;
    }
    if (actual.name !== expected.name) {
      errors.push(
        `npc '${expected.id}' must keep its existing name '${expected.name}', got '${actual.name}'`,
      );
    }
    if (actual.role !== expected.role) {
      errors.push(
        `npc '${expected.id}' must keep its existing role '${expected.role}', got '${actual.role}'`,
      );
    }
  }

  return errors;
}

/** Same shape as checkExistingNpcsPreserved, for Dev's output instead of Story's. */
export function checkExistingMapAndPlacementsPreserved(
  dev: DevContent,
  existing: ExistingCityContext,
): string[] {
  const errors: string[] = [];

  if (dev.map.mapId !== existing.map.mapId) {
    errors.push(`map.mapId must be exactly '${existing.map.mapId}', got '${dev.map.mapId}'`);
  }
  if (dev.map.width !== existing.map.width || dev.map.height !== existing.map.height) {
    errors.push(
      `map dimensions must exactly match the existing map (${existing.map.width}x${existing.map.height}), ` +
        `got ${dev.map.width}x${dev.map.height} — this map already exists, do not invent a new one`,
    );
  }
  if (dev.map.isCity !== existing.map.isCity) {
    errors.push(`map.isCity must be ${existing.map.isCity} to match the existing map`);
  }

  const placementByNpcId = new Map(dev.npcPlacements.map((p) => [p.npcId, p.position]));
  for (const npc of existing.existingNpcs) {
    const placed = placementByNpcId.get(npc.id);
    if (!placed) {
      errors.push(`npcPlacements is missing a placement for existing npc '${npc.id}'`);
      continue;
    }
    if (placed.x !== npc.position.x || placed.y !== npc.position.y || placed.z !== npc.position.z) {
      errors.push(
        `npc '${npc.id}' already stands at (${npc.position.x},${npc.position.y},${npc.position.z}) in the live game — ` +
          `npcPlacements must keep that exact position, got (${placed.x},${placed.y},${placed.z})`,
      );
    }
  }

  return errors;
}
