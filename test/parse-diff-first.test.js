const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractEntitiesFromFilesWithOptions,
} = require("../dist/action/parse/index.js");

test("entity extraction prefers changed patch text over hydrated full SQL content", () => {
  const result = extractEntitiesFromFilesWithOptions(
    [
      {
        path: "queries/orders.sql",
        status: "modified",
        patch: "@@\n+select * from analytics.orders\n",
        content: "select * from analytics.orders join analytics.customers using (customer_id)\n",
      },
    ],
    {
      strictSqlParse: false,
      maxEntities: 500,
    },
  );

  assert.deepEqual(
    result.entities.map((entity) => entity.fqn).sort(),
    ["analytics.orders"],
  );
});

test("entity extraction prefers changed patch text over hydrated dbt file content", () => {
  const result = extractEntitiesFromFilesWithOptions(
    [
      {
        path: "models/orders.sql",
        status: "modified",
        patch: "@@\n+select * from {{ ref('orders_stg') }}\n",
        content: [
          "select * from {{ ref('orders_stg') }}",
          "join {{ ref('customers_stg') }} using (customer_id)",
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
    ["orders", "orders_stg"],
  );
});

test("entity extraction prefers changed patch text over hydrated schema content", () => {
  const result = extractEntitiesFromFilesWithOptions(
    [
      {
        path: "models/schema.yml",
        status: "modified",
        patch: ["@@", "+models:", "+  - name: orders"].join("\n"),
        content: ["models:", "  - name: orders", "  - name: customers"].join("\n"),
      },
    ],
    {
      strictSqlParse: false,
      maxEntities: 500,
    },
  );

  assert.deepEqual(
    result.entities.map((entity) => entity.fqn).sort(),
    ["orders"],
  );
});
