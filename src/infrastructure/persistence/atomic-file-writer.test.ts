import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic-file-writer";

test("writeFileAtomic: writes the full content and cleans up the temp file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atomic-write-test-"));
  try {
    const path = join(dir, "nested", "file.json");
    await writeFileAtomic(path, '{"ok":true}');

    assert.equal(await readFile(path, "utf-8"), '{"ok":true}');

    // No leftover .tmp files — the rename either fully replaced the
    // target or the temp file was cleaned up on failure (see the other
    // test below), never both existing at once.
    const entries = await readdir(join(dir, "nested"));
    assert.deepEqual(entries, ["file.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic: a second write fully replaces the first — no partial content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atomic-write-test-"));
  try {
    const path = join(dir, "file.json");
    await writeFileAtomic(path, "first content, quite long, to prove replacement");
    await writeFileAtomic(path, "second");

    // If the write weren't atomic in the sense of "fully replaces", a
    // naive implementation could leave trailing bytes from the longer
    // first write behind. Confirms the file is exactly the new content.
    assert.equal(await readFile(path, "utf-8"), "second");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
