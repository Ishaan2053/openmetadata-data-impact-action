import { ChangedFile, ParsedEntity } from "../types";
import { logWarning } from "../logging";
import { formatWarning } from "../warnings";
import { extractSqlEntities } from "./sqlExtractor";
import { extractDbtEntities } from "./dbtExtractor";
import { extractSchemaEntities } from "./schemaExtractor";
import { normalizeEntities } from "./normalize";

interface ParseOptions {
  strictSqlParse: boolean;
  maxEntities: number;
}

function isSchemaLike(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const isYaml = normalized.endsWith(".yml") || normalized.endsWith(".yaml");
  const inModelsDir = normalized.startsWith("models/") || normalized.includes("/models/");
  const schemaNamed =
    normalized.endsWith("schema.yml") ||
    normalized.endsWith("schema.yaml") ||
    normalized.endsWith(".schema.yml") ||
    normalized.endsWith(".schema.yaml");

  return isYaml && (schemaNamed || inModelsDir) && !normalized.endsWith("dbt_project.yml") && !normalized.endsWith("dbt_project.yaml");
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

function isSqlLike(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".sql") || lower.endsWith(".sql.jinja") || lower.endsWith(".jinja");
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
      const dbtLike = isDbtLike(file.path);
      const sqlLike = isSqlLike(file.path);

      if (dbtLike) {
        parsed.push(...extractDbtEntities(file));
      }

      if (sqlLike) {
        parsed.push(
          ...extractSqlEntities(file, {
            strictMode: options.strictSqlParse || dbtLike,
          }),
        );
      }

      if (isSchemaLike(file.path)) {
        const extractedSchema = extractSchemaEntities(file);
        parsed.push(...extractedSchema.entities);
        warnings.push(...extractedSchema.warnings);
      }
    } catch (error) {
      const message = formatWarning(
        "PARSE_FAILED",
        `Failed to parse ${file.path}: ${String(error)}`,
      );
      warnings.push(message);
      logWarning(message);
    }
  }

  let truncated = false;
  let normalized = normalizeEntities(parsed);
  if (normalized.length > options.maxEntities) {
    truncated = true;
    warnings.push(
      formatWarning(
        "TRUNCATED_ENTITIES",
        `Entity extraction truncated at ${options.maxEntities} entities out of ${normalized.length}.`,
      ),
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
