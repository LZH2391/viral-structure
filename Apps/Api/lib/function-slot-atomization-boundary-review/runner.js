const { createAppServerTurnRunner } = require("../analysis-runtime-v2/appserver-turn-runner");
const { codedError } = require("../function-slot-atomization-analysis/shared");
const { REVIEW_ROLE } = require("./shared");

module.exports = createAppServerTurnRunner({
  role: REVIEW_ROLE,
  codedError,
  collectFailedMessage: "功能槽位原子化边界审查 Agent 结果收集失败",
  collectTimeoutMessage: "功能槽位原子化边界审查 Agent 长时间未返回结果",
});
