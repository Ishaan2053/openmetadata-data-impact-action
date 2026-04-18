const test = require("node:test");
const assert = require("node:assert/strict");
const { traverseDownstream } = require("../dist/action/lineage/traversal.js");

function seedEntity() {
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

test("traverseDownstream truncates when downstream cap is reached", async () => {
  const provider = {
    name: "mock",
    async getDownstream(entity) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [
          {
            id: `${entity.fqn}-a`,
            fqn: `${entity.fqn}.a`,
            name: "A",
            type: "table",
          },
          {
            id: `${entity.fqn}-b`,
            fqn: `${entity.fqn}.b`,
            name: "B",
            type: "view",
          },
        ],
        partial: false,
        warnings: ["rate limit observed (429)"],
      };
    },
  };

  const result = await traverseDownstream(provider, [seedEntity()], 3, {
    maxConcurrency: 4,
    maxDownstreamAssets: 1,
  });

  assert.equal(result.truncated, true);
  assert.ok(result.warnings.some((warning) => warning.includes("truncated")));
  assert.ok(result.effectiveMaxConcurrency <= 4);
});
