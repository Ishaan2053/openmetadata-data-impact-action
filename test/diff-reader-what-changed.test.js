const test = require("node:test");
const assert = require("node:assert/strict");
const { DiffReader } = require("../dist/action/github/diffReader.js");

function createConfig() {
  return {
    openMetadataEndpoint: "https://metadata.example.com",
    authToken: "token",
    githubToken: "ghs_test",
    filePatterns: ["**/*.sql", "**/*.yml"],
    lineageProvider: "api",
    maxLineageDepth: 3,
    maxConcurrency: 4,
    maxTrackedFiles: 200,
    maxEntities: 500,
    maxDownstreamAssets: 2000,
    requestTimeoutMs: 1000,
    maxRetries: 2,
    failOnMissingMetadata: false,
    aiSummaryEnabled: false,
    strictSqlParse: false,
    criticalAssetTags: ["critical"],
    allowedEndpointHosts: [],
    allowInsecureLocalEndpoints: false,
    maxCommentAssets: 20,
  };
}

test("deriveWhatChanged returns concise summaries and overflow item", () => {
  const reader = new DiffReader(createConfig());
  const files = [
    {
      path: "models/orders.sql",
      status: "modified",
      patch: "@@\n+select * from analytics.orders\n-from raw.orders\n",
    },
    {
      path: "models/customers.sql",
      status: "added",
      patch: "@@\n+select id, email from analytics.customers\n",
    },
    {
      path: "models/schema.yml",
      status: "modified",
      patch: "@@\n+models:\n",
    },
  ];

  const summary = reader.deriveWhatChanged(files, 2);

  assert.equal(summary.length, 3);
  assert.match(summary[0], /models\/orders\.sql: \+1\/-1/);
  assert.match(summary[1], /models\/customers\.sql: \+1\/-0/);
  assert.equal(summary[2], "... and 1 additional tracked file changes.");
});
