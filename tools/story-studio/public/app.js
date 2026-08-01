const state = {
  document: null,
  revision: "",
  status: null,
  selectedAct: null,
  editMode: "scenes",
  dirty: false,
  saving: false,
  aiDraft: null,
  aiMode: "generate",
};

const sidebar = document.querySelector("#sidebar");
const workspace = document.querySelector("#workspace");
const app = document.querySelector("#app");
const aiLayer = document.querySelector("#ai-layer");
const toast = document.querySelector("#toast");

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-story-studio": "1",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `请求失败（${response.status}）`);
  return payload;
}

function markDirty() {
  state.dirty = true;
  renderSaveState();
}

function renderSaveState() {
  const button = document.querySelector("#save-button");
  if (!button) return;
  button.disabled = state.saving || !state.dirty;
  button.textContent = state.saving ? "保存中…" : state.dirty ? "保存更改" : "已保存";
  button.classList.toggle("is-dirty", state.dirty);
}

function showToast(message, tone = "success") {
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function actBeatCount(act) {
  return act.scenes.reduce((total, scene) => total + splitBlocks(scene.script).length, 0);
}

function uniqueId(prefix, existing) {
  let number = 1;
  let candidate = `${prefix}-${number}`;
  while (existing.has(candidate)) candidate = `${prefix}-${++number}`;
  return candidate;
}

function splitBlocks(script) {
  const blocks = [];
  let current = [];
  let inFence = false;
  const flush = () => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };
  for (const line of String(script).replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim().startsWith("```")) {
      current.push(line);
      inFence = !inFence;
      if (!inFence) flush();
      continue;
    }
    if (!line.trim() && !inFence) flush();
    else current.push(line);
  }
  flush();
  return blocks;
}

function blockType(block) {
  if (block.startsWith("```")) return "SYSTEM";
  if (/^\*\*Makoto（心声(?:｜[a-z0-9-]+)?）/u.test(block)) return "THOUGHT";
  if (/^\*\*Makoto/u.test(block)) return "MAKOTO";
  if (/^\*\*Noé/u.test(block)) return "NOÉ";
  return "ENVIRONMENT";
}

function renderSidebar() {
  const acts = state.document.acts;
  const totalBlocks = acts.reduce((total, act) => total + actBeatCount(act), 0);
  sidebar.innerHTML = `
    <div class="brand-block">
      <div class="eyebrow">THOUGHTS &amp; STORIES</div>
      <div class="brand-row"><span class="brand-mark"><i></i><b>S/S</b></span><span><strong>Story Studio</strong><small>LOCAL AUTHORING DESK</small></span></div>
      <div class="local-badge"><i></i><span>仅本机 · ${escapeHtml(state.status.host)}</span><b>PRIVATE</b></div>
      <div class="story-telemetry"><span><b>${acts.length}</b> ACTS</span><span><b>${totalBlocks}</b> BLOCKS</span></div>
    </div>
    <button class="overview-link ${state.selectedAct === null ? "is-active" : ""}" data-action="select-overview" ${state.selectedAct === null ? 'aria-current="page"' : ""}>
      <span>文章主旨与大纲</span><small>${acts.length} ACTS</small>
    </button>
    <div class="rail-label">ACT STRUCTURE</div>
    <nav class="act-list" aria-label="Act 列表">
      ${acts.map((act, index) => `
        <button class="act-item ${state.selectedAct === index ? "is-active" : ""}" data-action="select-act" data-index="${index}" ${state.selectedAct === index ? 'aria-current="page"' : ""}>
          <span class="act-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="act-copy"><strong>${escapeHtml(act.title)}</strong><small>${act.scenes.length} scenes · ${actBeatCount(act)} blocks</small></span>
        </button>
      `).join("")}
    </nav>
    <button class="add-act" data-action="add-act">＋ 新建 Act</button>
    <div class="sidebar-footer">
      <code>${escapeHtml(state.status.storyPath)}</code>
      <span class="ai-status ${state.status.aiConfigured ? "is-on" : ""}">${state.status.aiConfigured ? `AI · ${escapeHtml(state.status.model)}` : "AI 未配置"}</span>
    </div>
  `;
}

function renderTopbar(label) {
  return `
    <header class="topbar">
      <div class="topbar-state"><div class="eyebrow">${escapeHtml(label)}</div><div class="file-state"><i class="sync-light"></i>${state.dirty ? "有未保存的本地修改" : "Markdown / Ink / JSON 已同步"}</div></div>
      <div class="topbar-actions">
        <button class="button ghost" data-action="reload">重新载入</button>
        <button id="save-button" class="button primary" data-action="save">已保存</button>
      </div>
    </header>
  `;
}

function renderOverview() {
  workspace.innerHTML = `${renderTopbar("STORY FOUNDATION")}
    <section class="editor-page overview-page">
      <div class="page-heading">
        <span class="section-index">00</span>
        <div><h1>主旨与总体大纲</h1><p>先固定故事想表达什么，再决定每个 Act 承担哪一次叙事推进。</p></div>
      </div>
      <label class="field"><span>作品标题</span><input data-bind="document.title" value="${escapeHtml(state.document.title)}" /></label>
      <div class="foundation-grid">
        <label class="field large"><span>文章主旨 <em>THEME</em></span><textarea data-bind="document.theme">${escapeHtml(state.document.theme)}</textarea></label>
        <label class="field large"><span>故事大纲与 Act 划分 <em>OUTLINE</em></span><textarea data-bind="document.outline">${escapeHtml(state.document.outline)}</textarea></label>
      </div>
      <div class="section-heading"><div><span class="eyebrow">ACT MAP</span><h2>结构总览</h2></div><button class="button ghost" data-action="add-act">＋ 新建 Act</button></div>
      <div class="act-map">
        ${state.document.acts.map((act, index) => `
          <article class="act-map-card" data-action="select-act" data-index="${index}">
            <div class="map-meta"><span class="map-number">ACT ${String(index + 1).padStart(2, "0")}</span><i>${String(actBeatCount(act)).padStart(3, "0")}</i></div>
            <h3>${escapeHtml(act.title)}</h3>
            <p>${escapeHtml(act.summary || "尚未填写这一 Act 的大意。")}</p>
            <footer><span>${act.scenes.length} SCENES</span><span>${actBeatCount(act)} BLOCKS</span><b>→</b></footer>
          </article>
        `).join("")}
      </div>
    </section>`;
}

function renderSceneEditor(scene, sceneIndex, act) {
  const blockCount = splitBlocks(scene.script).length;
  return `<article class="scene-card">
    <header class="scene-header">
      <span class="scene-sequence">SCENE ${String(sceneIndex + 1).padStart(2, "0")} <i>${blockCount} BLOCKS</i></span>
      <div class="scene-actions">
        <button data-action="move-scene" data-direction="-1" data-scene="${sceneIndex}" ${sceneIndex === 0 ? "disabled" : ""}>↑</button>
        <button data-action="move-scene" data-direction="1" data-scene="${sceneIndex}" ${sceneIndex === act.scenes.length - 1 ? "disabled" : ""}>↓</button>
        <button data-action="delete-scene" data-scene="${sceneIndex}">删除</button>
      </div>
    </header>
    <div class="scene-meta">
      <label class="field"><span>Scene 标题</span><input data-bind="scene.title" data-scene="${sceneIndex}" value="${escapeHtml(scene.title)}" /></label>
      <label class="field key-field"><span>稳定标识</span><input data-bind="scene.key" data-scene="${sceneIndex}" value="${escapeHtml(scene.key)}" /></label>
    </div>
    <label class="field script-field"><span>实际脚本 <em>MARKDOWN</em></span><textarea data-bind="scene.script" data-scene="${sceneIndex}">${escapeHtml(scene.script)}</textarea></label>
  </article>`;
}

function renderBeatEditor(scene, sceneIndex) {
  const blocks = splitBlocks(scene.script);
  return `<section class="detail-scene">
    <header><div><span class="eyebrow">${escapeHtml(scene.key)}</span><h3>${escapeHtml(scene.title)}</h3></div><button class="button tiny" data-action="add-block" data-scene="${sceneIndex}">＋ 添加段落</button></header>
    <div class="block-list">
      ${blocks.map((block, blockIndex) => `
        <article class="script-block" data-block-kind="${blockType(block).toLowerCase()}">
          <div class="block-gutter"><span>${String(blockIndex + 1).padStart(2, "0")}</span><b data-type="${blockType(block)}">${blockType(block)}</b></div>
          <textarea data-bind="script-block" data-scene="${sceneIndex}" data-block="${blockIndex}">${escapeHtml(block)}</textarea>
          <div class="block-actions">
            <button data-action="move-block" data-direction="-1" data-scene="${sceneIndex}" data-block="${blockIndex}" ${blockIndex === 0 ? "disabled" : ""}>↑</button>
            <button data-action="move-block" data-direction="1" data-scene="${sceneIndex}" data-block="${blockIndex}" ${blockIndex === blocks.length - 1 ? "disabled" : ""}>↓</button>
            <button data-action="delete-block" data-scene="${sceneIndex}" data-block="${blockIndex}">×</button>
          </div>
        </article>
      `).join("")}
    </div>
  </section>`;
}

function renderAct() {
  const index = state.selectedAct;
  const act = state.document.acts[index];
  if (!act) { state.selectedAct = null; render(); return; }
  const aiDisabled = !state.status.aiConfigured;
  workspace.innerHTML = `${renderTopbar(`ACT ${String(index + 1).padStart(2, "0")} / ${act.id}`)}
    <section class="editor-page act-page">
      <div class="act-title-row">
        <span class="section-index">${String(index + 1).padStart(2, "0")}</span>
        <div class="act-title-fields">
          <label class="field title-field"><span>Act 标题</span><input data-bind="act.title" value="${escapeHtml(act.title)}" /></label>
          <label class="field id-field"><span>稳定 ID</span><input data-bind="act.id" value="${escapeHtml(act.id)}" /></label>
        </div>
      </div>
      <label class="field summary-field"><span>这一 Act 的一段话大意 <em>ACT SUMMARY</em></span><textarea data-bind="act.summary">${escapeHtml(act.summary)}</textarea></label>
      <div class="act-toolbar">
        <div class="mode-switch" role="tablist">
          <button class="${state.editMode === "scenes" ? "is-active" : ""}" data-action="set-mode" data-mode="scenes" role="tab" aria-selected="${state.editMode === "scenes"}">场景脚本</button>
          <button class="${state.editMode === "details" ? "is-active" : ""}" data-action="set-mode" data-mode="details" role="tab" aria-selected="${state.editMode === "details"}">逐段微调</button>
        </div>
        <div class="toolbar-actions">
          <button class="button ghost" data-action="move-act" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑ Act</button>
          <button class="button ghost" data-action="move-act" data-direction="1" ${index === state.document.acts.length - 1 ? "disabled" : ""}>↓ Act</button>
          <button class="button ai" data-action="open-ai" data-mode="generate" ${aiDisabled ? "disabled title=\"请先设置 OPENAI_API_KEY\"" : ""}>生成 Act</button>
          <button class="button ai" data-action="open-ai" data-mode="rewrite" ${aiDisabled ? "disabled title=\"请先设置 OPENAI_API_KEY\"" : ""}>重写 Act</button>
          <button class="button ghost" data-action="add-scene">＋ Scene</button>
          <button class="button danger" data-action="delete-act">删除 Act</button>
        </div>
      </div>
      ${state.editMode === "scenes"
        ? `<div class="scene-stack">${act.scenes.map((scene, sceneIndex) => renderSceneEditor(scene, sceneIndex, act)).join("")}</div>`
        : `<div class="detail-stack">${act.scenes.map((scene, sceneIndex) => renderBeatEditor(scene, sceneIndex)).join("")}</div>`}
    </section>`;
}

function render() {
  renderSidebar();
  if (state.selectedAct === null) renderOverview();
  else renderAct();
  renderSaveState();
  app.setAttribute("aria-busy", "false");
  bindInputs();
}

function bindInputs() {
  document.querySelectorAll("[data-bind]").forEach((element) => {
    element.addEventListener("input", () => {
      const bind = element.dataset.bind;
      const act = state.selectedAct === null ? null : state.document.acts[state.selectedAct];
      if (bind === "document.title") state.document.title = element.value;
      if (bind === "document.theme") state.document.theme = element.value;
      if (bind === "document.outline") state.document.outline = element.value;
      if (bind === "act.title") act.title = element.value;
      if (bind === "act.id") act.id = element.value;
      if (bind === "act.summary") act.summary = element.value;
      if (bind === "scene.title") act.scenes[Number(element.dataset.scene)].title = element.value;
      if (bind === "scene.key") act.scenes[Number(element.dataset.scene)].key = element.value;
      if (bind === "scene.script") act.scenes[Number(element.dataset.scene)].script = element.value;
      if (bind === "script-block") {
        const scene = act.scenes[Number(element.dataset.scene)];
        const blocks = splitBlocks(scene.script);
        blocks[Number(element.dataset.block)] = element.value;
        scene.script = blocks.join("\n\n");
      }
      markDirty();
    });
  });
}

function addAct() {
  const actIds = new Set(state.document.acts.map((act) => act.id));
  const sceneKeys = new Set(state.document.acts.flatMap((act) => act.scenes.map((scene) => scene.key)));
  const id = uniqueId("act", actIds);
  state.document.acts.push({ id, title: "未命名 Act", summary: "", scenes: [{ key: uniqueId(`${id}-scene`, sceneKeys), title: "未命名场景", script: "" }] });
  state.selectedAct = state.document.acts.length - 1;
  state.editMode = "scenes";
  markDirty();
  render();
}

async function save() {
  if (!state.dirty || state.saving) return;
  state.saving = true;
  renderSaveState();
  try {
    const result = await api("/api/document", { method: "PUT", body: JSON.stringify({ document: state.document, revision: state.revision }) });
    state.revision = result.revision;
    state.dirty = false;
    showToast(`已保存，并重新编译 ${result.beatCount} 个故事段落。`);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.saving = false;
    renderSaveState();
  }
}

async function reload() {
  if (state.dirty && !confirm("放弃尚未保存的修改并重新载入吗？")) return;
  const payload = await api("/api/document");
  state.document = payload.document;
  state.revision = payload.revision;
  state.dirty = false;
  render();
}

function openAi(mode) {
  state.aiMode = mode;
  state.aiDraft = null;
  aiLayer.hidden = false;
  aiLayer.innerHTML = `<div class="modal-backdrop" data-action="close-ai"></div>
    <section class="ai-panel" role="dialog" aria-modal="true" aria-label="AI Act 草稿">
      <header><div><span class="eyebrow">${mode === "rewrite" ? "REWRITE COMPLETE ACT" : "GENERATE ACT"}</span><h2>${mode === "rewrite" ? "完整重写这一 Act" : "生成并细化这一 Act"}</h2></div><button data-action="close-ai">×</button></header>
      <p>模型会读取文章主旨、总体大纲及全部 Act，但只返回当前 Act 的候选版本。应用草稿后仍需手动保存。</p>
      <label class="field"><span>本次生成要求</span><textarea id="ai-instruction" placeholder="例如：加强Noé逐步察觉故障的过程；不要增加新人物；保持对话克制。"></textarea></label>
      <div id="ai-result" class="ai-result"><div class="empty-draft">等待生成候选稿</div></div>
      <footer><span>MODEL · ${escapeHtml(state.status.model)}</span><div><button class="button ghost" data-action="close-ai">取消</button><button id="generate-button" class="button ai" data-action="generate-ai">开始生成</button></div></footer>
    </section>`;
}

function renderAiDraft() {
  const result = document.querySelector("#ai-result");
  if (!result || !state.aiDraft) return;
  result.innerHTML = `<label class="field"><span>候选标题</span><input id="draft-title" value="${escapeHtml(state.aiDraft.title)}" /></label>
    <label class="field"><span>候选大意</span><textarea id="draft-summary">${escapeHtml(state.aiDraft.summary)}</textarea></label>
    ${state.aiDraft.scenes.map((scene, index) => `<article class="draft-scene"><strong>Scene ${index + 1} · ${escapeHtml(scene.title)}</strong><textarea data-draft-script="${index}">${escapeHtml(scene.script)}</textarea></article>`).join("")}
    <button class="button primary full" data-action="apply-ai">将候选稿应用到当前 Act</button>`;
  result.querySelector("#draft-title").addEventListener("input", (event) => { state.aiDraft.title = event.target.value; });
  result.querySelector("#draft-summary").addEventListener("input", (event) => { state.aiDraft.summary = event.target.value; });
  result.querySelectorAll("[data-draft-script]").forEach((element) => element.addEventListener("input", () => { state.aiDraft.scenes[Number(element.dataset.draftScript)].script = element.value; }));
}

async function generateAi() {
  const button = document.querySelector("#generate-button");
  button.disabled = true;
  button.textContent = "生成中…";
  try {
    const act = state.document.acts[state.selectedAct];
    const payload = await api("/api/act-draft", {
      method: "POST",
      body: JSON.stringify({ document: state.document, act, mode: state.aiMode, instruction: document.querySelector("#ai-instruction").value }),
    });
    state.aiDraft = payload.act;
    renderAiDraft();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = state.aiDraft ? "重新生成" : "开始生成";
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "select-overview") { state.selectedAct = null; render(); }
  if (action === "select-act") { state.selectedAct = Number(target.dataset.index); state.editMode = "scenes"; render(); }
  if (action === "add-act") addAct();
  if (action === "save") await save();
  if (action === "reload") await reload();
  if (action === "set-mode") { state.editMode = target.dataset.mode; render(); }
  if (action === "add-scene") {
    const act = state.document.acts[state.selectedAct];
    const keys = new Set(state.document.acts.flatMap((item) => item.scenes.map((scene) => scene.key)));
    act.scenes.push({ key: uniqueId(`${act.id}-scene`, keys), title: "未命名场景", script: "" });
    markDirty(); render();
  }
  if (action === "move-act") {
    const from = state.selectedAct;
    const to = from + Number(target.dataset.direction);
    [state.document.acts[from], state.document.acts[to]] = [state.document.acts[to], state.document.acts[from]];
    state.selectedAct = to;
    markDirty(); render();
  }
  if (action === "delete-act" && confirm("确定删除这一 Act 及其全部 Scene 吗？")) {
    state.document.acts.splice(state.selectedAct, 1); state.selectedAct = null; markDirty(); render();
  }
  if (action === "delete-scene") {
    const act = state.document.acts[state.selectedAct];
    if (confirm("确定删除这个 Scene 吗？")) { act.scenes.splice(Number(target.dataset.scene), 1); markDirty(); render(); }
  }
  if (action === "move-scene") {
    const act = state.document.acts[state.selectedAct];
    const from = Number(target.dataset.scene); const to = from + Number(target.dataset.direction);
    [act.scenes[from], act.scenes[to]] = [act.scenes[to], act.scenes[from]]; markDirty(); render();
  }
  if (["add-block", "delete-block", "move-block"].includes(action)) {
    const scene = state.document.acts[state.selectedAct].scenes[Number(target.dataset.scene)];
    const blocks = splitBlocks(scene.script);
    if (action === "add-block") blocks.push("**Makoto：** ");
    if (action === "delete-block") blocks.splice(Number(target.dataset.block), 1);
    if (action === "move-block") {
      const from = Number(target.dataset.block); const to = from + Number(target.dataset.direction);
      [blocks[from], blocks[to]] = [blocks[to], blocks[from]];
    }
    scene.script = blocks.join("\n\n"); markDirty(); render();
  }
  if (action === "open-ai") openAi(target.dataset.mode);
  if (action === "close-ai") { aiLayer.hidden = true; aiLayer.innerHTML = ""; state.aiDraft = null; }
  if (action === "generate-ai") await generateAi();
  if (action === "apply-ai" && state.aiDraft) {
    const currentId = state.document.acts[state.selectedAct].id;
    state.document.acts[state.selectedAct] = { ...state.aiDraft, id: currentId };
    markDirty(); aiLayer.hidden = true; aiLayer.innerHTML = ""; state.aiDraft = null; render();
  }
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); save(); }
});
window.addEventListener("beforeunload", (event) => { if (state.dirty) event.preventDefault(); });

async function boot() {
  try {
    const [status, payload] = await Promise.all([api("/api/status"), api("/api/document")]);
    state.status = status;
    state.document = payload.document;
    state.revision = payload.revision;
    render();
  } catch (error) {
    workspace.innerHTML = `<div class="fatal-state"><h1>无法启动 Story Studio</h1><p>${escapeHtml(error.message)}</p></div>`;
    showToast(error.message, "error");
  }
}

boot();
