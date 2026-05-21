const test = require("node:test");
const assert = require("node:assert/strict");
const { hasXfyunCredentials } = require("../../Apps/Api/lib/capabilities");

test("xfyun capability requires all three credentials", () => {
  assert.equal(hasXfyunCredentials({}), false);
  assert.equal(hasXfyunCredentials({ XFYUN_APP_ID: "app", XFYUN_API_KEY: "key" }), false);
  assert.equal(hasXfyunCredentials({ XFYUN_APP_ID: "app", XFYUN_API_KEY: "key", XFYUN_API_SECRET: "secret" }), true);
});
