import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { ContentPackageSchema } from "../../domain/entities/content-package.entity";

/**
 * Regenerates schemas/content-package.schema.json from the zod schema that
 * actually validates every package at runtime — one source of truth, the
 * JSON Schema file is documentation/tooling output, never hand-edited.
 * Run via `npm run build:schema`.
 */
async function main() {
  const jsonSchema = z.toJSONSchema(ContentPackageSchema, {
    target: "draft-7",
  });
  await writeFile(
    "schemas/content-package.schema.json",
    JSON.stringify(jsonSchema, null, 2) + "\n",
    "utf-8",
  );
  console.log("Wrote schemas/content-package.schema.json");
}

main();
