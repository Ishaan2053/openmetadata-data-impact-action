const test = require("node:test");
const assert = require("node:assert/strict");
const { extractSqlEntities } = require("../dist/action/parse/sqlExtractor.js");

test("strict SQL mode drops low-confidence column heuristic entities", () => {
  const changedFile = {
    path: "models/orders.sql",
    status: "modified",
    patch: "@@\n+select o.amount from analytics.orders o\n",
  };

  const relaxed = extractSqlEntities(changedFile, { strictMode: false });
  const strict = extractSqlEntities(changedFile, { strictMode: true });

  assert.ok(relaxed.some((entity) => entity.column));
  assert.ok(strict.every((entity) => !entity.column));
});
