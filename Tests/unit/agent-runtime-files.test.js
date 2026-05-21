const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("embedded agent runtime files exist for appserver and threadpool minimal closure", () => {
  const root = path.resolve(__dirname, "../..");
  const requiredFiles = [
    "Infrastructure/AgentRuntime/agent_runtime/layout.py",
    "Infrastructure/AgentRuntime/agent_runtime/storage.py",
    "Infrastructure/AgentRuntime/agent_runtime/uvicorn_logging.py",
    "Infrastructure/AgentRuntime/agent_runtime/appserver/__init__.py",
    "Infrastructure/AgentRuntime/agent_runtime/appserver/client.py",
    "Infrastructure/AgentRuntime/agent_runtime/appserver/prompt.py",
    "Infrastructure/AgentRuntime/agent_runtime/appserver/transport_base.py",
    "Infrastructure/AgentRuntime/agent_runtime/appserver/transport_stdio.py",
    "Infrastructure/AgentRuntime/agent_runtime/appserver/transport_ws.py",
    "Infrastructure/AgentRuntime/agent_runtime/threadpool/__init__.py",
    "Infrastructure/AgentRuntime/agent_runtime/threadpool/client.py",
    "Infrastructure/AgentRuntime/agent_runtime/threadpool/manager.py",
    "Infrastructure/AgentRuntime/agent_runtime/threadpool/models.py",
    "Infrastructure/AgentRuntime/agent_runtime/threadpool/store.py",
    "Infrastructure/AgentRuntime/scripts/thread_pool_service.py",
    "Docs/appserver-session-client.md",
    "Docs/role-thread-pool.md",
    "requirements.txt",
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  }
});
