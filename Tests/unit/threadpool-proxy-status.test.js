const test = require("node:test");
const assert = require("node:assert/strict");
const { createThreadPoolProxy } = require("../../Apps/Api/lib/gateways/threadpool/proxy");

test("threadpool proxy treats missing seed for a ready role as warming, not replenishing", async () => {
  const proxy = createThreadPoolProxy({
    allowedRoles: ["new-reviewer-role"],
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        role: "new-reviewer-role",
        min_idle: 3,
        counts: { idle: 0, leased: 0 },
        seed_thread_id: null,
        ready_for_leases: true,
        recovering: false,
        startup_error: null,
        warming: false,
        replenishing: false,
        warmup_error: null,
        warmup_detail: null,
        can_acquire: false,
        thread_entries: [],
        active_leases: [],
      }),
    }),
  });

  const status = await proxy.roleStatus("new-reviewer-role");
  assert.equal(status.warming, true);
  assert.equal(status.seedMissing, true);
  assert.equal(status.replenishing, false);
  assert.equal(status.warmupDetail, "waiting for seed initialization");
});
