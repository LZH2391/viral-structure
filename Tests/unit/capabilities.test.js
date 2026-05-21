const test = require("node:test");
const assert = require("node:assert/strict");
const { hasXfyunCredentials, readCapabilities } = require("../../Apps/Api/lib/capabilities");

test("xfyun capability requires all three credentials", () => {
  assert.equal(hasXfyunCredentials({}), false);
  assert.equal(hasXfyunCredentials({ XFYUN_APP_ID: "app", XFYUN_API_KEY: "key" }), false);
  assert.equal(hasXfyunCredentials({ XFYUN_APP_ID: "app", XFYUN_API_KEY: "key", XFYUN_API_SECRET: "secret" }), true);
});

test("capability response includes librosa availability", async () => {
  const capabilities = await readCapabilities({});
  assert.equal(typeof capabilities.librosaAvailable, "boolean");
});
