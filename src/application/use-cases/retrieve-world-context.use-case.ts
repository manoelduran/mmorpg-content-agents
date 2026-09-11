import type { IWorldRegistryRepository } from "../ports/world-registry-repository.port";
import { search, type WorldRegistryMatch } from "../../domain/entities/world-registry.entity";

const TOP_K = 3;

/**
 * The "R" in RAG for this pipeline: load long-term memory, search it for
 * what's relevant to the new brief, and render only that (not the whole
 * registry) as a short plain-text block Story can read. Keeping retrieval
 * as its own use-case — rather than inlining it into the orchestrator —
 * means it's independently testable and swappable (e.g. for a smarter
 * scoring function later) without touching orchestration logic.
 *
 * Returns "" when nothing is relevant (including the very first run ever,
 * when the registry is empty) — an empty string, not null/undefined, so
 * the caller can always concatenate it into a prompt without an extra
 * branch.
 */
export class RetrieveWorldContextUseCase {
  constructor(private readonly registryRepository: IWorldRegistryRepository) {}

  async execute(brief: string): Promise<string> {
    const registry = await this.registryRepository.load();
    const matches = search(registry, brief, TOP_K);
    if (matches.length === 0) return "";
    return renderContextBlock(matches);
  }
}

function renderContextBlock(matches: WorldRegistryMatch[]): string {
  const lines = matches.map(({ entry }) => {
    const usedNames = [...entry.npcNames, ...entry.monsterNames].join(", ");
    return `- "${entry.cityName}" (${entry.cityId}): ${entry.lore}\n  Already-used names, do not reuse: ${usedNames}`;
  });
  return [
    "Previously generated cities that may relate to this brief. Prefer building continuity with this world's established lore over accidental repetition, and never reuse a name listed below for a new entity:",
    ...lines,
  ].join("\n");
}
