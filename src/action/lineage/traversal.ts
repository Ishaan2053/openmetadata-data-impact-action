import { CanonicalEntity, LineageResult } from "../types";
import { logDebug } from "../logging";
import { LineageProvider } from "./provider";

export interface TraversalResult {
  lineageResults: LineageResult[];
  warnings: string[];
  truncated: boolean;
  traversedNodeCount: number;
  effectiveMaxConcurrency: number;
}

interface TraversalOptions {
  maxConcurrency: number;
  maxDownstreamAssets: number;
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
    confidence: "medium",
  };
}

export async function traverseDownstream(
  provider: LineageProvider,
  seedEntities: CanonicalEntity[],
  maxDepth: number,
  options: TraversalOptions,
): Promise<TraversalResult> {
  const warnings: string[] = [];
  const lineageResults: LineageResult[] = [];
  const visited = new Set<string>();
  const discoveredDownstream = new Set<string>();
  let truncated = false;
  let currentLevel = seedEntities.filter((entity) => {
    if (visited.has(entity.fqn)) {
      return false;
    }
    visited.add(entity.fqn);
    return true;
  });

  let depth = 0;
  let dynamicConcurrency = Math.max(1, options.maxConcurrency);

  while (depth < maxDepth && currentLevel.length > 0 && !truncated) {
    const batchSize = Math.max(1, dynamicConcurrency);
    const levelResults: LineageResult[] = [];

    for (let i = 0; i < currentLevel.length; i += batchSize) {
      const chunk = currentLevel.slice(i, i + batchSize);
      const chunkResults = await Promise.all(
        chunk.map(async (entity) => {
          logDebug(`Traversing lineage from ${entity.fqn} at depth ${depth + 1}.`);
          return provider.getDownstream(entity, 1);
        }),
      );
      levelResults.push(...chunkResults);
    }

    const nextLevelMap = new Map<string, CanonicalEntity>();

    for (const result of levelResults) {
      lineageResults.push(result);
      warnings.push(...result.warnings);

      for (const node of result.nodes) {
        if (!discoveredDownstream.has(node.fqn)) {
          discoveredDownstream.add(node.fqn);
          if (discoveredDownstream.size > options.maxDownstreamAssets) {
            truncated = true;
            warnings.push(
              `Downstream traversal truncated at ${options.maxDownstreamAssets} assets. Increase max-downstream-assets for full graph coverage.`,
            );
            break;
          }
        }

        if (!visited.has(node.fqn)) {
          visited.add(node.fqn);
          nextLevelMap.set(node.fqn, entityFromFqn(node.fqn));
        }
      }

      if (truncated) {
        break;
      }
    }

    const sawRateLimit = levelResults.some((result) =>
      result.warnings.some((warning) => warning.includes("(429)") || warning.toLowerCase().includes("rate")),
    );

    if (sawRateLimit) {
      dynamicConcurrency = Math.max(1, Math.floor(dynamicConcurrency / 2));
    } else if (dynamicConcurrency < options.maxConcurrency) {
      dynamicConcurrency += 1;
    }

    currentLevel = [...nextLevelMap.values()];
    depth += 1;
  }

  return {
    lineageResults,
    warnings,
    truncated,
    traversedNodeCount: discoveredDownstream.size,
    effectiveMaxConcurrency: dynamicConcurrency,
  };
}
