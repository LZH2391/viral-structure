const test = require("node:test");
const assert = require("node:assert/strict");
const { hasDoubaoCredentials, readCapabilities } = require("../../Apps/Api/lib/http/capabilities");

test("doubao capability requires app id and access token", () => {
  assert.equal(hasDoubaoCredentials({}), false);
  assert.equal(hasDoubaoCredentials({ DOUBAO_Api_App_Key: "app" }), false);
  assert.equal(hasDoubaoCredentials({ DOUBAO_Api_App_Key: "app", DOUBAO_Api_Access_Key: "token" }), true);
});

test("capability response includes librosa availability", { timeout: 30000 }, async () => {
  const capabilities = await readCapabilities({});
  assert.equal(typeof capabilities.librosaAvailable, "boolean");
});
