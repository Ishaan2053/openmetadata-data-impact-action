import * as core from "@actions/core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";
import { logError, logInfo, withLogGroup } from "./logging";
import { DiffReader } from "./github/diffReader";
import { extractEntitiesFromFilesWithOptions } from "./parse";
import { LineageProvider } from "./lineage/provider";
import { OpenMetadataLineageProvider } from "./lineage/openmetadataProvider";
import { McpLineageProvider } from "./lineage/mcpProvider";
import { FallbackLineageProvider } from "./lineage/fallbackProvider";
import { traverseDownstream } from "./lineage/traversal";
import { computeImpactSummary } from "./impact/classifier";
import { renderDetailedImpactReport, renderImpactComment } from "./comment/render";
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
  sampleImpactedAssets: Array<{
    type: string;
    fqn: string;
    name: string;
    reasons: string[];
    tags?: string[];
    owners?: string[];
    domain?: string;
  }>;
}

async function writeJobSummary(markdown: string): Promise<void> {
  await core.summary.clear();
  await core.summary.addRaw(markdown, true).write();
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
    impactedByTypeCounts,
    sampleImpactedAssets,
  };
}

async function emitStructuredOutputs(config: ReturnType<typeof getConfig>, compactPayload: CompactImpactJson, fullPayload: unknown): Promise<void> {
  core.setOutput("analysis-status", compactPayload.analysisStatus);
  core.setOutput("warning-code-counts", JSON.stringify(compactPayload.warningCodeCounts));
  core.setOutput("impact-json", JSON.stringify(compactPayload));

  if (config.impactJsonFile) {
    const resolvedPath = await writeImpactJsonFile(config.impactJsonFile, fullPayload);
    core.setOutput("impact-json-file", resolvedPath);
    return;
  }

  core.setOutput("impact-json-file", "");
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

async function run(): Promise<void> {
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
      core.setOutput("risk-level", "low");
      core.setOutput("impacted-asset-count", "0");
      core.setOutput("warning-count", "0");
      core.setOutput("changed-entity-count", "0");
      core.setOutput("low-confidence-entity-count", "0");
      core.setOutput("truncated-analysis", "false");

      const compactPayload = buildCompactImpactJson({
        analysisStatus: "skipped",
        riskLevel: "low",
        changedEntityCount: 0,
        lowConfidenceEntityCount: 0,
        impactedAssetCount: 0,
        warnings: [],
        truncated: false,
        whatChanged: [],
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

      await upsertImpactComment(runtimeConfig.githubToken, diff.prNumber, noEntityComment);
      core.setOutput("risk-level", "low");
      core.setOutput("impacted-asset-count", "0");
      core.setOutput("warning-count", String(extracted.warnings.length + guardrailWarnings.length));
      core.setOutput("changed-entity-count", "0");
      core.setOutput("low-confidence-entity-count", String(extracted.lowConfidenceEntityCount));
      core.setOutput("truncated-analysis", String(truncated));

      const branchWarnings = [...guardrailWarnings, ...extracted.warnings];
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
      });

      await emitStructuredOutputs(runtimeConfig, compactPayload, {
        ...compactPayload,
        report: noEntityComment,
      });

      await writeJobSummary(noEntityComment);
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
      truncated,
      whatChanged,
    });

    const ai = await buildOptionalAiSummary(runtimeConfig, {
      riskLevel: preSummary.riskLevel,
      changedEntityCount: preSummary.changedEntityCount,
      impactedAssetCount: preSummary.impactedAssetCount,
      warnings: preSummary.warnings,
    });

    const finalWarnings = [...preSummary.warnings];
    if (providerConfig.providerNotice) {
      logInfo(providerConfig.providerNotice);
    }
    if (ai.warning) {
      finalWarnings.push(ai.warning);
    }

    const finalSummary = computeImpactSummary({
      changedEntities: extracted.entities,
      lineageResults: traversal.lineageResults,
      warnings: finalWarnings,
      lowConfidenceEntityCount: extracted.lowConfidenceEntityCount,
      criticalAssetTags: runtimeConfig.criticalAssetTags,
      riskThresholds: runtimeConfig.riskThresholds,
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
    const detailedReport = renderDetailedImpactReport(finalSummary, runtimeConfig);
    await withLogGroup("Publish PR comment", async () => {
      await upsertImpactComment(runtimeConfig.githubToken, diff.prNumber, comment);
    });
    await writeJobSummary(detailedReport);

    core.setOutput("risk-level", finalSummary.riskLevel);
    core.setOutput("impacted-asset-count", String(finalSummary.impactedAssetCount));
    core.setOutput("warning-count", String(finalSummary.warnings.length));
    core.setOutput("changed-entity-count", String(finalSummary.changedEntityCount));
    core.setOutput("low-confidence-entity-count", String(finalSummary.lowConfidenceEntityCount));
    core.setOutput("truncated-analysis", String(finalSummary.truncated));

    const analysisStatus = computeAnalysisStatus(finalSummary.warnings, finalSummary.truncated);
    const compactPayload = buildCompactImpactJson({
      analysisStatus,
      riskLevel: finalSummary.riskLevel,
      changedEntityCount: finalSummary.changedEntityCount,
      lowConfidenceEntityCount: finalSummary.lowConfidenceEntityCount,
      impactedAssetCount: finalSummary.impactedAssetCount,
      warnings: finalSummary.warnings,
      truncated: finalSummary.truncated,
      whatChanged: finalSummary.whatChanged,
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
    core.setOutput("analysis-status", "failed");
    core.setOutput("warning-code-counts", "{}");
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

void run();
