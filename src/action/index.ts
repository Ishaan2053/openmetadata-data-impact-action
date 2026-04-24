import * as core from "@actions/core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";
import { logError, logInfo, logWarning, withLogGroup } from "./logging";
import { DiffReader } from "./github/diffReader";
import { extractEntitiesFromFilesWithOptions } from "./parse";
import { LineageProvider } from "./lineage/provider";
import { OpenMetadataLineageProvider } from "./lineage/openmetadataProvider";
import { McpLineageProvider } from "./lineage/mcpProvider";
import { FallbackLineageProvider } from "./lineage/fallbackProvider";
import { traverseDownstream } from "./lineage/traversal";
import { computeImpactSummary } from "./impact/classifier";
import { renderDetailedImpactReport, renderImpactComment } from "./comment/render";
import { truncateForStepSummary } from "./comment/summary";
import { upsertImpactComment } from "./comment/publish";
import { buildOptionalAiSummary } from "./impact/aiSummary";
import { ImpactSummary } from "./types";
import {
  AnalysisStatus,
  computeAnalysisStatus,
  countWarningCode,
  formatWarning,
  warningCodeCounts,
} from "./warnings";

const OUTPUT_JSON_MAX_ASSETS = 50;
const MAX_IMPACT_JSON_OUTPUT_BYTES = 900_000;

interface CompactImpactJson {
  version: number;
  generatedAt: string;
  analysisStatus: AnalysisStatus;
  riskLevel: string;
  changedEntityCount: number;
  lowConfidenceEntityCount: number;
  impactedAssetCount: number;
  warningCount: number;
  warnings: string[];
  warningCodeCounts: Record<string, number>;
  truncated: boolean;
  whatChanged: string[];
  impactedByTypeCounts: Record<string, number>;
  retryObservability: Record<string, number>;
  sampleImpactedAssets: Array<{
    type: string;
    fqn: string;
    name: string;
    reasons: string[];
    tags?: string[];
    owners?: string[];
    domain?: string;
  }>;
  outputTruncated?: boolean;
}

interface CompactOutputSerialization {
  json: string;
  truncated: boolean;
}

interface PrimaryOutputs {
  riskLevel: string;
  impactedAssetCount: number;
  warningCount: number;
  changedEntityCount: number;
  lowConfidenceEntityCount: number;
  truncated: boolean;
}

function setPrimaryOutputs(outputs: PrimaryOutputs): void {
  core.setOutput("risk-level", outputs.riskLevel);
  core.setOutput("impacted-asset-count", String(outputs.impactedAssetCount));
  core.setOutput("warning-count", String(outputs.warningCount));
  core.setOutput("changed-entity-count", String(outputs.changedEntityCount));
  core.setOutput("low-confidence-entity-count", String(outputs.lowConfidenceEntityCount));
  core.setOutput("truncated-analysis", String(outputs.truncated));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function truncateStringList(values: string[], maxItems: number, maxItemLength: number): string[] {
  return values
    .slice(0, maxItems)
    .map((value) => truncateText(value, maxItemLength));
}

function truncateSampleAssets(
  assets: CompactImpactJson["sampleImpactedAssets"],
  maxItems: number,
): CompactImpactJson["sampleImpactedAssets"] {
  return assets.slice(0, maxItems).map((asset) => ({
    ...asset,
    fqn: truncateText(asset.fqn, 220),
    name: truncateText(asset.name, 180),
    reasons: truncateStringList(asset.reasons, 3, 220),
    ...(asset.tags ? { tags: truncateStringList(asset.tags, 8, 80) } : {}),
    ...(asset.owners ? { owners: truncateStringList(asset.owners, 6, 80) } : {}),
    ...(asset.domain ? { domain: truncateText(asset.domain, 120) } : {}),
  }));
}

function serializeCompactImpactJsonForOutput(
  payload: CompactImpactJson,
  maxBytes: number = MAX_IMPACT_JSON_OUTPUT_BYTES,
): CompactOutputSerialization {
  const serialize = (candidate: CompactImpactJson): string => JSON.stringify(candidate);

  const initial = serialize(payload);
  if (Buffer.byteLength(initial, "utf8") <= maxBytes) {
    return { json: initial, truncated: false };
  }

  const candidates: Array<{ maxWarnings: number; maxWhatChanged: number; maxAssets: number }> = [
    { maxWarnings: 120, maxWhatChanged: 30, maxAssets: 30 },
    { maxWarnings: 80, maxWhatChanged: 20, maxAssets: 20 },
    { maxWarnings: 40, maxWhatChanged: 12, maxAssets: 10 },
    { maxWarnings: 20, maxWhatChanged: 6, maxAssets: 0 },
    { maxWarnings: 0, maxWhatChanged: 0, maxAssets: 0 },
  ];

  for (const limits of candidates) {
    const candidatePayload: CompactImpactJson = {
      ...payload,
      warnings: truncateStringList(payload.warnings, limits.maxWarnings, 240),
      whatChanged: truncateStringList(payload.whatChanged, limits.maxWhatChanged, 220),
      sampleImpactedAssets: truncateSampleAssets(payload.sampleImpactedAssets, limits.maxAssets),
      outputTruncated: true,
    };

    const json = serialize(candidatePayload);
    if (Buffer.byteLength(json, "utf8") <= maxBytes) {
      return { json, truncated: true };
    }
  }

  const minimal: CompactImpactJson = {
    version: payload.version,
    generatedAt: payload.generatedAt,
    analysisStatus: payload.analysisStatus,
    riskLevel: payload.riskLevel,
    changedEntityCount: payload.changedEntityCount,
    lowConfidenceEntityCount: payload.lowConfidenceEntityCount,
    impactedAssetCount: payload.impactedAssetCount,
    warningCount: payload.warningCount,
    warnings: [],
    warningCodeCounts: payload.warningCodeCounts,
    truncated: payload.truncated,
    whatChanged: [],
    retryObservability: payload.retryObservability,
    impactedByTypeCounts: payload.impactedByTypeCounts,
    sampleImpactedAssets: [],
    outputTruncated: true,
  };

  return { json: serialize(minimal), truncated: true };
}

async function publishImpactCommentBestEffort(
  githubToken: string,
  prNumber: number,
  body: string,
): Promise<string | undefined> {
  try {
    await upsertImpactComment(githubToken, prNumber, body);
    return undefined;
  } catch (error) {
    const asRecord = error as { status?: number };
    const reason = asRecord.status ? `status ${asRecord.status}` : String(error);
    logError(`Unable to publish PR impact comment (${reason}). Continuing without failing analysis.`);
    return formatWarning(
      "COMMENT_PUBLISH_FAILED",
      `Unable to publish PR impact comment (${reason}).`,
    );
  }
}

async function writeJobSummary(markdown: string): Promise<void> {
  const prepared = truncateForStepSummary(markdown);
  if (prepared.truncated) {
    logInfo("Job summary exceeded GitHub step summary limit and was truncated.");
  }
  await core.summary.clear();
  await core.summary.addRaw(prepared.markdown, true).write();
}

async function writeImpactJsonFile(filePath: string, payload: unknown): Promise<string> {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return resolvedPath;
}

function buildCompactImpactJson(input: {
  analysisStatus: AnalysisStatus;
  riskLevel: string;
  changedEntityCount: number;
  lowConfidenceEntityCount: number;
  impactedAssetCount: number;
  warnings: string[];
  truncated: boolean;
  whatChanged: string[];
  retryObservability?: Record<string, number>;
  impactedByType?: ImpactSummary["impactedByType"];
}): CompactImpactJson {
  const impactedByTypeCounts: Record<string, number> = {
    dashboard: 0,
    pipeline: 0,
    report: 0,
    table: 0,
    view: 0,
    topic: 0,
    other: 0,
  };

  const sampleImpactedAssets: CompactImpactJson["sampleImpactedAssets"] = [];

  if (input.impactedByType) {
    for (const [assetType, assets] of Object.entries(input.impactedByType)) {
      impactedByTypeCounts[assetType] = assets.length;
      for (const asset of assets) {
        if (sampleImpactedAssets.length >= OUTPUT_JSON_MAX_ASSETS) {
          break;
        }

        sampleImpactedAssets.push({
          type: assetType,
          fqn: asset.fqn,
          name: asset.name,
          reasons: asset.reasons,
          ...(asset.tags ? { tags: asset.tags } : {}),
          ...(asset.owners ? { owners: asset.owners } : {}),
          ...(asset.domain ? { domain: asset.domain } : {}),
        });
      }
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    analysisStatus: input.analysisStatus,
    riskLevel: input.riskLevel,
    changedEntityCount: input.changedEntityCount,
    lowConfidenceEntityCount: input.lowConfidenceEntityCount,
    impactedAssetCount: input.impactedAssetCount,
    warningCount: input.warnings.length,
    warnings: input.warnings,
    warningCodeCounts: warningCodeCounts(input.warnings),
    truncated: input.truncated,
    whatChanged: input.whatChanged,
    retryObservability: input.retryObservability ?? {},
    impactedByTypeCounts,
    sampleImpactedAssets,
  };
}

async function emitStructuredOutputs(config: ReturnType<typeof getConfig>, compactPayload: CompactImpactJson, fullPayload: unknown): Promise<void> {
  core.setOutput("analysis-status", compactPayload.analysisStatus);
  core.setOutput("warning-code-counts", JSON.stringify(compactPayload.warningCodeCounts));
  core.setOutput("retry-observability", JSON.stringify(compactPayload.retryObservability));
  const serializedCompact = serializeCompactImpactJsonForOutput(compactPayload);
  if (serializedCompact.truncated) {
    logWarning("impact-json output exceeded safe size budget and was truncated.");
  }
  core.setOutput("impact-json", serializedCompact.json);

  if (config.impactJsonFile) {
    const resolvedPath = await writeImpactJsonFile(config.impactJsonFile, fullPayload);
    core.setOutput("impact-json-file", resolvedPath);
    return;
  }

  core.setOutput("impact-json-file", "");
}

function collectRetryObservability(provider: LineageProvider): Record<string, number> {
  return provider.getObservabilityCounters?.() ?? {};
}

function createProvider(config: ReturnType<typeof getConfig>): {
  provider: LineageProvider;
  providerNotice?: string;
} {
  if (config.lineageProvider === "api") {
    return { provider: new OpenMetadataLineageProvider(config) };
  }

  if (config.lineageProvider === "mcp") {
    return { provider: new McpLineageProvider(config) };
  }

  if (config.mcpEndpoint) {
    const mcpProvider = new McpLineageProvider(config);
    const apiProvider = new OpenMetadataLineageProvider(config);
    return {
      provider: new FallbackLineageProvider(mcpProvider, apiProvider),
      providerNotice:
        "Auto lineage mode enabled with MCP primary and OpenMetadata API fallback.",
    };
  }

  return { provider: new OpenMetadataLineageProvider(config) };
}

export async function run(): Promise<void> {
  let config: ReturnType<typeof getConfig> | undefined;

  try {
    config = getConfig();
    if (!config) {
      throw new Error("Failed to load action configuration.");
    }

    const runtimeConfig = config;

    const diffReader = new DiffReader(runtimeConfig);

    const diff = await withLogGroup("Read pull request diff", async () => {
      return diffReader.readPullRequestDiff();
    });

    const guardrailWarnings: string[] = [];
    let truncated = false;

    let trackedFiles = diffReader.filterTrackedFiles(diff.files);

    if (trackedFiles.length > runtimeConfig.maxTrackedFiles) {
      guardrailWarnings.push(
        formatWarning(
          "TRUNCATED_TRACKED_FILES",
          `Tracked file analysis truncated at ${runtimeConfig.maxTrackedFiles} files out of ${trackedFiles.length}.`,
        ),
      );
      trackedFiles = trackedFiles.slice(0, runtimeConfig.maxTrackedFiles);
      truncated = true;
    }

    const whatChanged = diffReader.deriveWhatChanged(trackedFiles);

    if (trackedFiles.length === 0) {
      logInfo("No tracked files changed in this pull request. Skipping impact analysis.");
      setPrimaryOutputs({
        riskLevel: "low",
        impactedAssetCount: 0,
        warningCount: 0,
        changedEntityCount: 0,
        lowConfidenceEntityCount: 0,
        truncated: false,
      });

      const compactPayload = buildCompactImpactJson({
        analysisStatus: "skipped",
        riskLevel: "low",
        changedEntityCount: 0,
        lowConfidenceEntityCount: 0,
        impactedAssetCount: 0,
        warnings: [],
        truncated: false,
        whatChanged: [],
        retryObservability: {},
      });

      await emitStructuredOutputs(runtimeConfig, compactPayload, {
        ...compactPayload,
        summary: "No tracked files changed in this pull request.",
      });

      await writeJobSummary("## Data Impact Analysis\n\nNo tracked files changed in this pull request.");
      return;
    }

    const hydratedFiles = await withLogGroup("Hydrate tracked file content", async () => {
      return diffReader.hydrateTrackedFiles(diff, trackedFiles);
    });

    const extracted = await withLogGroup("Extract changed entities", async () => {
      return extractEntitiesFromFilesWithOptions(hydratedFiles, {
        strictSqlParse: runtimeConfig.strictSqlParse,
        maxEntities: runtimeConfig.maxEntities,
      });
    });

    if (extracted.truncated) {
      truncated = true;
    }

    if (extracted.entities.length === 0) {
      const noEntityComment = [
        "## Data Impact Analysis",
        "",
        ...(whatChanged.length > 0
          ? ["### What Changed", ...whatChanged.map((item) => `- ${item}`), ""]
          : []),
        "### Summary",
        "- Risk: **Low**",
        "- Changed entities: **0**",
        `- Low-confidence entities: **${extracted.lowConfidenceEntityCount}**`,
        "- Impacted downstream assets: **0**",
        `- Truncated analysis: **${truncated ? "yes" : "no"}**`,
        "",
        "No table or column references were extracted from tracked file changes.",
      ].join("\n");

      const commentWarning = await withLogGroup("Publish PR comment", async () => {
        return publishImpactCommentBestEffort(runtimeConfig.githubToken, diff.prNumber, noEntityComment);
      });

      const branchWarnings = [...guardrailWarnings, ...extracted.warnings];
      if (commentWarning) {
        branchWarnings.push(commentWarning);
      }

      const noEntityReport = commentWarning
        ? `${noEntityComment}\n\n### Warnings\n- ${commentWarning}`
        : noEntityComment;

      setPrimaryOutputs({
        riskLevel: "low",
        impactedAssetCount: 0,
        warningCount: branchWarnings.length,
        changedEntityCount: 0,
        lowConfidenceEntityCount: extracted.lowConfidenceEntityCount,
        truncated,
      });

      const branchStatus = computeAnalysisStatus(branchWarnings, truncated);
      const compactPayload = buildCompactImpactJson({
        analysisStatus: branchStatus,
        riskLevel: "low",
        changedEntityCount: 0,
        lowConfidenceEntityCount: extracted.lowConfidenceEntityCount,
        impactedAssetCount: 0,
        warnings: branchWarnings,
        truncated,
        whatChanged,
        retryObservability: {},
      });

      await emitStructuredOutputs(runtimeConfig, compactPayload, {
        ...compactPayload,
        report: noEntityReport,
      });

      await writeJobSummary(noEntityReport);
      return;
    }

    const providerConfig = createProvider(runtimeConfig);
    const traversal = await withLogGroup("Resolve lineage and traverse downstream", async () => {
      return traverseDownstream(providerConfig.provider, extracted.entities, runtimeConfig.maxLineageDepth, {
        maxConcurrency: runtimeConfig.maxConcurrency,
        maxDownstreamAssets: runtimeConfig.maxDownstreamAssets,
      });
    });

    if (traversal.truncated) {
      truncated = true;
    }

    const preSummary = computeImpactSummary({
      changedEntities: extracted.entities,
      lineageResults: traversal.lineageResults,
      warnings: [...guardrailWarnings, ...extracted.warnings, ...traversal.warnings],
      lowConfidenceEntityCount: extracted.lowConfidenceEntityCount,
      criticalAssetTags: runtimeConfig.criticalAssetTags,
      riskThresholds: runtimeConfig.riskThresholds,
      riskWeighting: runtimeConfig.riskWeighting,
      truncated,
      whatChanged,
    });

    const ai = await buildOptionalAiSummary(runtimeConfig, {
      riskLevel: preSummary.riskLevel,
      changedEntityCount: preSummary.changedEntityCount,
      impactedAssetCount: preSummary.impactedAssetCount,
      warnings: preSummary.warnings,
    });

    let finalWarnings = [...preSummary.warnings];
    if (providerConfig.providerNotice) {
      logInfo(providerConfig.providerNotice);
    }
    if (ai.warning) {
      finalWarnings.push(ai.warning);
    }

    let finalSummary = computeImpactSummary({
      changedEntities: extracted.entities,
      lineageResults: traversal.lineageResults,
      warnings: finalWarnings,
      lowConfidenceEntityCount: extracted.lowConfidenceEntityCount,
      criticalAssetTags: runtimeConfig.criticalAssetTags,
      riskThresholds: runtimeConfig.riskThresholds,
      riskWeighting: runtimeConfig.riskWeighting,
      truncated,
      whatChanged,
      ...(ai.summary ? { aiSummary: ai.summary } : {}),
    });

    if (runtimeConfig.failOnMissingMetadata) {
      const missingCount = countWarningCode(finalSummary.warnings, "METADATA_MISSING");
      if (missingCount > 0) {
        throw new Error(`Missing metadata detected for ${missingCount} entities.`);
      }
    }

    const comment = renderImpactComment(finalSummary, runtimeConfig);
    const commentWarning = await withLogGroup("Publish PR comment", async () => {
      return publishImpactCommentBestEffort(runtimeConfig.githubToken, diff.prNumber, comment);
    });

    if (commentWarning) {
      finalWarnings = [...finalWarnings, commentWarning];
      finalSummary = computeImpactSummary({
        changedEntities: extracted.entities,
        lineageResults: traversal.lineageResults,
        warnings: finalWarnings,
        lowConfidenceEntityCount: extracted.lowConfidenceEntityCount,
        criticalAssetTags: runtimeConfig.criticalAssetTags,
        riskThresholds: runtimeConfig.riskThresholds,
        riskWeighting: runtimeConfig.riskWeighting,
        truncated,
        whatChanged,
        ...(ai.summary ? { aiSummary: ai.summary } : {}),
      });
    }

    const detailedReport = renderDetailedImpactReport(finalSummary, runtimeConfig);
    await writeJobSummary(detailedReport);

    setPrimaryOutputs({
      riskLevel: finalSummary.riskLevel,
      impactedAssetCount: finalSummary.impactedAssetCount,
      warningCount: finalSummary.warnings.length,
      changedEntityCount: finalSummary.changedEntityCount,
      lowConfidenceEntityCount: finalSummary.lowConfidenceEntityCount,
      truncated: finalSummary.truncated,
    });

    const analysisStatus = computeAnalysisStatus(finalSummary.warnings, finalSummary.truncated);
    const retryObservability = collectRetryObservability(providerConfig.provider);
    const compactPayload = buildCompactImpactJson({
      analysisStatus,
      riskLevel: finalSummary.riskLevel,
      changedEntityCount: finalSummary.changedEntityCount,
      lowConfidenceEntityCount: finalSummary.lowConfidenceEntityCount,
      impactedAssetCount: finalSummary.impactedAssetCount,
      warnings: finalSummary.warnings,
      truncated: finalSummary.truncated,
      whatChanged: finalSummary.whatChanged,
      retryObservability,
      impactedByType: finalSummary.impactedByType,
    });

    await emitStructuredOutputs(runtimeConfig, compactPayload, {
      ...compactPayload,
      summary: finalSummary,
    });

    logInfo(
      `Impact analysis complete. Risk=${finalSummary.riskLevel} impacted=${finalSummary.impactedAssetCount}.`,
    );
  } catch (error) {
    logError(`Impact analysis failed: ${String(error)}`);
    setPrimaryOutputs({
      riskLevel: "low",
      impactedAssetCount: 0,
      warningCount: 0,
      changedEntityCount: 0,
      lowConfidenceEntityCount: 0,
      truncated: false,
    });

    core.setOutput("analysis-status", "failed");
    core.setOutput("warning-code-counts", "{}");
    core.setOutput("retry-observability", "{}");
    core.setOutput(
      "impact-json",
      JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        analysisStatus: "failed",
        error: String(error),
      }),
    );
    if (config?.impactJsonFile) {
      try {
        const resolvedPath = await writeImpactJsonFile(config.impactJsonFile, {
          version: 1,
          generatedAt: new Date().toISOString(),
          analysisStatus: "failed",
          error: String(error),
        });
        core.setOutput("impact-json-file", resolvedPath);
      } catch {
        core.setOutput("impact-json-file", "");
      }
    } else {
      core.setOutput("impact-json-file", "");
    }
    core.setFailed(String(error));
  }
}

if (require.main === module) {
  void run();
}

export { serializeCompactImpactJsonForOutput };
