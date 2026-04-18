const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("@actions/core");
const { getConfig } = require("../dist/action/config.js");
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
