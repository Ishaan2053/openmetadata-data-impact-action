import {
  AssetType,
  CanonicalEntity,
  ImpactSummary,
  ImpactedAsset,
  LineageResult,
  RiskLevel,
  RiskWeighting,
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
  riskWeighting: RiskWeighting,
): RiskLevel {
  const dashboardCount = byType.dashboard.length;
  const pipelineCount = byType.pipeline.length;
  const reportCount = byType.report.length;
  const total = Object.values(byType).reduce((sum, assets) => sum + assets.length, 0);

  if (hasCriticalAsset(byType, criticalTags)) {
    return "high";
  }

  let baseRisk: RiskLevel = "low";

  if (
    dashboardCount >= thresholds.dashboardHigh ||
    pipelineCount >= thresholds.pipelineHigh ||
    reportCount >= thresholds.reportHigh ||
    total >= thresholds.totalHigh ||
    (warnings.length >= thresholds.warningCountHigh && total >= thresholds.warningMinAssetsHigh) ||
    lowConfidenceEntityCount >= thresholds.lowConfidenceHigh
  ) {
    baseRisk = "high";
  }

  if (baseRisk !== "high" && (total > 0 || warnings.length > 0)) {
    baseRisk = "medium";
  }

  if (baseRisk === "high") {
    return baseRisk;
  }

  const anyWeightEnabled =
    riskWeighting.governance > 0 || riskWeighting.usage > 0 || riskWeighting.dataQuality > 0;
  if (!anyWeightEnabled) {
    return baseRisk;
  }

  const allAssets = Object.values(byType).flat();
  const normalizedCriticalTags = new Set(criticalTags.map((tag) => tag.toLowerCase()));
  const missingOwners = allAssets.filter((asset) => (asset.owners ?? []).length === 0).length;
  const missingDomain = allAssets.filter((asset) => !(asset.domain && asset.domain.length > 0)).length;
  const criticalTaggedAssets = allAssets.filter((asset) =>
    (asset.tags ?? []).some((tag) => normalizedCriticalTags.has(tag.toLowerCase())),
  ).length;

  const governanceSignal = missingOwners + missingDomain + criticalTaggedAssets;
  const usageSignal = dashboardCount * 2 + reportCount + pipelineCount;
  const dataQualityWarningCodes = new Set([
    "METADATA_MISSING",
    "LINEAGE_EMPTY_PAYLOAD",
    "LINEAGE_UNAVAILABLE",
    "PARSE_FAILED",
  ]);
  const dataQualityWarningCount = warnings.filter((warning) => {
    const code = extractWarningCode(warning);
    return code ? dataQualityWarningCodes.has(code) : false;
  }).length;
  const dataQualitySignal = dataQualityWarningCount + lowConfidenceEntityCount;

  const weightedScore =
    governanceSignal * riskWeighting.governance +
    usageSignal * riskWeighting.usage +
    dataQualitySignal * riskWeighting.dataQuality;

  if (weightedScore >= riskWeighting.highThreshold) {
    return "high";
  }

  if (weightedScore >= riskWeighting.mediumThreshold && baseRisk === "low") {
    return "medium";
  }

  return baseRisk;
}

function buildSuggestions(risk: RiskLevel, warnings: string[], byType: Record<AssetType, ImpactedAsset[]>): string[] {
  const suggestions: string[] = [];
  const allAssets = Object.values(byType).flat();
  const uniqueOwners = [...new Set(allAssets.flatMap((asset) => asset.owners ?? []))];
  const uniqueDomains = [...new Set(allAssets.map((asset) => asset.domain).filter(Boolean))] as string[];
  const criticalAssets = allAssets.filter((asset) => (asset.tags ?? []).some((tag) => tag.includes("critical") || tag.includes("tier")));
  const criticalOwners = [...new Set(criticalAssets.flatMap((asset) => asset.owners ?? []))];

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

  if (criticalAssets.length > 0) {
    suggestions.push("Treat impacted critical assets as merge blockers until validation succeeds.");
  }

  if (criticalOwners.length > 0) {
    suggestions.push(
      `Request review from OpenMetadata owners tied to critical impact: ${criticalOwners.slice(0, 3).join(", ")}.`,
    );
  } else if (uniqueOwners.length > 0) {
    suggestions.push(
      `Request review from OpenMetadata owners of impacted assets: ${uniqueOwners.slice(0, 3).join(", ")}.`,
    );
  }

  if (uniqueDomains.length > 0) {
    suggestions.push(
      `Validate downstream assets in affected domains: ${uniqueDomains.slice(0, 3).join(", ")}.`,
    );
  }

  if (byType.pipeline.length > 0) {
    suggestions.push("Check pipeline freshness and SLA alerts for impacted transformations.");
  }

  const assetsWithoutOwners = allAssets.filter((asset) => !asset.owners || asset.owners.length === 0).length;
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
  riskWeighting: RiskWeighting;
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
    input.riskWeighting,
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
