export type SourceKind = "sql" | "dbt" | "schema";
export type EntityConfidence = "high" | "medium" | "low";

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

export interface RiskThresholds {
  dashboardHigh: number;
  pipelineHigh: number;
  reportHigh: number;
  totalHigh: number;
  warningCountHigh: number;
  warningMinAssetsHigh: number;
  lowConfidenceHigh: number;
}

export interface ActionConfig {
  openMetadataEndpoint: string;
  authToken: string;
  githubToken: string;
  filePatterns: string[];
  lineageProvider: LineageProviderMode;
  mcpEndpoint?: string | undefined;
  maxLineageDepth: number;
  maxConcurrency: number;
  maxTrackedFiles: number;
  maxEntities: number;
  maxDownstreamAssets: number;
  requestTimeoutMs: number;
  maxRetries: number;
  failOnMissingMetadata: boolean;
  aiSummaryEnabled: boolean;
  aiSummaryEndpoint?: string | undefined;
  impactJsonFile?: string | undefined;
  strictSqlParse: boolean;
  criticalAssetTags: string[];
  riskThresholds: RiskThresholds;
  allowedEndpointHosts: string[];
  allowInsecureLocalEndpoints: boolean;
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
  confidence: EntityConfidence;
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
  confidence: EntityConfidence;
}

export interface LineageNode {
  id: string;
  fqn: string;
  name: string;
  type: AssetType;
  url?: string | undefined;
  upstreamFrom?: string | undefined;
  tags?: string[] | undefined;
  owners?: string[] | undefined;
  domain?: string | undefined;
  glossaryTerms?: string[] | undefined;
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
  tags?: string[] | undefined;
  owners?: string[] | undefined;
  domain?: string | undefined;
  glossaryTerms?: string[] | undefined;
}

export interface ImpactSummary {
  riskLevel: RiskLevel;
  changedEntityCount: number;
  lowConfidenceEntityCount: number;
  impactedAssetCount: number;
  whatChanged: string[];
  warnings: string[];
  impactedByType: Record<AssetType, ImpactedAsset[]>;
  suggestions: string[];
  aiSummary?: string | undefined;
  truncated: boolean;
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
