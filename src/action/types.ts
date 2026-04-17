export type SourceKind = "sql" | "dbt" | "schema";

export type AssetType =
  | "dashboard"
  | "pipeline"
  | "report"
  | "table"
  | "view"
  | "topic"
  | "other";

export type RiskLevel = "high" | "medium" | "low";

export type LineageProviderMode = "api" | "mcp" | "auto";

export interface ActionConfig {
  openMetadataEndpoint: string;
  authToken: string;
  githubToken: string;
  filePatterns: string[];
  lineageProvider: LineageProviderMode;
  mcpEndpoint?: string | undefined;
  maxLineageDepth: number;
  requestTimeoutMs: number;
  maxRetries: number;
  failOnMissingMetadata: boolean;
  aiSummaryEnabled: boolean;
  aiSummaryEndpoint?: string | undefined;
  maxCommentAssets: number;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  previousPath?: string | undefined;
  patch?: string | undefined;
  content?: string | undefined;
}

export interface DiffContext {
  prNumber: number;
  headSha: string;
  baseSha: string;
  files: ChangedFile[];
}

export interface ParsedEntity {
  sourceKind: SourceKind;
  sourceFile: string;
  table: string;
  schema?: string | undefined;
  database?: string | undefined;
  column?: string | undefined;
  rawReference: string;
}

export interface CanonicalEntity {
  sourceKind: SourceKind;
  sourceFile: string;
  fqn: string;
  rawReference: string;
  table: string;
  schema?: string | undefined;
  database?: string | undefined;
  column?: string | undefined;
}

export interface LineageNode {
  id: string;
  fqn: string;
  name: string;
  type: AssetType;
  url?: string | undefined;
  upstreamFrom?: string | undefined;
}

export interface LineageResult {
  sourceEntityFqn: string;
  nodes: LineageNode[];
  partial: boolean;
  warnings: string[];
}

export interface ImpactedAsset {
  id: string;
  fqn: string;
  name: string;
  type: AssetType;
  url?: string | undefined;
  reasons: string[];
}

export interface ImpactSummary {
  riskLevel: RiskLevel;
  changedEntityCount: number;
  impactedAssetCount: number;
  warnings: string[];
  impactedByType: Record<AssetType, ImpactedAsset[]>;
  suggestions: string[];
  aiSummary?: string | undefined;
}

export interface RequestOptions {
  timeoutMs: number;
  retries: number;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class ProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessingError";
  }
}
