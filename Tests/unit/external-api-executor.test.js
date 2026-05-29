const test = require("node:test");
const assert = require("node:assert/strict");
const { createExecutorRegistry } = require("../../Apps/Api/lib/executors/registry");

test("external-api executor calls provider and returns normalized result", async () => {
  const calls = [];
  const registry = createExecutorRegistry();
  const provider = {
    providerName: "test-provider",
    request: async (request, context) => {
      calls.push({ request, context });
      return { ok: true, imageCount: 1 };
    },
  };

  const result = await registry.execute("external-api", {
    provider,
    providerName: "test-provider",
    request: { prompt: "hello" },
    timeoutSeconds: 1,
  }, { traceContext: { traceId: "trace_1" } });

  assert.equal(result.status, "completed");
  assert.equal(result.provider, "test-provider");
  assert.deepEqual(result.result, { ok: true, imageCount: 1 });
  assert.equal(calls[0].request.prompt, "hello");
  assert.equal(calls[0].context.traceContext.traceId, "trace_1");
});

test("external-api executor rejects missing providers", async () => {
  const registry = createExecutorRegistry();

  await assert.rejects(
    () => registry.execute("external-api", { providerName: "missing" }),
    (error) => error.code === "external_api_provider_missing" && error.retryable === false,
  );
});

test("external-api executor normalizes provider failures without leaking paths or bearer tokens", async () => {
  const registry = createExecutorRegistry();
  const provider = {
    providerName: "test-provider",
    request: async () => {
      const error = new Error("failed with Bearer secret-token at C:\\Users\\Administrator\\file.png");
      error.code = "provider_failed";
      error.retryable = true;
      error.providerStatus = 500;
      error.detail = "Bearer secret-token C:\\Users\\Administrator\\file.png";
      throw error;
    },
  };

  await assert.rejects(
    () => registry.execute("external-api", { provider, providerName: "test-provider" }),
    (error) => {
      assert.equal(error.code, "provider_failed");
      assert.equal(error.retryable, true);
      assert.equal(error.debugPayload.providerStatus, 500);
      assert.match(error.debugPayload.detail, /\[redacted\]/);
      assert.match(error.debugPayload.detail, /\[local-path\]/);
      return true;
    },
  );
});
