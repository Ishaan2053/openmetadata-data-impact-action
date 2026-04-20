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
