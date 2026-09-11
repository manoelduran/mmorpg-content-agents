import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ICheckpointStore,
  Checkpoint,
} from "../../application/ports/checkpoint-store.port";
import { writeFileAtomic } from "./atomic-file-writer";

/**
 * Persists checkpoints as `${outputRoot}/.runs/<runId>/checkpoint.json` —
 * a separate `.runs/` tree from the final `output/<cityId>/` packages,
 * since a runId and a cityId aren't the same thing (Story invents the
 * cityId; the caller invents the runId before Story even runs).
 */
export class FileCheckpointStore implements ICheckpointStore {
  constructor(private readonly outputRoot: string) {}

  private path(runId: string): string {
    return join(this.outputRoot, ".runs", runId, "checkpoint.json");
  }

  async load(runId: string): Promise<Checkpoint | null> {
    try {
      const raw = await readFile(this.path(runId), "utf-8");
      return JSON.parse(raw) as Checkpoint;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(runId: string, checkpoint: Checkpoint): Promise<void> {
    await writeFileAtomic(this.path(runId), JSON.stringify(checkpoint, null, 2));
  }
}
