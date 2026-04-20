const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OpenMetadataLineageProvider,
} = require("../dist/action/lineage/openmetadataProvider.js");

function createConfig(overrides = {}) {
  return {
    openMetadataEndpoint: "https://metadata.example.com",
    authToken: "token",
    githubToken: "ghs_test",
    operatingMode: "balanced",
    filePatterns: ["**/*.sql"],
    lineageProvider: "api",
    maxLineageDepth: 3,
    maxConcurrency: 4,
    maxTrackedFiles: 200,
    maxEntities: 500,
    maxDownstreamAssets: 2000,
    requestTimeoutMs: 500,
    maxRetries: 0,
    maxRetryWaitMs: 1000,
    maxTotalRetryWaitMs: 2000,
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
    riskWeighting: {
      governance: 0,
      usage: 0,
      dataQuality: 0,
      mediumThreshold: 6,
      highThreshold: 12,
    },
    allowedEndpointHosts: [],
    allowInsecureLocalEndpoints: false,
    maxCommentAssets: 20,
    ...overrides,
  };
}

function createEntity() {
  return {
    sourceKind: "sql",
    sourceFile: "models/orders.sql",
    rawReference: "warehouse.analytics.orders",
    fqn: "warehouse.analytics.orders",
    table: "orders",
    schema: "analytics",
    database: "warehouse",
    confidence: "high",
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: {
      get() {
        return null;
      },
    },
  };
}

const payloadContracts = [
  {
    name: "1.5 style downstreamNodes payload",
    payload: {
      downstreamNodes: [
        {
          id: "dash-15",
          fullyQualifiedName: "bi.dashboard.revenue_15",
          name: "Revenue Dashboard 1.5",
          type: "dashboard",
        },
      ],
    },
    expectedFqn: "bi.dashboard.revenue_15",
    expectedType: "dashboard",
  },
  {
    name: "1.6 style nodes and downstreamEdges by node id",
    payload: {
      nodes: [
        {
          id: "pipe-16",
          fullyQualifiedName: "etl.pipeline.orders_16",
          name: "orders_16",
          entityType: "pipeline",
        },
      ],
      downstreamEdges: [
        {
          toEntity: "pipe-16",
        },
      ],
    },
    expectedFqn: "etl.pipeline.orders_16",
    expectedType: "pipeline",
  },
  {
    name: "1.7+ style downstreamEdges with inline entity object",
    payload: {
      downstreamEdges: [
        {
          toEntity: {
            id: "report-17",
            fullyQualifiedName: "bi.report.finance_17",
            displayName: "Finance Report 1.7",
            type: "report",
          },
        },
      ],
    },
    expectedFqn: "bi.report.finance_17",
    expectedType: "report",
  },
];

for (const contract of payloadContracts) {
  test(`OpenMetadata compatibility matrix: ${contract.name}`, async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => response(200, contract.payload);

    try {
      const provider = new OpenMetadataLineageProvider(createConfig());
      const result = await provider.getDownstream(createEntity(), 1);

      assert.equal(result.partial, false);
      assert.equal(result.warnings.length, 0);
      assert.equal(result.nodes.length, 1);
      assert.equal(result.nodes[0].fqn, contract.expectedFqn);
      assert.equal(result.nodes[0].type, contract.expectedType);
    } finally {
      global.fetch = originalFetch;
    }
  });
}
