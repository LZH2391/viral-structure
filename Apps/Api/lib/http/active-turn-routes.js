const { sendJson } = require("./utils");

async function handleActiveTurnsList(res, handlers = {}, url = null) {
  const runtime = handlers.activeTurnRuntime;
  const activeTurns = runtime?.listActive ? await runtime.listActive({
    ownerType: url?.searchParams?.get("ownerType") || null,
    ownerId: url?.searchParams?.get("ownerId") || null,
  }) : [];
  return sendJson(res, 200, {
    ok: true,
    activeTurns,
    count: activeTurns.length,
  });
}

module.exports = {
  handleActiveTurnsList,
};
