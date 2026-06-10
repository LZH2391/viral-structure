const {
  test,
  assert,
  fsPromises,
  os,
  path,
  createAgentConversationStore,
} = require("./server-test.helpers");

test("agent conversation store writes one json file per conversation", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "agent-conversation-store-"));
  try {
    const store = createAgentConversationStore({ filePath: tempRoot });
    await store.createOrUpdateFromSession({
      source: "threadpool-role",
      role: "function-slot-restructure",
      threadId: "thread_a",
    });
    await store.createOrUpdateFromSession({
      source: "threadpool-role",
      role: "function-slot-restructure",
      threadId: "thread_b",
    });

    const files = (await fsPromises.readdir(tempRoot)).filter((name) => name.endsWith(".json")).sort();
    assert.equal(files.length, 2);
    assert.equal(files.includes("conversations.json"), false);

    const listed = await store.list({ role: "function-slot-restructure", status: "active" });
    assert.equal(listed.length, 2);
    assert.deepEqual(new Set(listed.map((conversation) => conversation.threadId)), new Set(["thread_a", "thread_b"]));
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("agent conversation store preserves concurrent writes to one conversation", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "agent-conversation-store-concurrent-"));
  try {
    const store = createAgentConversationStore({ filePath: tempRoot });
    const conversation = await store.createOrUpdateFromSession({
      source: "direct",
      threadId: "thread_a",
    });

    await Promise.all([
      store.recordUserTurn({
        conversationId: conversation.conversationId,
        turnId: "turn_a",
        text: "first",
      }),
      store.recordSystemMessage({
        conversationId: conversation.conversationId,
        text: "system note",
      }),
    ]);

    const saved = await store.get(conversation.conversationId);
    assert.equal(saved.messages.some((message) => message.id === "user-turn_a"), true);
    assert.equal(saved.messages.some((message) => message.role === "system" && message.text === "system note"), true);
    assert.equal(saved.messages.some((message) => message.id === "assistant-turn_a"), true);
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("agent conversation bindThread replace clears stale lease metadata", async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "agent-conversation-store-bind-replace-"));
  try {
    const store = createAgentConversationStore({ filePath: tempRoot });
    const conversation = await store.createOrUpdateFromSession({
      source: "threadpool-role",
      role: "function-slot-restructure",
      threadId: "thread_new",
      parentThreadId: "thread_old",
      leaseId: "lease_new",
      ownerId: "owner_new",
      workspaceRoot: "C:/workspace",
      skillPath: "skill/new.md",
    });

    await store.bindThread({
      conversationId: conversation.conversationId,
      threadId: "thread_old",
      source: "direct",
      replace: true,
    });

    const saved = await store.get(conversation.conversationId);
    assert.equal(saved.threadId, "thread_old");
    assert.equal(saved.parentThreadId, null);
    assert.equal(saved.leaseId, null);
    assert.equal(saved.ownerId, null);
    assert.equal(saved.workspaceRoot, null);
    assert.equal(saved.skillPath, null);
    assert.equal(saved.source, "direct");
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
});
