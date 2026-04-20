const test = require("node:test");
const assert = require("node:assert/strict");
const { serializeCompactImpactJsonForOutput } = require("../dist/action/index.js");

function buildLargePayload() {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    analysisStatus: "partial",
    riskLevel: "medium",
    changedEntityCount: 120,
    lowConfidenceEntityCount: 40,
    impactedAssetCount: 1500,
    warningCount: 500,
    warnings: Array.from({ length: 500 }, (_, i) =>
      `[PARSE_FAILED] Extremely verbose warning ${i} ${"x".repeat(200)}`,
    ),
    warningCodeCounts: {
      PARSE_FAILED: 500,
    },
    truncated: true,
    whatChanged: Array.from({ length: 80 }, (_, i) =>
      `models/very_long_path_${i}.sql: +10/-2; ${"detail ".repeat(30)}`,
    ),
    impactedByTypeCounts: {
      dashboard: 30,
      pipeline: 20,
      report: 40,
      table: 500,
      view: 200,
      topic: 100,
      other: 10,
    },
    sampleImpactedAssets: Array.from({ length: 80 }, (_, i) => ({
      type: "table",
      fqn: `warehouse.analytics.very_long_table_name_${i}_${"z".repeat(60)}`,
      name: `very_long_name_${i}_${"n".repeat(80)}`,
      reasons: [`Downstream reason ${i} ${"r".repeat(120)}`],
      tags: ["critical", `tag_${"t".repeat(50)}`],
      owners: ["owner_one", `owner_${"o".repeat(50)}`],
      domain: `domain_${"d".repeat(80)}`,
    })),
  };
}

test("serializeCompactImpactJsonForOutput truncates oversized payloads to fit byte budget", () => {
  const payload = buildLargePayload();
  const maxBytes = 5000;

  const result = serializeCompactImpactJsonForOutput(payload, maxBytes);
  const size = Buffer.byteLength(result.json, "utf8");
  const parsed = JSON.parse(result.json);

  assert.equal(result.truncated, true);
  assert.ok(size <= maxBytes);
  assert.equal(parsed.outputTruncated, true);
  assert.ok(Array.isArray(parsed.warnings));
});

test("serializeCompactImpactJsonForOutput preserves small payloads without truncation", () => {
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    analysisStatus: "success",
    riskLevel: "low",
    changedEntityCount: 1,
    lowConfidenceEntityCount: 0,
    impactedAssetCount: 0,
    warningCount: 0,
    warnings: [],
    warningCodeCounts: {},
    truncated: false,
    whatChanged: ["models/orders.sql: +1/-0"],
    impactedByTypeCounts: {
      dashboard: 0,
      pipeline: 0,
      report: 0,
      table: 0,
      view: 0,
      topic: 0,
      other: 0,
    },
    sampleImpactedAssets: [],
  };

  const result = serializeCompactImpactJsonForOutput(payload, 5000);
  const parsed = JSON.parse(result.json);

  assert.equal(result.truncated, false);
  assert.equal(parsed.outputTruncated, undefined);
  assert.deepEqual(parsed.whatChanged, payload.whatChanged);
});
