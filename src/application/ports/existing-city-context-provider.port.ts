import type { ExistingCityContext } from "../../domain/value-objects/existing-city-context.value-object";

/**
 * Loads the fixed facts about a city that already partially exists (see
 * existing-city-context.value-object.ts) from wherever the caller keeps
 * them — a local JSON file today, something else later without touching
 * anything that calls this port.
 */
export interface IExistingCityContextProvider {
  load(path: string): Promise<ExistingCityContext>;
}
