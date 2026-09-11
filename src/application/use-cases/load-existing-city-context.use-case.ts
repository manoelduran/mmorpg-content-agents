import type { IExistingCityContextProvider } from "../ports/existing-city-context-provider.port";
import type { ExistingCityContext } from "../../domain/value-objects/existing-city-context.value-object";

export class LoadExistingCityContextUseCase {
  constructor(private readonly provider: IExistingCityContextProvider) {}

  async execute(path: string): Promise<ExistingCityContext> {
    return this.provider.load(path);
  }
}
