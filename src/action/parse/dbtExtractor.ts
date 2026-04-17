import path from "node:path";
import { ChangedFile, ParsedEntity } from "../types";

const DBT_REF_PATTERN = /ref\(\s*["']([^"']+)["']\s*\)/g;
const DBT_SOURCE_PATTERN =
  /source\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;

function buildModelEntity(filePath: string): ParsedEntity | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized.includes("/models/") || !normalized.toLowerCase().endsWith(".sql")) {
    return undefined;
  }

  const modelName = path.basename(normalized, path.extname(normalized));
  if (!modelName) {
    return undefined;
  }

  return {
    sourceKind: "dbt",
    sourceFile: filePath,
    rawReference: `model:${modelName}`,
    table: modelName,
    confidence: "high",
  };
}

function readablePatch(patch?: string): string {
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

export function extractDbtEntities(file: ChangedFile): ParsedEntity[] {
  const lowerPath = file.path.toLowerCase();
  const isDbtLike =
    lowerPath.endsWith(".sql") || lowerPath.endsWith(".sql.jinja") || lowerPath.endsWith(".jinja");

  if (!isDbtLike && !lowerPath.includes("dbt_project.")) {
    return [];
  }

  const text = `${readablePatch(file.patch)}\n${file.content ?? ""}`;
  const entities: ParsedEntity[] = [];
  const unique = new Set<string>();

  const modelEntity = buildModelEntity(file.path);
  if (modelEntity) {
    entities.push(modelEntity);
    unique.add(`table:${modelEntity.table}`);
  }

  for (const match of text.matchAll(DBT_REF_PATTERN)) {
    const modelName = match[1]?.trim();
    if (!modelName) {
      continue;
    }

    const key = `table:${modelName}`;
    if (unique.has(key)) {
      continue;
    }
    unique.add(key);

    entities.push({
      sourceKind: "dbt",
      sourceFile: file.path,
      rawReference: `ref(${modelName})`,
      table: modelName,
      confidence: "high",
    });
  }

  for (const match of text.matchAll(DBT_SOURCE_PATTERN)) {
    const sourceName = match[1]?.trim();
    const tableName = match[2]?.trim();
    if (!sourceName || !tableName) {
      continue;
    }

    const key = `table:${sourceName}.${tableName}`;
    if (unique.has(key)) {
      continue;
    }
    unique.add(key);

    entities.push({
      sourceKind: "dbt",
      sourceFile: file.path,
      rawReference: `source(${sourceName},${tableName})`,
      schema: sourceName,
      table: tableName,
      confidence: "medium",
    });
  }

  return entities;
}
