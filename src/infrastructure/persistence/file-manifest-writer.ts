import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IManifestWriter } from "../../application/ports/manifest-writer.port";
import type { ContentPackage } from "../../domain/entities/content-package.entity";

export class FileManifestWriter implements IManifestWriter {
  async write(pkg: ContentPackage, outputRoot: string): Promise<string> {
    const packageDir = join(outputRoot, pkg.zoneId);
    await mkdir(packageDir, { recursive: true });

    const manifestPath = join(packageDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(pkg, null, 2), "utf-8");

    return manifestPath;
  }
}
