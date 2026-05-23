const test = require("node:test");
const assert = require("node:assert/strict");
const { hasDoubaoCredentials, readCapabilities } = require("../../Apps/Api/lib/capabilities");

test("doubao capability requires app id and access token", () => {
  assert.equal(hasDoubaoCredentials({}), false);
  assert.equal(hasDoubaoCredentials({ DOUBAO_SAUC_APP_ID: "app" }), false);
  assert.equal(hasDoubaoCredentials({ DOUBAO_SAUC_APP_ID: "app", DOUBAO_SAUC_ACCESS_TOKEN: "token" }), true);
});

test("capability response includes librosa availability", async () => {
  const capabilities = await readCapabilities({});
  assert.equal(typeof capabilities.librosaAvailable, "boolean");
});
