import {
  checkReferentialIntegrity,
  type ContentPackage,
} from "../../domain/entities/content-package.entity";

export class PackageValidationError extends Error {
  constructor(public readonly violations: string[]) {
    super(
      `Content package failed referential integrity check:\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
    this.name = "PackageValidationError";
  }
}

export class ValidatePackageUseCase {
  /** Throws PackageValidationError with every violation, not just the first. */
  execute(pkg: ContentPackage): void {
    const violations = checkReferentialIntegrity(pkg);
    if (violations.length > 0) {
      throw new PackageValidationError(violations);
    }
  }
}
