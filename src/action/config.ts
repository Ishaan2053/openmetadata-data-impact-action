import * as core from "@actions/core";
import {
  ActionConfig,
  ConfigurationError,
  LineageProviderMode,
} from "./types";

const DEFAULT_PATTERNS = [
  "**/*.sql",
  "**/models/**/*.sql",
  "**/models/**/*.yml",
  "**/models/**/*.yaml",
  "**/schema.yml",
  "**/schema.yaml",
  "**/dbt_project.yml",
  "**/dbt_project.yaml",
];

function parsePositiveInt(name: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer. Received: ${raw}`);
  }
  return value;
}

function parsePatterns(raw: string): string[] {
  const values = raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return values.length > 0 ? values : DEFAULT_PATTERNS;
}

function parseProviderMode(raw: string): LineageProviderMode {
  const mode = raw.trim().toLowerCase();
  if (mode === "api" || mode === "mcp" || mode === "auto") {
    return mode;
  }
  throw new ConfigurationError(
    `lineage-provider must be one of api|mcp|auto. Received: ${raw}`,
  );
}

export function getConfig(): ActionConfig {
  const openMetadataEndpoint = core.getInput("openmetadata-endpoint", {
    required: true,
  });
  const authToken = core.getInput("auth-token", { required: true });
  const githubToken =
    core.getInput("github-token").trim() || process.env.GITHUB_TOKEN?.trim() || "";
  const filePatterns = parsePatterns(core.getInput("file-patterns"));
  const lineageProvider = parseProviderMode(core.getInput("lineage-provider") || "auto");
  const mcpEndpointRaw = core.getInput("mcp-endpoint").trim();
  const aiSummaryEndpointRaw = core.getInput("ai-summary-endpoint").trim();

  const config: ActionConfig = {
    openMetadataEndpoint: openMetadataEndpoint.replace(/\/$/, ""),
    authToken,
    githubToken,
    filePatterns,
    lineageProvider,
    maxLineageDepth: parsePositiveInt(
      "max-lineage-depth",
      core.getInput("max-lineage-depth") || "3",
    ),
    requestTimeoutMs: parsePositiveInt(
      "request-timeout-ms",
      core.getInput("request-timeout-ms") || "15000",
    ),
    maxRetries: parsePositiveInt("max-retries", core.getInput("max-retries") || "3"),
    failOnMissingMetadata: core.getBooleanInput("fail-on-missing-metadata"),
    aiSummaryEnabled: core.getBooleanInput("ai-summary-enabled"),
    maxCommentAssets: parsePositiveInt(
      "max-comment-assets",
      core.getInput("max-comment-assets") || "20",
    ),
  };

  if (mcpEndpointRaw.length > 0) {
    config.mcpEndpoint = mcpEndpointRaw;
  }

  if (aiSummaryEndpointRaw.length > 0) {
    config.aiSummaryEndpoint = aiSummaryEndpointRaw;
  }

  if (!config.openMetadataEndpoint.startsWith("http")) {
    throw new ConfigurationError("openmetadata-endpoint must be an http(s) URL.");
  }

  if (githubToken.length === 0) {
    throw new ConfigurationError(
      "github-token input is required when GITHUB_TOKEN is not present in the environment.",
    );
  }

  return config;
}
