import { CanonicalEntity, LineageResult } from "../types";
import { logDebug } from "../logging";
import { LineageProvider } from "./provider";

export interface TraversalResult {
  lineageResults: LineageResult[];
  warnings: string[];
}

function entityFromFqn(fqn: string): CanonicalEntity {
  const parts = fqn.split(".").filter(Boolean);
  const table = parts.at(-1) ?? fqn;
  const schema = parts.length >= 2 ? parts.at(-2) : undefined;
  const database = parts.length >= 3 ? parts.at(-3) : undefined;

  return {
    sourceKind: "sql",
    sourceFile: "lineage",
    rawReference: fqn,
    fqn,
    table,
    schema,
    database,
  };
}

export async function traverseDownstream(
  provider: LineageProvider,
  seedEntities: CanonicalEntity[],
  maxDepth: number,
): Promise<TraversalResult> {
  const warnings: string[] = [];
  const lineageResults: LineageResult[] = [];
  const visited = new Set<string>();
  const queue: Array<{ entity: CanonicalEntity; depth: number }> = seedEntities.map((entity) => ({
    entity,
    depth: 0,
  }));
  let index = 0;

  while (index < queue.length) {
    const current = queue[index];
    index += 1;

    if (!current) {
      continue;
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    if (visited.has(current.entity.fqn)) {
      continue;
    }
    visited.add(current.entity.fqn);

    logDebug(`Traversing lineage from ${current.entity.fqn} at depth ${current.depth + 1}.`);
    const result = await provider.getDownstream(current.entity, 1);
    lineageResults.push(result);
    warnings.push(...result.warnings);

    for (const node of result.nodes) {
      if (visited.has(node.fqn)) {
        continue;
      }

      queue.push({
        entity: entityFromFqn(node.fqn),
        depth: current.depth + 1,
      });
    }
  }

  return {
    lineageResults,
    warnings,
  };
}
