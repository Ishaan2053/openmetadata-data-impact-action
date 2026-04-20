import { ChangedFile, ParsedEntity } from "../types";

interface SqlExtractorOptions {
  strictMode: boolean;
}

function isSqlLikePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".sql") ||
    lower.endsWith(".sql.jinja") ||
    lower.endsWith(".jinja")
  );
}

const SQL_TABLE_PATTERN =
  /\b(?:from|join|into|update|table|view|merge\s+into|delete\s+from|truncate\s+table)\s+([`"\[\]a-zA-Z0-9_.-]+)/gi;
const SQL_COLUMN_PATTERN = /\b([`"\[\]a-zA-Z_][`"\[\]a-zA-Z0-9_.-]*)\.([`"\[\]a-zA-Z_][`"\[\]a-zA-Z0-9_-]*)\b/g;

function cleanupIdentifier(raw: string): string {
  return raw
    .replace(/[`,"\[\]]/g, "")
    .replace(/[;,)]+$/g, "")
    .trim();
}

function extractReadablePatch(patch: string): string {
  const lines = patch
    .split("\n")
    .filter((line) => !line.startsWith("+++") && !line.startsWith("---") && !line.startsWith("@@"))
    .map((line) => {
      if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
        return line.slice(1);
      }
      return line;
    });
  return lines.join("\n");
}

function splitTableParts(tableRef: string): {
  database?: string | undefined;
  schema?: string | undefined;
  table: string;
} {
  const cleaned = cleanupIdentifier(tableRef);
  const parts = cleaned.split(".").filter(Boolean);

  if (parts.length >= 3) {
    return {
      database: parts.at(-3),
      schema: parts.at(-2),
      table: parts.at(-1) ?? cleaned,
    };
  }

  if (parts.length === 2) {
    return {
      schema: parts[0],
      table: parts[1] ?? cleaned,
    };
  }

  return {
    table: parts[0] ?? cleaned,
  };
}

export function extractSqlEntities(file: ChangedFile, options: SqlExtractorOptions): ParsedEntity[] {
  if (!isSqlLikePath(file.path)) {
    return [];
  }

  const searchText = [file.patch ? extractReadablePatch(file.patch) : "", file.content ?? ""]
    .join("\n")
    .trim();

  if (!searchText) {
    return [];
  }

  const entities: ParsedEntity[] = [];
  const unique = new Set<string>();

  for (const match of searchText.matchAll(SQL_TABLE_PATTERN)) {
    const rawReference = match[1];
    if (!rawReference) {
      continue;
    }

    const tableParts = splitTableParts(rawReference);
    const key = `table:${tableParts.database ?? ""}.${tableParts.schema ?? ""}.${tableParts.table}`;
    if (unique.has(key)) {
      continue;
    }

    unique.add(key);
    entities.push({
      sourceKind: "sql",
      sourceFile: file.path,
      rawReference,
      table: tableParts.table,
      schema: tableParts.schema,
      database: tableParts.database,
      confidence: "high",
    });
  }

  if (options.strictMode) {
    return entities;
  }

  for (const match of searchText.matchAll(SQL_COLUMN_PATTERN)) {
    const tableRef = match[1];
    const columnRef = match[2];
    if (!tableRef || !columnRef) {
      continue;
    }

    const cleanedColumn = cleanupIdentifier(columnRef);
    if (!cleanedColumn) {
      continue;
    }

    const tableParts = splitTableParts(tableRef);
    const key = `column:${tableParts.database ?? ""}.${tableParts.schema ?? ""}.${tableParts.table}.${cleanedColumn}`;
    if (unique.has(key)) {
      continue;
    }

    unique.add(key);
    entities.push({
      sourceKind: "sql",
      sourceFile: file.path,
      rawReference: `${tableRef}.${columnRef}`,
      table: tableParts.table,
      schema: tableParts.schema,
      database: tableParts.database,
      column: cleanedColumn,
      confidence: "low",
    });
  }

  return entities;
}
