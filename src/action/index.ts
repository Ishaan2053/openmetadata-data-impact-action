import * as core from "@actions/core";
import { getConfig } from "./config";
import { logError, logInfo, withLogGroup } from "./logging";
import { DiffReader } from "./github/diffReader";
import { extractEntitiesFromFiles } from "./parse";
import { LineageProvider } from "./lineage/provider";
import { OpenMetadataLineageProvider } from "./lineage/openmetadataProvider";
import { McpLineageProvider } from "./lineage/mcpProvider";
import { FallbackLineageProvider } from "./lineage/fallbackProvider";
import { traverseDownstream } from "./lineage/traversal";
import { computeImpactSummary } from "./impact/classifier";
import { renderImpactComment } from "./comment/render";
import { upsertImpactComment } from "./comment/publish";
import { buildOptionalAiSummary } from "./impact/aiSummary";

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
  try {
    const config = getConfig();
    const diffReader = new DiffReader(config);

    const diff = await withLogGroup("Read pull request diff", async () => {
      return diffReader.readPullRequestDiff();
    });

    const trackedFiles = diffReader.filterTrackedFiles(diff.files);
    if (trackedFiles.length === 0) {
      logInfo("No tracked files changed in this pull request. Skipping impact analysis.");
      core.setOutput("risk-level", "low");
      core.setOutput("impacted-asset-count", "0");
      core.setOutput("warning-count", "0");
      core.setOutput("changed-entity-count", "0");
      return;
    }

    const hydratedFiles = await withLogGroup("Hydrate tracked file content", async () => {
      return diffReader.hydrateTrackedFiles(diff, trackedFiles);
    });

    const extracted = await withLogGroup("Extract changed entities", async () => {
      return extractEntitiesFromFiles(hydratedFiles);
    });

    if (extracted.entities.length === 0) {
      const noEntityComment = [
        "## Data Impact Analysis",
        "",
        "### Summary",
        "- Risk: **Low**",
        "- Changed entities: **0**",
        "- Impacted downstream assets: **0**",
        "",
        "No table or column references were extracted from tracked file changes.",
      ].join("\n");

      await upsertImpactComment(config.githubToken, diff.prNumber, noEntityComment);
      core.setOutput("risk-level", "low");
      core.setOutput("impacted-asset-count", "0");
      core.setOutput("warning-count", String(extracted.warnings.length));
      core.setOutput("changed-entity-count", "0");
      return;
    }

    const providerConfig = createProvider(config);
    const traversal = await withLogGroup("Resolve lineage and traverse downstream", async () => {
      return traverseDownstream(providerConfig.provider, extracted.entities, config.maxLineageDepth);
    });

    const preSummary = computeImpactSummary({
      changedEntities: extracted.entities,
      lineageResults: traversal.lineageResults,
      warnings: [...extracted.warnings, ...traversal.warnings],
    });

    const ai = await buildOptionalAiSummary(config, {
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
      ...(ai.summary ? { aiSummary: ai.summary } : {}),
    });

    if (config.failOnMissingMetadata) {
      const missingCount = finalSummary.warnings.filter((warning) =>
        warning.toLowerCase().includes("missing metadata"),
      ).length;
      if (missingCount > 0) {
        throw new Error(`Missing metadata detected for ${missingCount} entities.`);
      }
    }

    const comment = renderImpactComment(finalSummary, config);
    await withLogGroup("Publish PR comment", async () => {
      await upsertImpactComment(config.githubToken, diff.prNumber, comment);
    });

    core.setOutput("risk-level", finalSummary.riskLevel);
    core.setOutput("impacted-asset-count", String(finalSummary.impactedAssetCount));
    core.setOutput("warning-count", String(finalSummary.warnings.length));
    core.setOutput("changed-entity-count", String(finalSummary.changedEntityCount));

    logInfo(
      `Impact analysis complete. Risk=${finalSummary.riskLevel} impacted=${finalSummary.impactedAssetCount}.`,
    );
  } catch (error) {
    logError(`Impact analysis failed: ${String(error)}`);
    core.setFailed(String(error));
  }
}

void run();
