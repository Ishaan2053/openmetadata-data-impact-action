const test = require("node:test");
const assert = require("node:assert/strict");
const { FallbackLineageProvider } = require("../dist/action/lineage/fallbackProvider.js");

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

test("FallbackLineageProvider merges fallback nodes when primary result is partial", async () => {
  const primary = {
    name: "primary",
    async getDownstream(entity) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [
          {
            id: "dash-1",
            fqn: "bi.dashboard.revenue",
            name: "Revenue Dashboard",
            type: "dashboard",
            tags: ["critical"],
          },
        ],
        partial: true,
        warnings: ["primary lineage is partial"],
      };
    },
  };

  const fallback = {
    name: "fallback",
    async getDownstream(entity) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [
          {
            id: "pipe-1",
            fqn: "etl.pipeline.orders_daily",
            name: "orders_daily",
            type: "pipeline",
            owners: ["data-platform"],
          },
        ],
        partial: false,
        warnings: [],
      };
    },
  };

  const provider = new FallbackLineageProvider(primary, fallback);
  const result = await provider.getDownstream(seedEntity(), 1);

  assert.equal(result.nodes.length, 2);
  assert.ok(result.nodes.some((node) => node.fqn === "bi.dashboard.revenue"));
  assert.ok(result.nodes.some((node) => node.fqn === "etl.pipeline.orders_daily"));
  assert.equal(result.partial, true);
  assert.ok(
    result.warnings.some(
      (warning) =>
        warning.includes("[AUTO_FALLBACK_USED]") &&
        warning.includes("Auto fallback used fallback"),
    ),
  );
});

test("FallbackLineageProvider does not call fallback when primary is complete", async () => {
  let fallbackCalls = 0;

  const primary = {
    name: "primary",
    async getDownstream(entity) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [
          {
            id: "tbl-1",
            fqn: "warehouse.analytics.orders_agg",
            name: "orders_agg",
            type: "table",
          },
        ],
        partial: false,
        warnings: [],
      };
    },
  };

  const fallback = {
    name: "fallback",
    async getDownstream() {
      fallbackCalls += 1;
      return {
        sourceEntityFqn: "warehouse.analytics.orders",
        nodes: [],
        partial: false,
        warnings: [],
      };
    },
  };

  const provider = new FallbackLineageProvider(primary, fallback);
  const result = await provider.getDownstream(seedEntity(), 1);

  assert.equal(result.nodes.length, 1);
  assert.equal(fallbackCalls, 0);
});

test("FallbackLineageProvider merges metadata for duplicate node FQNs", async () => {
  const primary = {
    name: "primary",
    async getDownstream(entity) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [
          {
            id: "dash-1",
            fqn: "bi.dashboard.revenue",
            name: "Revenue Dashboard",
            type: "dashboard",
            tags: ["critical"],
          },
        ],
        partial: true,
        warnings: ["primary partial"],
      };
    },
  };

  const fallback = {
    name: "fallback",
    async getDownstream(entity) {
      return {
        sourceEntityFqn: entity.fqn,
        nodes: [
          {
            id: "dash-1",
            fqn: "bi.dashboard.revenue",
            name: "Revenue Dashboard",
            type: "dashboard",
            owners: ["finance-team"],
          },
        ],
        partial: false,
        warnings: [],
      };
    },
  };

  const provider = new FallbackLineageProvider(primary, fallback);
  const result = await provider.getDownstream(seedEntity(), 1);

  assert.equal(result.nodes.length, 1);
  assert.deepEqual(result.nodes[0].tags, ["critical"]);
  assert.deepEqual(result.nodes[0].owners, ["finance-team"]);
});
