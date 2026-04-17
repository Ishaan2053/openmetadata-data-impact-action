import { AssetType, CanonicalEntity, ImpactSummary, ImpactedAsset, LineageResult, RiskLevel } from "../types";

const ORDERED_TYPES: AssetType[] = [
  "dashboard",
  "pipeline",
  "report",
  "table",
  "view",
  "topic",
  "other",
];

function emptyByType(): Record<AssetType, ImpactedAsset[]> {
  return {
    dashboard: [],
    pipeline: [],
    report: [],
    table: [],
    view: [],
    topic: [],
    other: [],
  };
}

function computeRisk(byType: Record<AssetType, ImpactedAsset[]>, warnings: string[]): RiskLevel {
  const dashboardCount = byType.dashboard.length;
  const pipelineCount = byType.pipeline.length;
  const reportCount = byType.report.length;
  const total = Object.values(byType).reduce((sum, assets) => sum + assets.length, 0);

  if (
    dashboardCount >= 5 ||
    pipelineCount >= 4 ||
    reportCount >= 8 ||
    total >= 20 ||
    (warnings.length >= 3 && total >= 8)
  ) {
    return "high";
  }

  if (total > 0 || warnings.length > 0) {
    return "medium";
  }

  return "low";
}

function buildSuggestions(risk: RiskLevel, warnings: string[], byType: Record<AssetType, ImpactedAsset[]>): string[] {
  const suggestions: string[] = [];

  if (risk === "high") {
    suggestions.push("Coordinate with downstream owners before merging high-impact data changes.");
    suggestions.push("Schedule a post-merge validation run for affected pipelines and dashboards.");
  }

  if (risk === "medium") {
    suggestions.push("Validate key downstream assets in staging after merge.");
  }

  if (warnings.some((warning) => warning.toLowerCase().includes("missing metadata"))) {
    suggestions.push("Add or repair missing OpenMetadata entities to improve lineage coverage.");
  }

  if (byType.pipeline.length > 0) {
    suggestions.push("Check pipeline freshness and SLA alerts for impacted transformations.");
  }

  return [...new Set(suggestions)];
}

export function computeImpactSummary(input: {
  changedEntities: CanonicalEntity[];
  lineageResults: LineageResult[];
  warnings: string[];
  aiSummary?: string;
}): ImpactSummary {
  const byType = emptyByType();
  const impactedMap = new Map<string, ImpactedAsset>();

  for (const result of input.lineageResults) {
    for (const node of result.nodes) {
      const key = node.fqn;
      const existing = impactedMap.get(key);
      const reason = `Downstream of ${result.sourceEntityFqn}`;

      if (!existing) {
        impactedMap.set(key, {
          id: node.id,
          fqn: node.fqn,
          name: node.name,
          type: node.type,
          url: node.url,
          reasons: [reason],
        });
        continue;
      }

      if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
      impactedMap.set(key, existing);
    }
  }

  for (const asset of impactedMap.values()) {
    byType[asset.type].push(asset);
  }

  for (const type of ORDERED_TYPES) {
    byType[type].sort((a, b) => a.name.localeCompare(b.name));
  }

  const riskLevel = computeRisk(byType, input.warnings);
  const impactedAssetCount = Object.values(byType).reduce((sum, assets) => sum + assets.length, 0);

  return {
    riskLevel,
    changedEntityCount: input.changedEntities.length,
    impactedAssetCount,
    warnings: [...new Set(input.warnings)],
    impactedByType: byType,
    suggestions: buildSuggestions(riskLevel, input.warnings, byType),
    aiSummary: input.aiSummary,
  };
}
