const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractEntitiesFromFilesWithOptions,
} = require("../dist/action/parse/index.js");
const { normalizeEntities } = require("../dist/action/parse/normalize.js");

test("dbt-like SQL files include dbt references and SQL table extraction without low-confidence noise", () => {
  const files = [
    {
      path: "models/orders.sql",
      status: "modified",
      patch: [
        "@@",
        "+select o.amount",
        "+from analytics.orders o",
        "+join {{ ref('stg_orders') }} s on s.order_id = o.order_id",
      ].join("\n"),
    },
  ];

  const result = extractEntitiesFromFilesWithOptions(files, {
    strictSqlParse: false,
    maxEntities: 500,
  });

  assert.equal(result.lowConfidenceEntityCount, 0);
  assert.ok(result.entities.some((entity) => entity.sourceKind === "dbt"));
  assert.ok(result.entities.some((entity) => entity.sourceKind === "sql"));
  assert.ok(result.entities.some((entity) => entity.fqn === "analytics.orders"));
  assert.ok(result.entities.some((entity) => entity.fqn.endsWith("orders")));
  assert.ok(result.entities.some((entity) => entity.fqn.endsWith("stg_orders")));
});

test("normalizeEntities prefers dbt source for equal-confidence collisions", () => {
  const normalized = normalizeEntities([
    {
      sourceKind: "sql",
      sourceFile: "models/orders.sql",
      rawReference: "warehouse.analytics.orders",
      table: "orders",
      schema: "analytics",
      database: "warehouse",
      confidence: "high",
    },
    {
      sourceKind: "dbt",
      sourceFile: "models/orders.sql",
      rawReference: "ref(orders)",
      table: "warehouse.analytics.orders",
      confidence: "high",
    },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].fqn, "warehouse.analytics.orders");
  assert.equal(normalized[0].sourceKind, "dbt");
});
