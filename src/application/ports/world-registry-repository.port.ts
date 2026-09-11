import type { WorldRegistry } from "../../domain/entities/world-registry.entity";

/**
 * Port for long-term memory persistence — load() at the start of a run,
 * save() after a run adds a new entry. Kept separate from ICheckpointStore
 * (checkpoint-store.port.ts) on purpose: a checkpoint is per-run recovery
 * state that becomes irrelevant once a run finishes, while the world
 * registry accumulates across every run forever.
 */
export interface IWorldRegistryRepository {
  load(): Promise<WorldRegistry>;
  save(registry: WorldRegistry): Promise<void>;
}
