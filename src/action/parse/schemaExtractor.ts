import * as yaml from "js-yaml";
import { ChangedFile, ParsedEntity } from "../types";

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
  const lower = path.toLowerCase();
  return lower.endsWith("schema.yml") || lower.endsWith("schema.yaml") || lower.endsWith(".schema.yml") || lower.endsWith(".schema.yaml");
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
    });
  }
}

export function extractSchemaEntities(file: ChangedFile): ParsedEntity[] {
  if (!isSchemaFile(file.path)) {
    return [];
  }

  const text = (file.content && file.content.trim().length > 0 ? file.content : cleanPatch(file.patch)).trim();
  if (!text) {
    return [];
  }

  const entities: ParsedEntity[] = [];

  try {
    const document = yaml.load(text) as SchemaDocument | undefined;

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
  } catch {
    // Fallback heuristic for partial patch fragments.
    const tableMatches = text.matchAll(/\bname:\s*([a-zA-Z0-9_\-.]+)/g);
    for (const match of tableMatches) {
      const name = match[1];
      if (!name) {
        continue;
      }
      entities.push({
        sourceKind: "schema",
        sourceFile: file.path,
        rawReference: name,
        table: name,
      });
    }
  }

  const dedupe = new Map<string, ParsedEntity>();
  for (const entity of entities) {
    const key = `${entity.table}|${entity.schema ?? ""}|${entity.column ?? ""}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, entity);
    }
  }

  return [...dedupe.values()];
}
