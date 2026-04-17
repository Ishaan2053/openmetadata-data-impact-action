import { CanonicalEntity, LineageResult } from "../types";
import { LineageProvider } from "./provider";

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
      primaryResult.nodes.length === 0 &&
      (primaryResult.partial || primaryResult.warnings.length > 0);

    if (!shouldFallback) {
      return primaryResult;
    }

    const fallbackResult = await this.fallback.getDownstream(entity, depth);
    return {
      sourceEntityFqn: entity.fqn,
      nodes: fallbackResult.nodes,
      partial: fallbackResult.partial,
      warnings: [
        ...primaryResult.warnings,
        ...fallbackResult.warnings,
        `Auto fallback used ${this.fallback.name} for ${entity.fqn}.`,
      ],
    };
  }
}
