const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("@actions/core");
const { getConfig, OPENMETADATA_MAX_LINEAGE_DEPTH } = require("../dist/action/config.js");
const { ConfigurationError } = require("../dist/action/types.js");

function withMockedInputs(inputMap, boolMap, fn) {
  const originalGetInput = core.getInput;
  const originalGetBooleanInput = core.getBooleanInput;
  const originalSetSecret = core.setSecret;
  const previousGithubToken = process.env.GITHUB_TOKEN;

  core.getInput = (name) => inputMap[name] ?? "";
  core.getBooleanInput = (name) => boolMap[name] ?? false;
  core.setSecret = () => {};
  delete process.env.GITHUB_TOKEN;

  try {
    return fn();
  } finally {
    core.getInput = originalGetInput;
    core.getBooleanInput = originalGetBooleanInput;
    core.setSecret = originalSetSecret;

    if (previousGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousGithubToken;
    }
  }
}

test("getConfig rejects non-https remote endpoint", () => {
  const inputMap = {
    "openmetadata-endpoint": "http://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
  };

  assert.throws(
    () => withMockedInputs(inputMap, {}, () => getConfig()),
    (error) => error instanceof ConfigurationError,
  );
});

test("getConfig allows localhost http endpoint when explicitly enabled", () => {
  const inputMap = {
    "openmetadata-endpoint": "http://localhost:8585",
    "auth-token": "token",
    "github-token": "ghs_test",
  };

  const config = withMockedInputs(inputMap, { "allow-insecure-local-endpoints": true }, () =>
    getConfig(),
  );

  assert.equal(config.openMetadataEndpoint, "http://localhost:8585");
});

test("getConfig parses optional impact-json-file input", () => {
  const inputMap = {
    "openmetadata-endpoint": "https://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
    "impact-json-file": ".artifacts/impact.json",
  };

  const config = withMockedInputs(inputMap, {}, () => getConfig());
  assert.equal(config.impactJsonFile, ".artifacts/impact.json");
});

test("getConfig defaults mcp-endpoint to openmetadata-endpoint/mcp", () => {
  const inputMap = {
    "openmetadata-endpoint": "https://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
  };

  const config = withMockedInputs(inputMap, {}, () => getConfig());
  assert.equal(config.mcpEndpoint, "https://metadata.example.com/mcp");
});

test("getConfig rejects max-lineage-depth above documented OpenMetadata limit", () => {
  const inputMap = {
    "openmetadata-endpoint": "https://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
    "max-lineage-depth": String(OPENMETADATA_MAX_LINEAGE_DEPTH + 1),
  };

  assert.throws(() => withMockedInputs(inputMap, {}, () => getConfig()), (error) => {
    assert.ok(error instanceof ConfigurationError);
    assert.ok(String(error.message).includes("maximum depth of 3 per request"));
    return true;
  });
});

test("getConfig allows max-retries set to zero", () => {
  const inputMap = {
    "openmetadata-endpoint": "https://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
    "max-retries": "0",
  };

  const config = withMockedInputs(inputMap, {}, () => getConfig());
  assert.equal(config.maxRetries, 0);
});

test("getConfig rejects negative max-retries", () => {
  const inputMap = {
    "openmetadata-endpoint": "https://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
    "max-retries": "-1",
  };

  assert.throws(
    () => withMockedInputs(inputMap, {}, () => getConfig()),
    (error) => error instanceof ConfigurationError,
  );
});

test("getConfig applies strict-governance operating mode defaults", () => {
  const inputMap = {
    "openmetadata-endpoint": "https://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
    "operating-mode": "strict-governance",
  };

  const config = withMockedInputs(inputMap, {}, () => getConfig());
  assert.equal(config.operatingMode, "strict-governance");
  assert.equal(config.strictSqlParse, true);
  assert.equal(config.failOnMissingMetadata, true);
});

test("getConfig applies fast operating mode depth preset when defaults are unchanged", () => {
  const inputMap = {
    "openmetadata-endpoint": "https://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
    "operating-mode": "fast",
  };

  const config = withMockedInputs(inputMap, {}, () => getConfig());
  assert.equal(config.operatingMode, "fast");
  assert.equal(config.maxLineageDepth, 2);
});

test("getConfig rejects weighted risk thresholds when high is below medium", () => {
  const inputMap = {
    "openmetadata-endpoint": "https://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
    "risk-weight-medium-threshold": "10",
    "risk-weight-high-threshold": "5",
  };

  assert.throws(
    () => withMockedInputs(inputMap, {}, () => getConfig()),
    (error) => error instanceof ConfigurationError,
  );
});

test("getConfig rejects negative retry wait safeguard values", () => {
  const inputMap = {
    "openmetadata-endpoint": "https://metadata.example.com",
    "auth-token": "token",
    "github-token": "ghs_test",
    "max-total-retry-wait-ms": "-1",
  };

  assert.throws(
    () => withMockedInputs(inputMap, {}, () => getConfig()),
    (error) => error instanceof ConfigurationError,
  );
});
