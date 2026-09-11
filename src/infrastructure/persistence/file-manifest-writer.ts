import { join } from "node:path";
import type { IManifestWriter } from "../../application/ports/manifest-writer.port";
import type { ContentPackage } from "../../domain/entities/content-package.entity";
import { writeFileAtomic } from "./atomic-file-writer";

export class FileManifestWriter implements IManifestWriter {
  async write(pkg: ContentPackage, outputRoot: string): Promise<string> {
    const manifestPath = join(outputRoot, pkg.cityId, "manifest.json");
    // Atomic write (see atomic-file-writer.ts) — a run that crashes right
    // after this call either produced a complete, valid manifest.json or
    // didn't touch the old one at all. Never a half-written file.
    await writeFileAtomic(manifestPath, JSON.stringify(pkg, null, 2));
    return manifestPath;
  }
}
