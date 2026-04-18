const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOptionalAiSummary } = require("../dist/action/impact/aiSummary.js");

function createConfig(overrides = {}) {
  return {
    openMetadataEndpoint: "https://metadata.example.com",
    authToken: "token",
    githubToken: "ghs_test",
    filePatterns: ["**/*.sql"],
    lineageProvider: "api",
    maxLineageDepth: 3,
    maxConcurrency: 4,
    maxTrackedFiles: 200,
    maxEntities: 500,
    maxDownstreamAssets: 2000,
    requestTimeoutMs: 500,
    maxRetries: 2,
    failOnMissingMetadata: false,
    aiSummaryEnabled: false,
    strictSqlParse: false,
    criticalAssetTags: ["critical"],
    allowedEndpointHosts: [],
    allowInsecureLocalEndpoints: false,
    maxCommentAssets: 20,
    ...overrides,
  };
}

function impactSeed() {
  return {
    riskLevel: "high",
    changedEntityCount: 3,
    impactedAssetCount: 12,
    warnings: [],
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("AI summary returns deterministic fallback when endpoint is missing", async () => {
  const result = await buildOptionalAiSummary(
    createConfig({ aiSummaryEnabled: true, aiSummaryEndpoint: undefined }),
    impactSeed(),
  );

  assert.ok(result.summary.includes("Risk HIGH"));
  assert.ok(result.warning.includes("deterministic fallback"));
});

test("AI summary returns warning when endpoint responds with non-200", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response(503, { message: "down" });

  try {
    const result = await buildOptionalAiSummary(
      createConfig({ aiSummaryEnabled: true, aiSummaryEndpoint: "https://ai.example.com/summarize" }),
      impactSeed(),
    );

    assert.equal(result.summary, undefined);
    assert.ok(result.warning.includes("status 503"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("AI summary returns summary text on success", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response(200, { summary: "Blast radius is concentrated in BI assets." });

  try {
    const result = await buildOptionalAiSummary(
      createConfig({ aiSummaryEnabled: true, aiSummaryEndpoint: "https://ai.example.com/summarize" }),
      impactSeed(),
    );

    assert.equal(result.summary, "Blast radius is concentrated in BI assets.");
    assert.equal(result.warning, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});
