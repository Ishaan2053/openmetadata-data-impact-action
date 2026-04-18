const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OpenMetadataLineageProvider,
} = require("../dist/action/lineage/openmetadataProvider.js");

const endpoint = process.env.OM_INTEGRATION_ENDPOINT;
const token = process.env.OM_INTEGRATION_TOKEN;
const entityFqn = process.env.OM_INTEGRATION_ENTITY_FQN;
const shouldRun = Boolean(endpoint && token && entityFqn);

function createConfig() {
  return {
    openMetadataEndpoint: endpoint,
    authToken: token,
    githubToken: "ghs_test",
    filePatterns: ["**/*.sql"],
    lineageProvider: "api",
    maxLineageDepth: 3,
    maxConcurrency: 4,
    maxTrackedFiles: 200,
    maxEntities: 500,
    maxDownstreamAssets: 2000,
    requestTimeoutMs: 5000,
    maxRetries: 1,
    failOnMissingMetadata: false,
    aiSummaryEnabled: false,
    strictSqlParse: false,
    criticalAssetTags: ["critical"],
    riskThresholds: {
      dashboardHigh: 5,
      pipelineHigh: 4,
      reportHigh: 8,
      totalHigh: 20,
      warningCountHigh: 3,
      warningMinAssetsHigh: 8,
      lowConfidenceHigh: 10,
    },
    allowedEndpointHosts: [],
    allowInsecureLocalEndpoints: false,
    maxCommentAssets: 20,
  };
}

test(
  "OpenMetadata provider resolves lineage against a real endpoint when integration env vars are set",
  { skip: !shouldRun },
  async () => {
    const provider = new OpenMetadataLineageProvider(createConfig());
    const result = await provider.getDownstream(
      {
        sourceKind: "sql",
        sourceFile: "integration.sql",
        rawReference: entityFqn,
        fqn: entityFqn,
        table: entityFqn.split(".").at(-1),
        confidence: "high",
      },
      1,
    );

    assert.equal(typeof result.partial, "boolean");
    assert.ok(Array.isArray(result.nodes));
    assert.ok(Array.isArray(result.warnings));
  },
);
