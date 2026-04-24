import * as yaml from "js-yaml";
import { ChangedFile, ParsedEntity } from "../types";
import { formatWarning } from "../warnings";

interface DbtSchemaColumn {
  name?: string;
}

interface DbtSchemaTable {
  name?: string;
  columns?: DbtSchemaColumn[];
}

interface DbtSource {
  name?: string;
  tables?: DbtSchemaTable[];
}

interface DbtModel {
  name?: string;
  columns?: DbtSchemaColumn[];
}

interface SchemaDocument {
  models?: DbtModel[];
  sources?: DbtSource[];
  tables?: DbtSchemaTable[];
}

function isSchemaFile(path: string): boolean {
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

function cleanPatch(patch?: string): string {
  if (!patch) {
    return "";
  }

  return patch
    .split("\n")
    .filter((line) => !line.startsWith("+++") && !line.startsWith("---") && !line.startsWith("@@"))
    .map((line) => {
      if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
        return line.slice(1);
      }
      return line;
    })
    .join("\n");
}

function getParseText(file: ChangedFile): string {
  const patchText = cleanPatch(file.patch).trim();
  if (patchText.length > 0) {
    return patchText;
  }

  return (file.content ?? "").trim();
}

function pushTableAndColumns(
  entities: ParsedEntity[],
  sourceFile: string,
  tableName: string | undefined,
  schema: string | undefined,
  columns?: DbtSchemaColumn[],
): void {
  if (!tableName) {
    return;
  }

  entities.push({
    sourceKind: "schema",
    sourceFile,
    rawReference: tableName,
    table: tableName,
    schema,
    confidence: "high",
  });

  for (const column of columns ?? []) {
    if (!column.name) {
      continue;
    }

    entities.push({
      sourceKind: "schema",
      sourceFile,
      rawReference: `${tableName}.${column.name}`,
      table: tableName,
      schema,
      column: column.name,
      confidence: "medium",
    });
  }
}

interface SchemaExtractionResult {
  entities: ParsedEntity[];
  warnings: string[];
}

function extractFallbackSchemaEntities(text: string, sourceFile: string): ParsedEntity[] {
  const entities: ParsedEntity[] = [];
  let activeSection: "models" | "sources" | "tables" | "columns" | undefined;
  let currentSourceName: string | undefined;
  let currentSourceIndent: number | undefined;

  const pushEntity = (table: string, schema?: string): void => {
    entities.push({
      sourceKind: "schema",
      sourceFile,
      rawReference: table,
      table,
      schema,
      confidence: "low",
    });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    if (currentSourceIndent !== undefined && indent <= currentSourceIndent && !trimmed.startsWith("- name:")) {
      currentSourceName = undefined;
      currentSourceIndent = undefined;
    }

    if (/^models:\s*$/i.test(trimmed)) {
      activeSection = "models";
      continue;
    }

    if (/^sources:\s*$/i.test(trimmed)) {
      activeSection = "sources";
      currentSourceName = undefined;
      currentSourceIndent = indent;
      continue;
    }

    if (/^tables:\s*$/i.test(trimmed)) {
      activeSection = "tables";
      continue;
    }

    if (/^columns:\s*$/i.test(trimmed)) {
      activeSection = "columns";
      continue;
    }

    const nameMatch = trimmed.match(/^-\s*name:\s*([a-zA-Z0-9_.-]+)\s*$/);
    if (!nameMatch?.[1]) {
      continue;
    }

    const name = nameMatch[1];
    if (activeSection === "models") {
      pushEntity(name);
      continue;
    }

    if (activeSection === "sources") {
      currentSourceName = name;
      currentSourceIndent = indent;
      continue;
    }

    if (activeSection === "tables") {
      pushEntity(name, currentSourceName);
    }
  }

  return entities;
}

export function extractSchemaEntities(file: ChangedFile): SchemaExtractionResult {
  if (!isSchemaFile(file.path)) {
    return { entities: [], warnings: [] };
  }

  const text = getParseText(file);
  if (!text) {
    return { entities: [], warnings: [] };
  }

  const entities: ParsedEntity[] = [];
  const warnings: string[] = [];

  try {
    const documents = yaml.loadAll(text) as SchemaDocument[];

    for (const document of documents) {
      for (const model of document?.models ?? []) {
        pushTableAndColumns(entities, file.path, model.name, undefined, model.columns);
      }

      for (const source of document?.sources ?? []) {
        for (const table of source.tables ?? []) {
          pushTableAndColumns(entities, file.path, table.name, source.name, table.columns);
        }
      }

      for (const table of document?.tables ?? []) {
        pushTableAndColumns(entities, file.path, table.name, undefined, table.columns);
      }
    }
  } catch {
    warnings.push(
      formatWarning(
        "PARSE_FAILED",
        `Failed to fully parse schema file ${file.path}; using fallback name-based extraction.`,
      ),
    );

    entities.push(...extractFallbackSchemaEntities(text, file.path));
  }

  const dedupe = new Map<string, ParsedEntity>();
  for (const entity of entities) {
    const key = `${entity.table}|${entity.schema ?? ""}|${entity.column ?? ""}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, entity);
    }
  }

  return {
    entities: [...dedupe.values()],
    warnings,
  };
}
