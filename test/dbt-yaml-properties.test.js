const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractEntitiesFromFilesWithOptions,
} = require("../dist/action/parse/index.js");

test("dbt properties yaml files under models directories are parsed for models and sources", () => {
  const result = extractEntitiesFromFilesWithOptions(
    [
      {
        path: "models/marts/properties.yml",
        status: "modified",
        patch: [
          "@@",
          "+models:",
          "+  - name: fct_orders",
          "+    columns:",
          "+      - name: order_id",
          "+sources:",
          "+  - name: raw",
          "+    tables:",
          "+      - name: orders",
        ].join("\n"),
      },
    ],
    {
      strictSqlParse: false,
      maxEntities: 500,
    },
  );

  assert.deepEqual(
    result.entities.map((entity) => entity.fqn).sort(),
    ["fct_orders", "fct_orders.order_id", "raw.orders"],
  );
});

test("dbt yaml parser supports multiple yaml documents in a single file", () => {
  const result = extractEntitiesFromFilesWithOptions(
    [
      {
        path: "models/staging/sources.yaml",
        status: "modified",
        content: [
          "models:",
          "  - name: stg_orders",
          "---",
          "sources:",
          "  - name: ext",
          "    tables:",
          "      - name: customers",
        ].join("\n"),
      },
    ],
    {
      strictSqlParse: false,
      maxEntities: 500,
    },
  );

  assert.deepEqual(
    result.entities.map((entity) => entity.fqn).sort(),
    ["ext.customers", "stg_orders"],
  );
});
