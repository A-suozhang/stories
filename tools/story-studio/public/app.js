const state = {
  document: null,
  revision: "",
  status: null,
  selectedAct: null,
  editMode: "scenes",
  dirty: false,
  saving: false,
  aiDraft: null,
  aiMessages: [],
  aiBusy: false,
  aiError: "",
  aiMode: "generate",
  aiInstruction: "",
  formattingScene: null,
  dragActIndex: null,
  dragDropIndex: null,
  dragStartY: 0,
  dragLastY: 0,
  dragPointerOffset: 0,
  dragOriginTop: 0,
  dragCard: null,
  dragPlaceholder: null,
  themeMode: localStorage.getItem("story-studio-theme") || "dark",
  activeStep: "overview",
};

const sidebar = document.querySelector("#sidebar");
const workspace = document.querySelector("#workspace");
const app = document.querySelector("#app");
const aiPanel = document.querySelector("#ai-panel");
const toast = document.querySelector("#toast");
let workflowScrollHandler = null;

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
    <div class="workflow-label">WORKFLOW</div>
    <button class="workflow-overview-card ${state.activeStep === "overview" ? "is-active" : ""}" data-action="select-overview" data-step="overview" aria-label="查看完整工作流">
      <span class="workflow-overview-number">00</span><span><strong>完整工作流</strong><small>主旨 → 大纲 → Act 脚本</small></span>
    </button>
    <nav class="workflow-nav" aria-label="写作流程">
      <a href="#story-theme" class="workflow-step ${state.activeStep === "theme" ? "is-active" : ""}" data-action="navigate-step" data-step="theme" data-target="story-theme"><b>01</b><span>故事主旨</span></a>
      <a href="#story-outline" class="workflow-step ${state.activeStep === "outline" ? "is-active" : ""}" data-action="navigate-step" data-step="outline" data-target="story-outline"><b>02</b><span>故事大纲</span></a>
      <a href="#act-list" class="workflow-step ${state.activeStep === "act" ? "is-active" : ""}" data-action="navigate-step" data-step="act" data-target="act-list"><b>03</b><span>Act 脚本</span></a>
    </nav>
    <div class="workflow-subtree" aria-label="03 Act 列表">
    <div class="rail-label">03 / ACT LIST</div>
    <nav class="act-list" aria-label="Act 列表">
      ${acts.map((act, index) => `
        <button class="act-item ${state.selectedAct === index ? "is-active" : ""}" data-action="select-act" data-index="${index}" ${state.selectedAct === index ? 'aria-current="page"' : ""}>
          <span class="act-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="act-copy"><strong>${escapeHtml(act.title)}</strong><small>${act.scenes.length} scenes · ${actBeatCount(act)} blocks</small></span>
        </button>
      `).join("")}
    </nav>
    </div>
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
        <button class="button ghost theme-toggle" data-action="toggle-theme" aria-label="切换暗黑模式">${state.themeMode === "dark" ? "浅色模式" : "暗黑模式"}</button>
        <button id="save-button" class="button primary" data-action="save">已保存</button>
      </div>
    </header>
  `;
}

function renderOverview() {
  workspace.innerHTML = `${renderTopbar("STORY FOUNDATION")}
    <section class="editor-page overview-page">
      <label id="story-title" class="field story-title-field"><span>作品标题</span><input data-bind="document.title" value="${escapeHtml(state.document.title)}" /></label>
      <section id="story-theme" class="workflow-section">
        <div class="section-heading"><div><span class="workflow-number">STEP 01</span><h2>故事主旨</h2><p>一个文本框，固定作品的核心命题与情绪方向。</p></div></div>
        <label class="field large"><span>文章主旨 <em>THEME</em></span><textarea data-bind="document.theme">${escapeHtml(state.document.theme)}</textarea></label>
      </section>
      <section id="story-outline" class="workflow-section">
        <div class="section-heading"><div><span class="workflow-number">STEP 02</span><h2>故事大纲</h2><p>先用文字整理整体走向，再用下面的 Act 列表管理每个阶段的标题与一句话大意。</p></div><button class="button ghost" data-action="sync-outline">从大纲同步 Act 列表</button></div>
        <label class="field large"><span>故事大纲与 Act 划分 <em>OUTLINE</em></span><textarea data-bind="document.outline">${escapeHtml(state.document.outline)}</textarea></label>
        <div class="outline-act-header"><div><span class="eyebrow">ACT LIST</span><strong>Act 列表</strong><small>这里的标题与大意会同步到 Step 03 的脚本编辑。</small></div><button class="button tiny" data-action="add-outline-act">＋ 添加 Act</button></div>
        <div class="outline-act-list" role="list" aria-label="可编辑的 Act 列表">${state.document.acts.map((act, index) => renderOutlineAct(act, index)).join("")}</div>
      </section>
      <section id="act-list" class="workflow-section">
        <div class="section-heading"><div><span class="workflow-number">STEP 03</span><h2>Act 脚本</h2><p>所有 Act 按顺序直接展开；概要沿用大纲结果，具体 Scene 和段落在这里编辑。</p></div><button class="button ghost" data-action="add-act">＋ 新建 Act</button></div>
        <div class="act-stream" role="list" aria-label="连续 Act 编辑列表">${state.document.acts.map((act, index) => renderActEditor(act, index)).join("")}</div>
      </section>
  </section>`;
  installWorkflowScrollSync();
  bindOutlineActDrag();
}

function renderOutlineAct(act, index) {
  return `<article class="outline-act-card" role="listitem" draggable="true" data-act="${index}">
    <button class="outline-act-handle" type="button" draggable="true" data-drag-handle aria-label="拖动排序 Act ${index + 1}" title="拖动排序">⠿</button>
    <div class="outline-act-number">${String(index + 1).padStart(2, "0")}</div>
    <div class="outline-act-fields">
      <label class="field"><span>Act 名称</span><input data-bind="act.title" data-act="${index}" value="${escapeHtml(act.title)}" /></label>
      <label class="field"><span>一句话大意</span><textarea data-bind="act.summary" data-act="${index}" rows="2" placeholder="用一句话说明这一 Act 推进了什么。">${escapeHtml(act.summary)}</textarea></label>
    </div>
    <div class="outline-act-actions" aria-label="管理 Act ${index + 1}">
      <button class="button tiny danger" data-action="delete-outline-act" data-act="${index}">删除</button>
    </div>
  </article>`;
}

function bindOutlineActDrag() {
  const list = document.querySelector(".outline-act-list");
  if (!list) return;
  const clearDropTargets = () => list.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
  const resetDragVisuals = () => {
    list.querySelectorAll(".outline-act-card").forEach((item) => {
      item.classList.remove("is-dragging", "is-drop-target");
      item.style.removeProperty("--drag-offset");
      item.style.removeProperty("width");
      item.style.removeProperty("left");
      item.style.removeProperty("top");
    });
    list.querySelector(".outline-act-placeholder")?.remove();
  };
  const commitOrder = (orderedIndexes) => {
    const cards = [...list.querySelectorAll(".outline-act-card")];
    const firstRects = new Map(cards.map((item) => [item, item.getBoundingClientRect()]));
    const cardByIndex = new Map(cards.map((item) => [Number(item.dataset.act), item]));
    state.document.acts = orderedIndexes.map((index) => state.document.acts[index]);
    orderedIndexes.forEach((oldIndex, newIndex) => {
      const item = cardByIndex.get(oldIndex);
      if (!item) return;
      list.append(item);
      item.dataset.act = String(newIndex);
      item.querySelector(".outline-act-number").textContent = String(newIndex + 1).padStart(2, "0");
      item.querySelectorAll("[data-act]").forEach((field) => { field.dataset.act = String(newIndex); });
    });
    resetDragVisuals();
    cards.forEach((item) => {
      const first = firstRects.get(item);
      const last = item.getBoundingClientRect();
      const deltaY = first.top - last.top;
      if (Math.abs(deltaY) < 1) return;
      item.style.transition = "none";
      item.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        item.style.transition = "transform .28s cubic-bezier(.2,.8,.2,1)";
        item.style.transform = "";
        window.setTimeout(() => item.style.removeProperty("transition"), 320);
      });
    });
    renderSidebar();
    markDirty();
  };
  const finishPointerDrag = () => {
    const card = state.dragCard;
    const placeholder = state.dragPlaceholder;
    if (!card || !placeholder) return;
    const orderedIndexes = [...list.querySelectorAll(".outline-act-card")].map((item) => Number(item.dataset.act));
    const movedIndex = Number(card.dataset.act);
    const placeholderIndex = [...list.children].indexOf(placeholder);
    placeholder.replaceWith(card);
    const cardPosition = [...list.children].indexOf(card);
    const orderedWithoutMoved = orderedIndexes.filter((index) => index !== movedIndex);
    const insertionIndex = Math.max(0, Math.min(orderedWithoutMoved.length, placeholderIndex > cardPosition ? placeholderIndex - 1 : placeholderIndex));
    orderedWithoutMoved.splice(insertionIndex, 0, movedIndex);
    state.dragCard = null;
    state.dragPlaceholder = null;
    state.dragActIndex = null;
    state.dragDropIndex = null;
    if (orderedIndexes.join(",") !== orderedWithoutMoved.join(",")) {
      commitOrder(orderedWithoutMoved);
    } else resetDragVisuals();
  };
  const finishNativeDrag = (to) => {
    const from = state.dragActIndex;
    state.dragActIndex = null;
    if (from === null || from === to) return;
    const orderedIndexes = [...list.querySelectorAll(".outline-act-card")].map((item) => Number(item.dataset.act));
    const [moved] = orderedIndexes.splice(from, 1);
    orderedIndexes.splice(to, 0, moved);
    commitOrder(orderedIndexes);
  };
  const startPointerDrag = (card, handle, event) => {
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const placeholder = document.createElement("div");
    placeholder.className = "outline-act-placeholder";
    placeholder.style.height = `${rect.height}px`;
    placeholder.style.width = `${rect.width}px`;
    card.after(placeholder);
    state.dragActIndex = Number(card.dataset.act);
    state.dragStartY = event.clientY;
    state.dragLastY = event.clientY;
    state.dragPointerOffset = event.clientY - rect.top;
    state.dragOriginTop = rect.top;
    state.dragCard = card;
    state.dragPlaceholder = placeholder;
    card.classList.add("is-dragging");
    card.style.width = `${rect.width}px`;
    card.style.left = `${rect.left - listRect.left}px`;
    card.style.top = `${rect.top - listRect.top}px`;
    if (event.pointerId !== undefined) handle.setPointerCapture?.(event.pointerId);
  };
  const movePlaceholder = (target) => {
    const cards = [...list.querySelectorAll(".outline-act-card:not(.is-dragging)")];
    const firstRects = new Map(cards.map((item) => [item, item.getBoundingClientRect()]));
    if (target) target.before(state.dragPlaceholder);
    else list.append(state.dragPlaceholder);
    cards.forEach((item) => {
      const first = firstRects.get(item);
      const last = item.getBoundingClientRect();
      const deltaY = first.top - last.top;
      if (Math.abs(deltaY) < 1) return;
      item.style.transition = "none";
      item.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        item.style.transition = "transform .18s cubic-bezier(.2,.8,.2,1)";
        item.style.transform = "";
        window.setTimeout(() => item.style.removeProperty("transition"), 220);
      });
    });
  };
  const moveDraggedCard = (clientY) => {
    const card = state.dragCard;
    if (!card || !state.dragPlaceholder) return;
    const listRect = list.getBoundingClientRect();
    card.style.top = `${clientY - state.dragPointerOffset - listRect.top}px`;
    state.dragLastY = clientY;
    clearDropTargets();
    const cards = [...list.querySelectorAll(".outline-act-card:not(.is-dragging)")];
    const target = cards.find((item) => {
      const rect = item.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    movePlaceholder(target);
    if (target) target.classList.add("is-drop-target");
    else cards.at(-1)?.classList.add("is-drop-target");
    state.dragDropIndex = target ? Number(target.dataset.act) : Number(cards.at(-1)?.dataset.act ?? state.dragActIndex);
  };
  list.querySelectorAll(".outline-act-card").forEach((card) => {
    const handle = card.querySelector("[data-drag-handle]");
    card.addEventListener("dragstart", (event) => {
      state.dragActIndex = Number(card.dataset.act);
      state.dragStartY = event.clientY;
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.dataset.act);
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (state.dragActIndex !== null && Number(card.dataset.act) !== state.dragActIndex) card.classList.add("is-drop-target");
      event.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("dragleave", () => card.classList.remove("is-drop-target"));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      finishNativeDrag(Number(card.dataset.act));
    });
    card.addEventListener("dragend", () => {
      state.dragActIndex = null;
      resetDragVisuals();
    });
    if (handle) {
      handle.addEventListener("pointerdown", (event) => {
        if (state.dragCard) return;
        startPointerDrag(card, handle, event);
      });
      handle.addEventListener("pointermove", (event) => {
        if (state.dragCard !== card || !state.dragPlaceholder) return;
        moveDraggedCard(event.clientY);
      });
      handle.addEventListener("pointerup", (event) => {
        if (state.dragCard !== card) return;
        event.preventDefault();
        finishPointerDrag();
        if (event.pointerId !== undefined) handle.releasePointerCapture?.(event.pointerId);
      });
      handle.addEventListener("pointercancel", () => { state.dragCard = null; state.dragPlaceholder = null; state.dragActIndex = null; state.dragDropIndex = null; resetDragVisuals(); });
    }
    card.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || state.dragCard || event.target.closest("input, textarea, [data-action='delete-outline-act']")) return;
      startPointerDrag(card, card, event);
    });
  });
  list.addEventListener("mousemove", (event) => { if (state.dragCard) moveDraggedCard(event.clientY); });
  list.addEventListener("mouseup", () => { if (state.dragCard) finishPointerDrag(); });
}

function setActiveStep(step) {
  state.activeStep = step;
  sidebar.querySelectorAll("[data-step]").forEach((element) => {
    const active = element.dataset.step === step;
    element.classList.toggle("is-active", active);
    if (active) element.setAttribute("aria-current", "step");
    else element.removeAttribute("aria-current");
  });
}

function setActiveAct(index) {
  // Scrolling only changes which Act is highlighted in the sidebar. Keep
  // `selectedAct` as the explicit navigation target so a click on Act 02/03
  // is not overwritten by the first section that happens to cross the scroll
  // marker during the smooth-scroll animation.
  sidebar.querySelectorAll(".act-item").forEach((element) => {
    const active = index !== null && Number(element.dataset.index) === index;
    element.classList.toggle("is-active", active);
    if (active) element.setAttribute("aria-current", "page");
    else element.removeAttribute("aria-current");
  });
}

function installWorkflowScrollSync() {
  if (workflowScrollHandler) window.removeEventListener("scroll", workflowScrollHandler);
  workflowScrollHandler = () => {
    const actSections = [...document.querySelectorAll(".act-editor-section")];
    const actMarker = window.innerHeight * 0.28;
    const activeAct = actSections.findLast((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top <= actMarker && rect.bottom > actMarker;
    });
    if (activeAct) {
      const actIndex = Number(activeAct.id.replace("act-editor-", ""));
      setActiveAct(actIndex);
      setActiveStep("act");
      return;
    }
    if (actSections.length && document.querySelector(".act-stream-page")) {
      if (state.selectedAct === null) setActiveAct(0);
      setActiveStep("act");
      return;
    }
    if (actSections.length && state.selectedAct !== null) setActiveAct(null);
    if (!document.querySelector("#story-theme")) return;
    const marker = window.innerHeight * 0.32;
    const sections = [
      ["overview", document.querySelector(".workflow-hero-card")],
      ["theme", document.querySelector("#story-theme")],
      ["outline", document.querySelector("#story-outline")],
      ["act", document.querySelector("#act-list")],
    ].filter(([, element]) => element);
    const current = sections.findLast(([, element]) => {
      const rect = element.getBoundingClientRect();
      return rect.top <= marker && rect.bottom > marker;
    });
    setActiveStep(current?.[0] ?? (window.scrollY < 220 ? "overview" : "theme"));
  };
  window.addEventListener("scroll", workflowScrollHandler, { passive: true });
  workflowScrollHandler();
}

function renderSceneEditor(scene, sceneIndex, act, actIndex) {
  const blockCount = splitBlocks(scene.script).length;
  const formatKey = `${actIndex}:${sceneIndex}`;
  const isFormatting = state.formattingScene === formatKey;
  return `<article class="scene-card">
    <header class="scene-header">
      <span class="scene-sequence">SCENE ${String(sceneIndex + 1).padStart(2, "0")} <i>${blockCount} BLOCKS</i></span>
      <div class="scene-actions">
        <button data-action="move-scene" data-act="${actIndex}" data-direction="-1" data-scene="${sceneIndex}" ${sceneIndex === 0 ? "disabled" : ""}>↑</button>
        <button data-action="move-scene" data-act="${actIndex}" data-direction="1" data-scene="${sceneIndex}" ${sceneIndex === act.scenes.length - 1 ? "disabled" : ""}>↓</button>
        <button data-action="delete-scene" data-act="${actIndex}" data-scene="${sceneIndex}">删除</button>
      </div>
    </header>
    <div class="scene-meta">
      <label class="field"><span>Scene 标题</span><input data-bind="scene.title" data-act="${actIndex}" data-scene="${sceneIndex}" value="${escapeHtml(scene.title)}" /></label>
      <label class="field key-field"><span>稳定标识</span><input data-bind="scene.key" data-act="${actIndex}" data-scene="${sceneIndex}" value="${escapeHtml(scene.key)}" /></label>
    </div>
    <label class="field script-field"><span class="script-label-row"><span>实际脚本 <em>MARKDOWN</em></span><button class="format-scene-button" data-action="format-scene" data-act="${actIndex}" data-scene="${sceneIndex}" title="调用本地 Codex 整理为环境脚本格式" aria-label="格式化当前场景脚本" ${isFormatting ? "disabled" : ""}>✦ ${isFormatting ? "格式化中…" : "格式化"}</button></span><textarea data-bind="scene.script" data-act="${actIndex}" data-scene="${sceneIndex}">${escapeHtml(scene.script)}</textarea></label>
  </article>`;
}

function renderBeatEditor(scene, sceneIndex, actIndex) {
  const blocks = splitBlocks(scene.script);
  return `<section class="detail-scene">
    <header><div><span class="eyebrow">${escapeHtml(scene.key)}</span><h3>${escapeHtml(scene.title)}</h3></div><button class="button tiny" data-action="add-block" data-act="${actIndex}" data-scene="${sceneIndex}">＋ 添加段落</button></header>
    <div class="block-list">
      ${blocks.map((block, blockIndex) => `
        <article class="script-block" data-block-kind="${blockType(block).toLowerCase()}">
          <div class="block-gutter"><span>${String(blockIndex + 1).padStart(2, "0")}</span><b data-type="${blockType(block)}">${blockType(block)}</b></div>
          <textarea data-bind="script-block" data-act="${actIndex}" data-scene="${sceneIndex}" data-block="${blockIndex}">${escapeHtml(block)}</textarea>
          <div class="block-actions">
            <button data-action="move-block" data-act="${actIndex}" data-direction="-1" data-scene="${sceneIndex}" data-block="${blockIndex}" ${blockIndex === 0 ? "disabled" : ""}>↑</button>
            <button data-action="move-block" data-act="${actIndex}" data-direction="1" data-scene="${sceneIndex}" data-block="${blockIndex}" ${blockIndex === blocks.length - 1 ? "disabled" : ""}>↓</button>
            <button data-action="delete-block" data-act="${actIndex}" data-scene="${sceneIndex}" data-block="${blockIndex}">×</button>
          </div>
        </article>
      `).join("")}
    </div>
  </section>`;
}

function renderActEditor(act, index) {
  return `<section class="act-editor-section" id="act-editor-${index}">
    <div class="act-title-row">
      <span class="section-index">${String(index + 1).padStart(2, "0")}</span>
      <div class="act-title-fields">
        <label class="field title-field"><span>Act 标题</span><input data-bind="act.title" data-act="${index}" value="${escapeHtml(act.title)}" /></label>
        <label class="field id-field"><span>稳定 ID</span><input data-bind="act.id" data-act="${index}" value="${escapeHtml(act.id)}" /></label>
      </div>
    </div>
    <label class="field summary-field"><span>这一 Act 的一段话大意 <em>来自 02 · 只读</em></span><textarea readonly aria-readonly="true">${escapeHtml(act.summary)}</textarea><small class="readonly-note">概要由故事大纲阶段维护；当前阶段只编辑具体脚本。</small></label>
    <div class="act-toolbar">
      <div class="mode-switch" role="tablist">
        <button class="${state.editMode === "scenes" ? "is-active" : ""}" data-action="set-mode" data-mode="scenes" role="tab" aria-selected="${state.editMode === "scenes"}">场景脚本</button>
        <button class="${state.editMode === "details" ? "is-active" : ""}" data-action="set-mode" data-mode="details" role="tab" aria-selected="${state.editMode === "details"}">逐段微调</button>
      </div>
      <div class="toolbar-actions">
        <button class="button ghost" data-action="move-act" data-act="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑ Act</button>
        <button class="button ghost" data-action="move-act" data-act="${index}" data-direction="1" ${index === state.document.acts.length - 1 ? "disabled" : ""}>↓ Act</button>
        <button class="button ghost" data-action="add-scene" data-act="${index}">＋ Scene</button>
        <button class="button danger" data-action="delete-act" data-act="${index}">删除 Act</button>
      </div>
    </div>
    ${state.editMode === "scenes"
      ? `<div class="scene-stack">${act.scenes.map((scene, sceneIndex) => renderSceneEditor(scene, sceneIndex, act, index)).join("")}</div>`
      : `<div class="detail-stack">${act.scenes.map((scene, sceneIndex) => renderBeatEditor(scene, sceneIndex, index)).join("")}</div>`}
  </section>`;
}

function renderAct() {
  workspace.innerHTML = `${renderTopbar("ACT SCRIPTS")}
    <section class="editor-page act-page act-stream-page">
      <div class="act-stream-heading"><span class="workflow-number">STEP 03</span><h1>Act 脚本</h1><p>所有 Act 按顺序展开；概要来自大纲，具体场景和段落在这里连续编辑。</p></div>
      <div class="act-stream">${state.document.acts.map((act, index) => renderActEditor(act, index)).join("")}</div>
    </section>`;
  installWorkflowScrollSync();
}

function render() {
  renderSidebar();
  if (state.selectedAct === null) renderOverview();
  else renderAct();
  renderAiPanel();
  renderSaveState();
  app.setAttribute("aria-busy", "false");
  bindInputs();
}

function renderAiPanel() {
  const aiDisabled = !state.status.aiConfigured || state.aiBusy;
  aiPanel.innerHTML = `<div class="ai-dock-header"><div><span class="eyebrow">AI WORKBENCH</span><h2>写作协作面板</h2></div><span class="dock-status ${state.status.aiConfigured ? "is-on" : ""}">${state.status.aiConfigured ? escapeHtml(state.status.provider || "AI") : "未配置"}</span></div>
    <div id="ai-history" class="ai-history" aria-live="polite">${state.aiMessages.length ? state.aiMessages.map((message, index) => `<article class="ai-message ${message.role === "user" ? "is-user" : "is-assistant"}"><div class="ai-message-meta"><span>${message.role === "user" ? "你" : "Codex"}</span>${message.role === "assistant" ? `<button class="copy-button" data-action="copy-ai-message" data-message-index="${index}">复制输出</button>` : ""}</div><div class="ai-message-content">${escapeHtml(message.content)}</div></article>`).join("") : `<div class="empty-history">每一轮输入和输出都会保留在这里</div>`}</div>
    <label class="field"><span>新一轮输入</span><textarea id="ai-instruction" ${aiDisabled ? "disabled" : ""} placeholder="描述你想生成、改写或推敲的内容；可以是主旨、大纲、Act 或任意一段文字。">${escapeHtml(state.aiInstruction)}</textarea></label>
    <div class="ai-dock-actions"><button id="generate-button" class="button primary full" data-action="generate-ai" ${aiDisabled ? "disabled" : ""}>${state.aiBusy ? "生成中…" : "发送"}</button></div>
    ${state.aiBusy ? `<div class="ai-feedback is-running">正在请求本地 Codex，完成后候选内容会显示在下方。</div>` : ""}
    ${state.aiError ? `<div class="ai-feedback is-error">${escapeHtml(state.aiError)}</div>` : ""}
    <div id="ai-result" class="ai-result">${state.aiDraft ? "" : `<div class="empty-draft">生成结果会显示在这里</div>`}</div>`;
  const instruction = aiPanel.querySelector("#ai-instruction");
  if (instruction) instruction.addEventListener("input", (event) => { state.aiInstruction = event.target.value; });
  const history = aiPanel.querySelector("#ai-history");
  if (history) history.scrollTop = history.scrollHeight;
  if (state.aiDraft) renderAiDraft();
}

function draftText(act) {
  return [`# ${act.title}`, ...act.scenes.map((scene) => `## ${scene.title}\n${scene.script}`)].join("\n\n");
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch (error) {
    showToast(`复制失败：${error.message}`, "error");
  }
}

function bindInputs() {
  document.querySelectorAll("[data-bind]").forEach((element) => {
    element.addEventListener("input", () => {
      const bind = element.dataset.bind;
      const actIndex = element.dataset.act === undefined ? state.selectedAct : Number(element.dataset.act);
      const act = actIndex === null ? null : state.document.acts[actIndex];
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

function addAct({ stayOnOverview = false } = {}) {
  const actIds = new Set(state.document.acts.map((act) => act.id));
  const sceneKeys = new Set(state.document.acts.flatMap((act) => act.scenes.map((scene) => scene.key)));
  const id = uniqueId("act", actIds);
  state.document.acts.push({ id, title: "未命名 Act", summary: "", scenes: [{ key: uniqueId(`${id}-scene`, sceneKeys), title: "未命名场景", script: "" }] });
  state.selectedAct = stayOnOverview ? null : state.document.acts.length - 1;
  state.activeStep = stayOnOverview ? "overview" : "act";
  state.editMode = "scenes";
  markDirty();
  render();
}

function syncActsFromOutline() {
  const lines = state.document.outline.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = lines.flatMap((line) => {
    const match = line.match(/^(?:[-*]\s*)?(?:Act\s*)?(\d{1,2})\s*[.。:：|｜-]\s*(.+)$/iu);
    if (!match) return [];
    const [title, summary = ""] = match[2].split(/[|｜]/u).map((value) => value.trim());
    return [{ number: Number(match[1]), title, summary }];
  });
  if (!parsed.length) {
    showToast("请把大纲写成每行一个 Act，例如：Act 01｜雨夜与新碗｜建立身份连续性的议题。", "error");
    return;
  }
  const previous = state.document.acts;
  state.document.acts = parsed.map((item, index) => {
    const old = previous[index];
    return {
      id: old?.id ?? `act-${item.number}`,
      title: item.title || old?.title || `Act ${item.number}`,
      summary: item.summary || old?.summary || "",
      scenes: old?.scenes?.length ? old.scenes : [{ key: `act-${item.number}-scene-1`, title: "未命名场景", script: "" }],
    };
  });
  state.selectedAct = null;
  markDirty();
  render();
  showToast(`已从大纲同步 ${parsed.length} 个 Act。`);
}

function toggleTheme() {
  state.themeMode = state.themeMode === "dark" ? "light" : "dark";
  localStorage.setItem("story-studio-theme", state.themeMode);
  document.documentElement.dataset.theme = state.themeMode;
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

function renderAiDraft() {
  const result = aiPanel.querySelector("#ai-result");
  if (!result || !state.aiDraft) return;
  result.innerHTML = `<div class="draft-lock"><span>最新候选输出</span><strong>结果先留在面板中；不会自动改写故事文件</strong><button class="copy-button" data-action="copy-ai-draft">复制完整候选</button></div>
    <label class="field"><span>候选标题</span><input id="draft-title" value="${escapeHtml(state.aiDraft.title)}" /></label>
    ${state.aiDraft.scenes.map((scene, index) => `<article class="draft-scene"><strong>Scene ${index + 1} · ${escapeHtml(scene.title)}</strong><textarea data-draft-script="${index}">${escapeHtml(scene.script)}</textarea></article>`).join("")}
    ${state.selectedAct === null ? `<div class="draft-hint">如需写入 Act，请先主动选择一个 Act，再应用这份候选输出。</div>` : `<button class="button primary full" data-action="apply-ai">应用到当前选中的 Act</button>`}`;
  result.querySelector("#draft-title").addEventListener("input", (event) => { state.aiDraft.title = event.target.value; });
  result.querySelectorAll("[data-draft-script]").forEach((element) => element.addEventListener("input", () => { state.aiDraft.scenes[Number(element.dataset.draftScript)].script = element.value; }));
}

async function generateAi() {
  const button = aiPanel.querySelector("#generate-button");
  if (!button || state.aiBusy) return;
  const instruction = state.aiInstruction.trim();
  if (!instruction) {
    state.aiError = "请先输入这一轮希望 Codex 处理的内容。";
    renderAiPanel();
    return;
  }
  state.aiMessages.push({ role: "user", content: instruction });
  state.aiBusy = true;
  state.aiError = "";
  renderAiPanel();
  try {
    const act = state.selectedAct === null
      ? { id: "workflow-draft", title: "工作流候选 Act", summary: state.document.theme || state.document.outline, scenes: [] }
      : state.document.acts[state.selectedAct];
    const payload = await api("/api/act-draft", {
      method: "POST",
      body: JSON.stringify({ document: state.document, act, mode: state.aiMode, instruction }),
    });
    state.aiDraft = payload.act;
    state.aiMessages.push({ role: "assistant", content: draftText(payload.act) });
    state.aiInstruction = "";
    state.aiBusy = false;
    renderAiPanel();
    renderAiDraft();
  } catch (error) {
    state.aiBusy = false;
    state.aiError = error.message;
    state.aiMessages.push({ role: "assistant", content: `生成失败：${error.message}` });
    state.aiInstruction = "";
    renderAiPanel();
    showToast(error.message, "error");
  }
}

async function formatScene(actIndex, sceneIndex) {
  const act = state.document.acts[actIndex];
  const scene = act?.scenes[sceneIndex];
  if (!act || !scene || !scene.script.trim() || state.formattingScene) {
    if (scene && !scene.script.trim()) showToast("请先在场景脚本框中输入内容。", "error");
    return;
  }
  const key = `${actIndex}:${sceneIndex}`;
  const scrollY = window.scrollY;
  state.formattingScene = key;
  render();
  window.scrollTo({ top: scrollY, behavior: "auto" });
  try {
    const payload = await api("/api/format-scene", {
      method: "POST",
      body: JSON.stringify({ actTitle: act.title, sceneTitle: scene.title, script: scene.script }),
    });
    scene.script = payload.script;
    markDirty();
    showToast("场景脚本已按格式整理。", "success");
  } catch (error) {
    showToast(`格式化失败：${error.message}`, "error");
  } finally {
    state.formattingScene = null;
    render();
    window.scrollTo({ top: scrollY, behavior: "auto" });
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "navigate-step") {
    event.preventDefault();
    if (target.dataset.step === "act" && state.selectedAct === null) {
      state.selectedAct = state.document.acts.length ? 0 : null;
      state.activeStep = "act";
      render();
      document.querySelector("#act-editor-0")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (target.dataset.step === "act" && state.selectedAct !== null) {
      document.querySelector(`#act-editor-${state.selectedAct}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (state.selectedAct !== null) {
      state.selectedAct = null;
      state.activeStep = target.dataset.step === "act" ? "act" : "overview";
      render();
    }
    const destination = document.querySelector(`#${target.dataset.target}`);
    if (destination) {
      if (target.dataset.step !== "act") setActiveStep(target.dataset.step);
      destination.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }
  if (action === "select-overview") { state.selectedAct = null; state.activeStep = "overview"; render(); }
  if (action === "select-act") {
    state.selectedAct = Number(target.dataset.index);
    state.activeStep = "act";
    state.editMode = "scenes";
    render();
    document.querySelector(`#act-editor-${state.selectedAct}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (action === "add-act") addAct();
  if (action === "add-outline-act") addAct({ stayOnOverview: true });
  if (action === "save") await save();
  if (action === "reload") await reload();
  if (action === "set-mode") { state.editMode = target.dataset.mode; render(); }
  if (action === "add-scene") {
    const actIndex = Number(target.dataset.act ?? state.selectedAct);
    const act = state.document.acts[actIndex];
    const keys = new Set(state.document.acts.flatMap((item) => item.scenes.map((scene) => scene.key)));
    act.scenes.push({ key: uniqueId(`${act.id}-scene`, keys), title: "未命名场景", script: "" });
    markDirty(); render();
  }
  if (action === "move-act") {
    const from = Number(target.dataset.act ?? state.selectedAct);
    const to = from + Number(target.dataset.direction);
    [state.document.acts[from], state.document.acts[to]] = [state.document.acts[to], state.document.acts[from]];
    state.selectedAct = to;
    markDirty(); render();
  }
  if (action === "move-outline-act") {
    const from = Number(target.dataset.act);
    const to = from + Number(target.dataset.direction);
    if (to < 0 || to >= state.document.acts.length) return;
    [state.document.acts[from], state.document.acts[to]] = [state.document.acts[to], state.document.acts[from]];
    state.selectedAct = null;
    state.activeStep = "overview";
    markDirty(); render();
  }
  if (action === "delete-act" && confirm("确定删除这一 Act 及其全部 Scene 吗？")) {
    const actIndex = Number(target.dataset.act ?? state.selectedAct);
    state.document.acts.splice(actIndex, 1); state.selectedAct = state.document.acts.length ? Math.min(actIndex, state.document.acts.length - 1) : null; markDirty(); render();
  }
  if (action === "delete-outline-act" && confirm("确定删除这一 Act 及其全部 Scene 吗？")) {
    const actIndex = Number(target.dataset.act);
    state.document.acts.splice(actIndex, 1);
    state.selectedAct = null;
    state.activeStep = "overview";
    markDirty(); render();
  }
  if (action === "delete-scene") {
    const act = state.document.acts[Number(target.dataset.act ?? state.selectedAct)];
    if (confirm("确定删除这个 Scene 吗？")) { act.scenes.splice(Number(target.dataset.scene), 1); markDirty(); render(); }
  }
  if (action === "move-scene") {
    const act = state.document.acts[Number(target.dataset.act ?? state.selectedAct)];
    const from = Number(target.dataset.scene); const to = from + Number(target.dataset.direction);
    [act.scenes[from], act.scenes[to]] = [act.scenes[to], act.scenes[from]]; markDirty(); render();
  }
  if (["add-block", "delete-block", "move-block"].includes(action)) {
    const act = state.document.acts[Number(target.dataset.act ?? state.selectedAct)];
    const scene = act.scenes[Number(target.dataset.scene)];
    const blocks = splitBlocks(scene.script);
    if (action === "add-block") blocks.push("**Makoto：** ");
    if (action === "delete-block") blocks.splice(Number(target.dataset.block), 1);
    if (action === "move-block") {
      const from = Number(target.dataset.block); const to = from + Number(target.dataset.direction);
      [blocks[from], blocks[to]] = [blocks[to], blocks[from]];
    }
    scene.script = blocks.join("\n\n"); markDirty(); render();
  }
  if (action === "set-ai-mode") { state.aiMode = target.dataset.mode; renderAiPanel(); }
  if (action === "copy-ai-message") {
    const message = state.aiMessages[Number(target.dataset.messageIndex)];
    if (message) await copyText(message.content, "已复制这一轮输出。");
  }
  if (action === "copy-ai-draft" && state.aiDraft) {
    await copyText(draftText(state.aiDraft), "已复制完整候选稿。");
  }
  if (action === "sync-outline") syncActsFromOutline();
  if (action === "toggle-theme") toggleTheme();
  if (action === "generate-ai") await generateAi();
  if (action === "format-scene") await formatScene(Number(target.dataset.act), Number(target.dataset.scene));
  if (action === "apply-ai" && state.aiDraft) {
    const currentId = state.document.acts[state.selectedAct].id;
    const currentSummary = state.document.acts[state.selectedAct].summary;
    state.document.acts[state.selectedAct] = { ...state.aiDraft, id: currentId, summary: currentSummary };
    markDirty(); state.aiDraft = null; render();
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
    document.documentElement.dataset.theme = state.themeMode;
    state.document = payload.document;
    state.revision = payload.revision;
    render();
  } catch (error) {
    workspace.innerHTML = `<div class="fatal-state"><h1>无法启动 Story Studio</h1><p>${escapeHtml(error.message)}</p></div>`;
    showToast(error.message, "error");
  }
}

boot();
