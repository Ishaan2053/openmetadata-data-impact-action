const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OpenMetadataLineageProvider,
} = require("../dist/action/lineage/openmetadataProvider.js");

function createConfig(overrides = {}) {
  return {
    openMetadataEndpoint: "https://metadata.example.com",
    authToken: "token",
    githubToken: "ghs_test",
    filePatterns: ["**/*.sql"],
    lineageProvider: "api",
    maxLineageDepth: 3,
    maxConcurrency: 4,
    maxTrackedFiles: 200,
    maxEntities: 500,
    maxDownstreamAssets: 2000,
    requestTimeoutMs: 500,
    maxRetries: 2,
    failOnMissingMetadata: false,
    aiSummaryEnabled: false,
    strictSqlParse: false,
    criticalAssetTags: ["critical"],
    allowedEndpointHosts: [],
    allowInsecureLocalEndpoints: false,
    maxCommentAssets: 20,
    ...overrides,
  };
}

function createEntity() {
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

function response(status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  };
}

test("OpenMetadata provider retries 429 then succeeds", async () => {
  const originalFetch = global.fetch;
  const originalRandom = Math.random;

  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return response(429, { message: "rate limit" }, { "retry-after": "0" });
    }

    return response(200, {
      downstreamNodes: [
        {
          id: "dash-1",
          fullyQualifiedName: "bi.dashboard.revenue",
          name: "Revenue Dashboard",
          type: "dashboard",
        },
      ],
    });
  };
  Math.random = () => 0;

  try {
    const provider = new OpenMetadataLineageProvider(createConfig({ maxRetries: 2 }));
    const result = await provider.getDownstream(createEntity(), 1);

    assert.equal(calls, 2);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].type, "dashboard");
    assert.equal(result.partial, false);
  } finally {
    global.fetch = originalFetch;
    Math.random = originalRandom;
  }
});

test("OpenMetadata provider caches repeated requests for same entity+depth", async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    return response(200, {
      downstreamNodes: [
        {
          id: "tbl-1",
          fullyQualifiedName: "warehouse.analytics.orders_agg",
          name: "orders_agg",
          type: "table",
        },
      ],
    });
  };

  try {
    const provider = new OpenMetadataLineageProvider(createConfig());
    const entity = createEntity();

    const first = await provider.getDownstream(entity, 1);
    const second = await provider.getDownstream(entity, 1);

    assert.equal(first.nodes.length, 1);
    assert.equal(second.nodes.length, 1);
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenMetadata provider uses documented name-based lineage endpoint only", async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    return response(200, { downstreamNodes: [] });
  };

  try {
    const provider = new OpenMetadataLineageProvider(createConfig({ maxRetries: 0 }));
    const result = await provider.getDownstream(createEntity(), 1);

    assert.equal(result.partial, false);
    assert.equal(requestedUrls.length, 1);
    assert.ok(requestedUrls[0].includes("/api/v1/lineage/table/name/"));
    assert.ok(!requestedUrls[0].includes("/api/v1/lineage?"));
    assert.ok(!requestedUrls[0].includes("entityType=table"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenMetadata provider avoids ambiguous schema/table fallback when fully-qualified parts are present", async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    return response(404, { message: "not found" });
  };

  try {
    const provider = new OpenMetadataLineageProvider(createConfig({ maxRetries: 0 }));
    await provider.getDownstream(createEntity(), 1);

    assert.equal(requestedUrls.length, 1);
    assert.ok(requestedUrls[0].includes("/api/v1/lineage/table/name/warehouse.analytics.orders"));
    assert.ok(!requestedUrls[0].includes("/name/analytics.orders"));
    assert.ok(!requestedUrls[0].includes("/name/orders"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenMetadata provider strips column suffix for table lineage lookup", async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    return response(200, { downstreamNodes: [] });
  };

  try {
    const provider = new OpenMetadataLineageProvider(createConfig({ maxRetries: 0 }));
    await provider.getDownstream(
      {
        ...createEntity(),
        fqn: "warehouse.analytics.orders.order_id",
        column: "order_id",
      },
      1,
    );

    assert.equal(requestedUrls.length, 1);
    assert.ok(requestedUrls[0].includes("/api/v1/lineage/table/name/warehouse.analytics.orders"));
    assert.ok(!requestedUrls[0].includes("orders.order_id"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenMetadata provider returns missing metadata warning when all candidates are 404", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response(404, { message: "not found" });

  try {
    const provider = new OpenMetadataLineageProvider(createConfig({ maxRetries: 0 }));
    const result = await provider.getDownstream(createEntity(), 1);

    assert.equal(result.nodes.length, 0);
    assert.equal(result.partial, true);
    assert.ok(result.warnings.some((warning) => warning.includes("Missing metadata")));
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenMetadata provider marks lineage unavailable on upstream failure without mislabeling metadata missing", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response(503, { message: "service unavailable" });

  try {
    const provider = new OpenMetadataLineageProvider(createConfig({ maxRetries: 0 }));
    const result = await provider.getDownstream(createEntity(), 1);

    assert.equal(result.nodes.length, 0);
    assert.equal(result.partial, true);
    assert.ok(result.warnings.some((warning) => warning.includes("[SERVICE_UNAVAILABLE]")));
    assert.ok(result.warnings.some((warning) => warning.includes("[LINEAGE_UNAVAILABLE]")));
    assert.ok(!result.warnings.some((warning) => warning.includes("[METADATA_MISSING]")));
  } finally {
    global.fetch = originalFetch;
  }
});
