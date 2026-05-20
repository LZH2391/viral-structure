(function () {
  const SUMMARY_LIMIT = 420;
  const TRACE_LIST_LIMIT = 20;
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
    const visibleTraces = state.traces.slice(0, TRACE_LIST_LIMIT);
    const hiddenCount = Math.max(0, state.traces.length - visibleTraces.length);
    els.count.textContent = hiddenCount ? `${visibleTraces.length}/${state.traces.length} traces` : `${state.traces.length} traces`;
    els.updatedAt.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    els.traceList.innerHTML = visibleTraces.length ? `${visibleTraces.map(traceButton).join("")}${traceListCropNotice(hiddenCount)}` : emptyState("暂无运行记录");
    els.traceList.querySelectorAll("[data-trace-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        state.selectedTraceId = button.dataset.traceId;
        renderTraceList();
        await loadSelectedTrace();
      });
    });
  }

  function traceListCropNotice(hiddenCount) {
    if (!hiddenCount) return "";
    return `<div class="debug-trace-crop">已隐藏更早的 ${hiddenCount} 条运行记录</div>`;
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
    const text = JSON.stringify(value, null, 2);
    const cropped = cropText(text);
    const full = cropped.isCropped ? `<details><summary>展开完整 ${escapeHtml(label)}</summary><pre>${escapeHtml(text)}</pre></details>` : "";
    return `
      <div class="debug-summary-block">
        <pre><b>${label}</b> ${escapeHtml(cropped.text)}</pre>
        ${full}
      </div>
    `;
  }

  function cropText(text) {
    if (text.length <= SUMMARY_LIMIT) return { text, isCropped: false };
    return { text: `${text.slice(0, SUMMARY_LIMIT)}\n... 已裁切 ${text.length - SUMMARY_LIMIT} 字符`, isCropped: true };
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
