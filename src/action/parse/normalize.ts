import { CanonicalEntity, ParsedEntity } from "../types";

function cleanIdentifier(raw: string): string {
  return raw.replace(/[`,"\[\]]/g, "").trim().toLowerCase();
}

export function normalizeEntities(entities: ParsedEntity[]): CanonicalEntity[] {
  const normalized: CanonicalEntity[] = [];
  const dedupe = new Set<string>();

  for (const entity of entities) {
    const parts = entity.table
      .split(".")
      .map((part) => cleanIdentifier(part))
      .filter(Boolean);

    let database = entity.database ? cleanIdentifier(entity.database) : undefined;
    let schema = entity.schema ? cleanIdentifier(entity.schema) : undefined;
    let table = cleanIdentifier(entity.table);

    if (parts.length >= 3) {
      database = database ?? parts[parts.length - 3];
      schema = schema ?? parts[parts.length - 2];
      table = parts[parts.length - 1] ?? table;
    } else if (parts.length === 2) {
      schema = schema ?? parts[0];
      table = parts[1] ?? table;
    } else if (parts.length === 1) {
      table = parts[0] ?? table;
    }

    if (!table) {
      continue;
    }

    const column = entity.column ? cleanIdentifier(entity.column) : undefined;
    const fqn = [database, schema, table, column].filter(Boolean).join(".");
    const dedupeKey = `${entity.sourceKind}:${fqn}:${entity.sourceFile}`;

    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);

    normalized.push({
      sourceKind: entity.sourceKind,
      sourceFile: entity.sourceFile,
      fqn,
      rawReference: entity.rawReference,
      database,
      schema,
      table,
      column,
    });
  }

  return normalized;
}
