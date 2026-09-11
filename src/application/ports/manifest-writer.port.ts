import type { ContentPackage } from "../../domain/entities/content-package.entity";

export interface IManifestWriter {
  /** Writes manifest.json under `${outputRoot}/${pkg.zoneId}/`. */
  write(pkg: ContentPackage, outputRoot: string): Promise<string>;
}
