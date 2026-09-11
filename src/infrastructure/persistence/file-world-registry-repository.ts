import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IWorldRegistryRepository } from "../../application/ports/world-registry-repository.port";
import {
  WorldRegistrySchema,
  EMPTY_WORLD_REGISTRY,
  type WorldRegistry,
} from "../../domain/entities/world-registry.entity";
import { writeFileAtomic } from "./atomic-file-writer";

/**
 * Persists the whole World Registry as a single JSON file at the root of
 * the output tree: output/_world-registry.json (the leading underscore
 * keeps it sorted apart from the per-city output/<cityId>/ folders next to
 * it). One file for the entire world, not one per city, because retrieval
 * (search(), in world-registry.entity.ts) needs every past city in scope
 * at once — sharding it per city would turn a single read into a
 * directory scan for no benefit at this project's scale.
 */
export class FileWorldRegistryRepository implements IWorldRegistryRepository {
  constructor(private readonly outputRoot: string) {}

  private get path(): string {
    return join(this.outputRoot, "_world-registry.json");
  }

  async load(): Promise<WorldRegistry> {
    try {
      const raw = await readFile(this.path, "utf-8");
      return WorldRegistrySchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_WORLD_REGISTRY;
      throw err;
    }
  }

  async save(registry: WorldRegistry): Promise<void> {
    await writeFileAtomic(this.path, JSON.stringify(registry, null, 2));
  }
}
