const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldRetireThreadForContext } = require("../../Apps/Api/lib/analysis-runtime-v2/appserver-turn-runner");

test("thread context policy keeps thread below 0.8 input token ratio", () => {
  const decision = shouldRetireThreadForContext({
    last_token_usage: { input_tokens: 799 },
    model_context_window: 1000,
  });

  assert.equal(decision.retire, false);
});

test("thread context policy retires thread at or above 0.8 input token ratio", () => {
  const decision = shouldRetireThreadForContext({
    last_token_usage: { input_tokens: 800 },
    model_context_window: 1000,
  });

  assert.equal(decision.retire, true);
  assert.equal(decision.reason, "thread_context_threshold_exceeded");
});

test("thread context policy keeps thread when token usage is missing", () => {
  const decision = shouldRetireThreadForContext(null);

  assert.equal(decision.retire, false);
  assert.equal(decision.reason, "thread_context_usage_missing");
});

test("thread context policy keeps thread when model context window is unknown", () => {
  const decision = shouldRetireThreadForContext({
    last_token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model_context_window: 0,
  });

  assert.equal(decision.retire, false);
  assert.equal(decision.reason, "thread_context_usage_missing");
});
