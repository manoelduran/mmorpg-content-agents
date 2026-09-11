import type { ITargetRepoConventions } from "../ports/target-repo-conventions.port";
import type { TargetRepoConventions } from "../ports/target-repo-conventions.port";

export class LoadTargetRepoConventionsUseCase {
  constructor(private readonly reader: ITargetRepoConventions) {}

  async execute(
    backendPath: string,
    frontendPath?: string,
  ): Promise<TargetRepoConventions> {
    return this.reader.load(backendPath, frontendPath);
  }
}
