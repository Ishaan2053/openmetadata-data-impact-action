const test = require("node:test");
const assert = require("node:assert/strict");
const { computeImpactSummary } = require("../dist/action/impact/classifier.js");

test("computeImpactSummary marks risk high for critical tagged asset", () => {
  const summary = computeImpactSummary({
    changedEntities: [
      {
        sourceKind: "sql",
        sourceFile: "models/orders.sql",
        fqn: "warehouse.analytics.orders",
        rawReference: "orders",
        table: "orders",
        confidence: "high",
      },
    ],
    lineageResults: [
      {
        sourceEntityFqn: "warehouse.analytics.orders",
        nodes: [
          {
            id: "dash-1",
            fqn: "bi.dashboard.revenue",
            name: "Revenue Dashboard",
            type: "dashboard",
            tags: ["critical"],
          },
        ],
        partial: false,
        warnings: [],
      },
    ],
    warnings: [],
    lowConfidenceEntityCount: 0,
    criticalAssetTags: ["critical"],
    truncated: false,
  });

  assert.equal(summary.riskLevel, "high");
});
