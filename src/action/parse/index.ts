import { ChangedFile, ParsedEntity } from "../types";
import { logWarning } from "../logging";
import { extractSqlEntities } from "./sqlExtractor";
import { extractDbtEntities } from "./dbtExtractor";
import { extractSchemaEntities } from "./schemaExtractor";
import { normalizeEntities } from "./normalize";

function isSchemaLike(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith("schema.yml") || lower.endsWith("schema.yaml") || lower.endsWith(".schema.yml") || lower.endsWith(".schema.yaml");
}

function isDbtLike(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes("/models/") || lower.endsWith("dbt_project.yml") || lower.endsWith("dbt_project.yaml");
}

export function extractEntitiesFromFiles(files: ChangedFile[]): {
  entities: ReturnType<typeof normalizeEntities>;
  warnings: string[];
} {
  const parsed: ParsedEntity[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    try {
      const lower = file.path.toLowerCase();
      if (lower.endsWith(".sql")) {
        parsed.push(...extractSqlEntities(file));
      }

      if (isDbtLike(file.path)) {
        parsed.push(...extractDbtEntities(file));
      }

      if (isSchemaLike(file.path)) {
        parsed.push(...extractSchemaEntities(file));
      }
    } catch (error) {
      const message = `Failed to parse ${file.path}: ${String(error)}`;
      warnings.push(message);
      logWarning(message);
    }
  }

  return {
    entities: normalizeEntities(parsed),
    warnings,
  };
}
