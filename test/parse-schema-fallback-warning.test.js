const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractEntitiesFromFilesWithOptions,
} = require("../dist/action/parse/index.js");

test("schema fallback emits PARSE_FAILED warning with low-confidence recovery entities", () => {
  const files = [
    {
      path: "models/schema.yml",
      status: "modified",
      patch: [
        "@@",
        "+models:",
        "+  - name: orders",
        "+    columns: [",
      ].join("\n"),
    },
  ];

  const result = extractEntitiesFromFilesWithOptions(files, {
    strictSqlParse: false,
    maxEntities: 500,
  });

  assert.ok(result.warnings.some((warning) => warning.includes("[PARSE_FAILED]")));
  assert.ok(result.entities.some((entity) => entity.fqn.endsWith("orders")));
});

test("schema fallback ignores nested column and source names when recovering entities", () => {
  const files = [
    {
      path: "models/schema.yml",
      status: "modified",
      patch: [
        "@@",
        "+sources:",
        "+  - name: raw",
        "+    tables:",
        "+      - name: orders",
        "+        columns:",
        "+          - name: order_id",
        "+models:",
        "+  - name: fct_revenue",
        "+    columns:",
        "+      - name: amount",
        "+    tests: [",
      ].join("\n"),
    },
  ];

  const result = extractEntitiesFromFilesWithOptions(files, {
    strictSqlParse: false,
    maxEntities: 500,
  });

  const fqns = result.entities.map((entity) => entity.fqn).sort();
  assert.deepEqual(fqns, ["fct_revenue", "raw.orders"]);
});
