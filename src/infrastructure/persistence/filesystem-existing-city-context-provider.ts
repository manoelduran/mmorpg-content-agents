import { readFile } from "node:fs/promises";
import type { IExistingCityContextProvider } from "../../application/ports/existing-city-context-provider.port";
import {
  ExistingCityContextSchema,
  type ExistingCityContext,
} from "../../domain/value-objects/existing-city-context.value-object";

/**
 * Reads a hand-written JSON file describing a city's already-existing,
 * fixed facts (see existing-city-context.value-object.ts) — e.g.
 * existing-cities/aethelgard.json, sourced by hand from
 * mmorpg-backend's own seed data rather than parsed out of it, since a
 * one-off TypeScript seed file isn't worth writing a parser for.
 */
export class FilesystemExistingCityContextProvider
  implements IExistingCityContextProvider
{
  async load(path: string): Promise<ExistingCityContext> {
    const raw = await readFile(path, "utf-8");
    return ExistingCityContextSchema.parse(JSON.parse(raw));
  }
}
