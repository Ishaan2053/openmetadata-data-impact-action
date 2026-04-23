import { CanonicalEntity, LineageNode, LineageResult } from "../types";
import { formatWarning } from "../warnings";
import { LineageProvider } from "./provider";

function mergeNodes(primary: LineageNode[], fallback: LineageNode[]): LineageNode[] {
  const merged = new Map<string, LineageNode>();

  for (const node of [...primary, ...fallback]) {
    const existing = merged.get(node.fqn);
    if (!existing) {
      merged.set(node.fqn, node);
      continue;
    }

    const combinedTags = [...(existing.tags ?? []), ...(node.tags ?? [])];
    const combinedOwners = [...(existing.owners ?? []), ...(node.owners ?? [])];
    const combinedTerms = [...(existing.glossaryTerms ?? []), ...(node.glossaryTerms ?? [])];

    merged.set(node.fqn, {
      ...existing,
      ...node,
      url: existing.url ?? node.url,
      domain: existing.domain ?? node.domain,
      tags: combinedTags.length > 0 ? [...new Set(combinedTags)] : undefined,
      owners: combinedOwners.length > 0 ? [...new Set(combinedOwners)] : undefined,
      glossaryTerms: combinedTerms.length > 0 ? [...new Set(combinedTerms)] : undefined,
    });
  }

  return [...merged.values()];
}

export class FallbackLineageProvider implements LineageProvider {
  readonly name: string;

  constructor(
    private readonly primary: LineageProvider,
    private readonly fallback: LineageProvider,
  ) {
    this.name = `${primary.name}->${fallback.name}`;
  }

  async getDownstream(entity: CanonicalEntity, depth: number): Promise<LineageResult> {
    const primaryResult = await this.primary.getDownstream(entity, depth);

    const shouldFallback =
      primaryResult.partial ||
      (primaryResult.nodes.length === 0 && primaryResult.warnings.length > 0);

    if (!shouldFallback) {
      return primaryResult;
    }

    const fallbackResult = await this.fallback.getDownstream(entity, depth);
    const mergedNodes = mergeNodes(primaryResult.nodes, fallbackResult.nodes);
    return {
      sourceEntityFqn: entity.fqn,
      nodes: mergedNodes,
      partial: primaryResult.partial || fallbackResult.partial,
      warnings: [...new Set([
        ...primaryResult.warnings,
        ...fallbackResult.warnings,
        formatWarning(
          "AUTO_FALLBACK_USED",
          `Auto fallback used ${this.fallback.name} for ${entity.fqn}.`,
        ),
      ])],
    };
  }

  getObservabilityCounters(): Record<string, number> {
    const merged: Record<string, number> = {};

    const addCounters = (prefix: string, counters: Record<string, number> | undefined): void => {
      if (!counters) {
        return;
      }

      for (const [key, value] of Object.entries(counters)) {
        merged[`${prefix}.${key}`] = value;
      }
    };

    addCounters("primary", this.primary.getObservabilityCounters?.());
    addCounters("fallback", this.fallback.getObservabilityCounters?.());

    return merged;
  }
}
