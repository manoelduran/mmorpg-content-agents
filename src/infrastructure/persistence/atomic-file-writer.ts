import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * ── AI ENGINEERING CONCEPT: atomic writes ──
 *
 * `writeFile(path, data)` is NOT atomic — the OS writes bytes to disk over
 * time, and if the process is killed (crash, Ctrl+C, an OOM) partway
 * through, `path` can be left containing a half-written, corrupted file.
 * The next run that reads it gets garbage, or the file simply looks
 * "done" when it isn't.
 *
 * The standard fix: write the full content to a TEMPORARY file first,
 * then `rename()` it on top of the real path. A filesystem rename within
 * the same directory is atomic at the OS level — from any other process's
 * point of view, the target path either still has the old content, or
 * instantly has the complete new content. There's no window where it's
 * half-written. This is the same trick most databases and package
 * managers use for "safe" file writes.
 *
 * This is a small piece of "idempotency" in the broader sense: it doesn't
 * make an LLM call deterministic, but it DOES guarantee that a crash
 * mid-write can never leave a corrupted manifest.json or checkpoint.json
 * behind for the next run to trip over.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, "utf-8");
    await rename(tempPath, path);
  } catch (err) {
    // Best-effort cleanup — if the rename itself failed, don't leave the
    // temp file behind to accumulate.
    await rm(tempPath, { force: true });
    throw err;
  }
}
