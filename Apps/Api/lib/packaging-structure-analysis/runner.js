const { createAppServerTurnRunner } = require("../analysis-runtime-v2/appserver-turn-runner");
const { ROLE, codedError } = require("./shared");

module.exports = createAppServerTurnRunner({
  role: ROLE,
  codedError,
  collectFailedMessage: "包装结构 Agent 结果收集失败",
  collectTimeoutMessage: "包装结构 Agent 长时间未返回结果",
});
