(function () {
  const state = { traces: [], details: new Map(), selectedTraceId: null };
  const els = {
    status: document.querySelector("#debugStatus"),
    count: document.querySelector("#debugCount"),
    updatedAt: document.querySelector("#debugUpdatedAt"),
    refreshBtn: document.querySelector("#refreshDebugBtn"),
    traceList: document.querySelector("#debugTraceList"),
    traceTitle: document.querySelector("#debugTraceTitle"),
    logLink: document.querySelector("#debugLogLink"),
    eventList: document.querySelector("#debugEventList"),
  };

  els.refreshBtn.addEventListener("click", refresh);
  refresh();

  async function refresh() {
    setStatus("刷新中");
    const data = await fetchJson("/api/debug/traces");
    state.traces = data.traces ?? [];
    state.details.clear();
    if (!state.traces.some((trace) => trace.traceId === state.selectedTraceId)) {
      state.selectedTraceId = state.traces[0]?.traceId ?? null;
    }
    renderTraceList();
    await loadSelectedTrace();
    setStatus("已同步");
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    const json = await response.json();
    if (!response.ok) throw new Error(json.message || json.error || "读取运行追踪失败");
    return json;
  }

  function renderTraceList() {
    els.count.textContent = `${state.traces.length} traces`;
    els.updatedAt.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    els.traceList.innerHTML = state.traces.length ? state.traces.map(traceButton).join("") : emptyState("暂无运行记录");
    els.traceList.querySelectorAll("[data-trace-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        state.selectedTraceId = button.dataset.traceId;
        renderTraceList();
        await loadSelectedTrace();
      });
    });
  }

  async function loadSelectedTrace() {
    if (!state.selectedTraceId) {
      els.traceTitle.textContent = "未选择 trace";
      els.logLink.removeAttribute("href");
      els.eventList.innerHTML = emptyState("等待后端生成 trace log");
      return;
    }
    setStatus("读取详情");
    if (!state.details.has(state.selectedTraceId)) {
      state.details.set(state.selectedTraceId, await fetchJson(`/api/debug/traces/${encodeURIComponent(state.selectedTraceId)}`));
    }
    renderSelectedTrace(state.details.get(state.selectedTraceId));
  }

  function renderSelectedTrace(trace) {
    els.traceTitle.textContent = trace.traceId;
    els.logLink.href = trace.logUri;
    els.eventList.innerHTML = trace.events.length ? trace.events.map(eventItem).join("") : emptyState("该 trace 暂无事件");
  }

  function traceButton(trace) {
    const active = trace.traceId === state.selectedTraceId ? " active" : "";
    const failed = trace.latestEvent === "stage.fail" ? " failed" : "";
    const stage = trace.latestStageName ?? "unknown";
    const event = trace.latestEvent ?? "no-event";
    return `
      <button class="debug-trace-item${active}${failed}" type="button" data-trace-id="${escapeHtml(trace.traceId)}">
        <strong>${escapeHtml(shortId(trace.traceId))}</strong>
        <span>${escapeHtml(event)} / ${escapeHtml(stage)}</span>
      </button>
    `;
  }

  function eventItem(event) {
    const stageName = event.stageName ?? event.stage ?? "unknown";
    const error = event.errorSummary ?? null;
    const output = event.outputSummary ?? event.summary ?? null;
    return `
      <article class="debug-event-item ${event.event === "stage.fail" ? "fail" : ""}">
        <div class="debug-event-main">
          <strong>${escapeHtml(event.event ?? "event")}</strong>
          <span>${escapeHtml(stageName)}</span>
          <time>${escapeHtml(formatTime(event.createdAt ?? event.time))}</time>
        </div>
        ${summaryBlock("输入", event.inputSummary)}
        ${summaryBlock("输出", output)}
        ${summaryBlock("错误", error)}
      </article>
    `;
  }

  function summaryBlock(label, value) {
    if (!value) return "";
    return `<pre><b>${label}</b> ${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  }

  function emptyState(text) {
    return `<div class="empty-state"><strong>${escapeHtml(text)}</strong><span>从 http://127.0.0.1:5177 上传样例后刷新</span></div>`;
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function shortId(value) {
    return String(value).slice(-8);
  }

  function formatTime(value) {
    if (!value) return "";
    return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})();
