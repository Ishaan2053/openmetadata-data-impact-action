import { ChangedFile, ParsedEntity } from "../types";
import { logWarning } from "../logging";
import { extractSqlEntities } from "./sqlExtractor";
import { extractDbtEntities } from "./dbtExtractor";
import { extractSchemaEntities } from "./schemaExtractor";
import { normalizeEntities } from "./normalize";

interface ParseOptions {
  strictSqlParse: boolean;
  maxEntities: number;
}

function isSchemaLike(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith("schema.yml") || lower.endsWith("schema.yaml") || lower.endsWith(".schema.yml") || lower.endsWith(".schema.yaml");
}

function isDbtLike(path: string): boolean {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  return (
    lower.startsWith("models/") ||
    lower.includes("/models/") ||
    lower.endsWith("dbt_project.yml") ||
    lower.endsWith("dbt_project.yaml")
  );
}

export function extractEntitiesFromFiles(files: ChangedFile[]): {
  entities: ReturnType<typeof normalizeEntities>;
  warnings: string[];
  truncated: boolean;
  lowConfidenceEntityCount: number;
} {
  const options: ParseOptions = {
    strictSqlParse: false,
    maxEntities: Number.MAX_SAFE_INTEGER,
  };
  return extractEntitiesFromFilesWithOptions(files, options);
}

export function extractEntitiesFromFilesWithOptions(files: ChangedFile[], options: ParseOptions): {
  entities: ReturnType<typeof normalizeEntities>;
  warnings: string[];
  truncated: boolean;
  lowConfidenceEntityCount: number;
} {
  const parsed: ParsedEntity[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    try {
      const lower = file.path.toLowerCase();
      const dbtLike = isDbtLike(file.path);

      if (dbtLike) {
        parsed.push(...extractDbtEntities(file));
      }

      if (lower.endsWith(".sql") && !dbtLike) {
        parsed.push(...extractSqlEntities(file, { strictMode: options.strictSqlParse }));
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

  let truncated = false;
  let normalized = normalizeEntities(parsed);
  if (normalized.length > options.maxEntities) {
    truncated = true;
    warnings.push(
      `Entity extraction truncated at ${options.maxEntities} entities out of ${normalized.length}.`,
    );
    normalized = normalized.slice(0, options.maxEntities);
  }

  const lowConfidenceEntityCount = normalized.filter(
    (entity) => entity.confidence === "low",
  ).length;

  return {
    entities: normalized,
    warnings,
    truncated,
    lowConfidenceEntityCount,
  };
}
