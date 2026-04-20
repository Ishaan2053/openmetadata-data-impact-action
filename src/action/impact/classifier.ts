import {
  AssetType,
  CanonicalEntity,
  ImpactSummary,
  ImpactedAsset,
  LineageResult,
  RiskLevel,
  RiskThresholds,
} from "../types";
import { extractWarningCode } from "../warnings";

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

function hasCriticalAsset(
  byType: Record<AssetType, ImpactedAsset[]>,
  criticalTags: string[],
): boolean {
  const normalizedTags = new Set(criticalTags.map((tag) => tag.toLowerCase()));
  for (const assets of Object.values(byType)) {
    for (const asset of assets) {
      if ((asset.tags ?? []).some((tag) => normalizedTags.has(tag.toLowerCase()))) {
        return true;
      }
    }
  }
  return false;
}

function computeRisk(
  byType: Record<AssetType, ImpactedAsset[]>,
  warnings: string[],
  criticalTags: string[],
  lowConfidenceEntityCount: number,
  thresholds: RiskThresholds,
): RiskLevel {
  const dashboardCount = byType.dashboard.length;
  const pipelineCount = byType.pipeline.length;
  const reportCount = byType.report.length;
  const total = Object.values(byType).reduce((sum, assets) => sum + assets.length, 0);

  if (hasCriticalAsset(byType, criticalTags)) {
    return "high";
  }

  if (
    dashboardCount >= thresholds.dashboardHigh ||
    pipelineCount >= thresholds.pipelineHigh ||
    reportCount >= thresholds.reportHigh ||
    total >= thresholds.totalHigh ||
    (warnings.length >= thresholds.warningCountHigh && total >= thresholds.warningMinAssetsHigh) ||
    lowConfidenceEntityCount >= thresholds.lowConfidenceHigh
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

  if (warnings.some((warning) => extractWarningCode(warning) === "METADATA_MISSING")) {
    suggestions.push("Add or repair missing OpenMetadata entities to improve lineage coverage.");
  }

  if (byType.pipeline.length > 0) {
    suggestions.push("Check pipeline freshness and SLA alerts for impacted transformations.");
  }

  const assetsWithoutOwners = Object.values(byType)
    .flat()
    .filter((asset) => !asset.owners || asset.owners.length === 0).length;
  if (assetsWithoutOwners > 0) {
    suggestions.push("Add owner metadata to impacted assets in OpenMetadata for faster incident routing.");
  }

  return [...new Set(suggestions)];
}

function mergeLists(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  const merged = [...(existing ?? []), ...(incoming ?? [])];
  if (merged.length === 0) {
    return undefined;
  }
  return [...new Set(merged)];
}

export function computeImpactSummary(input: {
  changedEntities: CanonicalEntity[];
  lineageResults: LineageResult[];
  warnings: string[];
  lowConfidenceEntityCount: number;
  criticalAssetTags: string[];
  riskThresholds: RiskThresholds;
  truncated: boolean;
  whatChanged?: string[];
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
          tags: node.tags,
          owners: node.owners,
          domain: node.domain,
          glossaryTerms: node.glossaryTerms,
        });
        continue;
      }

      if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
      if (!existing.url && node.url) {
        existing.url = node.url;
      }
      existing.tags = mergeLists(existing.tags, node.tags);
      existing.owners = mergeLists(existing.owners, node.owners);
      existing.glossaryTerms = mergeLists(existing.glossaryTerms, node.glossaryTerms);
      if (!existing.domain && node.domain) {
        existing.domain = node.domain;
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

  const riskLevel = computeRisk(
    byType,
    input.warnings,
    input.criticalAssetTags,
    input.lowConfidenceEntityCount,
    input.riskThresholds,
  );
  const impactedAssetCount = Object.values(byType).reduce((sum, assets) => sum + assets.length, 0);

  return {
    riskLevel,
    changedEntityCount: input.changedEntities.length,
    lowConfidenceEntityCount: input.lowConfidenceEntityCount,
    impactedAssetCount,
    whatChanged: input.whatChanged ?? [],
    warnings: [...new Set(input.warnings)],
    impactedByType: byType,
    suggestions: buildSuggestions(riskLevel, input.warnings, byType),
    aiSummary: input.aiSummary,
    truncated: input.truncated,
  };
}
