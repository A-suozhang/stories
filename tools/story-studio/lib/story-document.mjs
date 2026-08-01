const ACT_PATTERN = /^## Act: ([a-z0-9][a-z0-9-]*)｜(.+)$/u;
const SCENE_PATTERN = /^### Scene: ([a-z0-9][a-z0-9-]*)｜(.+)$/u;

function cleanBlock(lines) {
  return lines.join("\n").trim();
}

export function validateStoryDocument(document) {
  if (!document || typeof document !== "object") throw new Error("故事文档必须是对象");
  for (const field of ["title", "theme", "outline"]) {
    if (typeof document[field] !== "string") throw new Error(`${field} 必须是文字`);
  }
  if (!document.title.trim()) throw new Error("故事标题不能为空");
  if (!Array.isArray(document.acts)) throw new Error("acts 必须是数组");
  if (document.acts.length > 30) throw new Error("Act 数量不能超过 30");

  const actIds = new Set();
  const sceneKeys = new Set();
  for (const [actIndex, act] of document.acts.entries()) {
    if (!act || typeof act !== "object") throw new Error(`Act ${actIndex + 1} 格式错误`);
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(act.id ?? "")) throw new Error(`Act ${actIndex + 1} 的 ID 无效`);
    if (actIds.has(act.id)) throw new Error(`Act ID 重复：${act.id}`);
    actIds.add(act.id);
    if (typeof act.title !== "string" || !act.title.trim()) throw new Error(`Act ${actIndex + 1} 缺少标题`);
    if (typeof act.summary !== "string") throw new Error(`Act ${actIndex + 1} 的大意必须是文字`);
    if (!Array.isArray(act.scenes)) throw new Error(`Act ${actIndex + 1} 的 scenes 必须是数组`);
    if (act.scenes.length > 40) throw new Error(`Act ${actIndex + 1} 的 Scene 数量不能超过 40`);
    for (const [sceneIndex, scene] of act.scenes.entries()) {
      if (!scene || typeof scene !== "object") throw new Error(`Act ${actIndex + 1} / Scene ${sceneIndex + 1} 格式错误`);
      if (!/^[a-z0-9][a-z0-9-]*$/u.test(scene.key ?? "")) throw new Error(`Scene ${sceneIndex + 1} 的 key 无效`);
      if (sceneKeys.has(scene.key)) throw new Error(`Scene key 重复：${scene.key}`);
      sceneKeys.add(scene.key);
      if (typeof scene.title !== "string" || !scene.title.trim()) throw new Error(`Scene ${scene.key} 缺少标题`);
      if (typeof scene.script !== "string") throw new Error(`Scene ${scene.key} 的脚本必须是文字`);
    }
  }
  return document;
}

export function parseStoryDocument(markdown) {
  const lines = String(markdown).replace(/\r\n?/gu, "\n").split("\n");
  const document = { title: "", theme: "", outline: "", acts: [] };
  let section = null;
  let activeAct = null;
  let activeScene = null;
  let buffer = [];

  const flush = () => {
    const value = cleanBlock(buffer);
    if (section === "theme") document.theme = value;
    else if (section === "outline") document.outline = value;
    else if (section === "summary" && activeAct) activeAct.summary = value;
    else if (section === "scene" && activeScene) activeScene.script = value;
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("# ") && !document.title) {
      flush();
      document.title = line.slice(2).trim();
      section = null;
      continue;
    }
    if (line === "## 文章主旨") {
      flush();
      section = "theme";
      continue;
    }
    if (line === "## 故事大纲") {
      flush();
      section = "outline";
      continue;
    }
    const actMatch = line.match(ACT_PATTERN);
    if (actMatch) {
      flush();
      activeAct = { id: actMatch[1], title: actMatch[2].trim(), summary: "", scenes: [] };
      document.acts.push(activeAct);
      activeScene = null;
      section = null;
      continue;
    }
    if (line === "### 大意") {
      flush();
      if (!activeAct) throw new Error("“### 大意”必须位于 Act 内");
      activeScene = null;
      section = "summary";
      continue;
    }
    const sceneMatch = line.match(SCENE_PATTERN);
    if (sceneMatch) {
      flush();
      if (!activeAct) throw new Error("Scene 必须位于 Act 内");
      activeScene = { key: sceneMatch[1], title: sceneMatch[2].trim(), script: "" };
      activeAct.scenes.push(activeScene);
      section = "scene";
      continue;
    }
    if (section) buffer.push(line);
  }
  flush();
  return validateStoryDocument(document);
}

export function serializeStoryDocument(input) {
  const document = validateStoryDocument(structuredClone(input));
  const lines = [
    "<!-- story-studio: 1 -->",
    `# ${document.title.trim()}`,
    "",
    "## 文章主旨",
    "",
    document.theme.trim(),
    "",
    "## 故事大纲",
    "",
    document.outline.trim(),
    "",
  ];
  for (const act of document.acts) {
    lines.push(`## Act: ${act.id}｜${act.title.trim()}`, "", "### 大意", "", act.summary.trim(), "");
    for (const scene of act.scenes) {
      lines.push(`### Scene: ${scene.key}｜${scene.title.trim()}`, "", scene.script.trim(), "");
    }
  }
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

export function parseSceneScript(script, scene) {
  const lines = String(script).replace(/\r\n?/gu, "\n").split("\n");
  const beats = [];
  let inCode = false;
  let paragraph = [];

  const flushParagraph = () => {
    const raw = paragraph.join(" ").trim();
    paragraph = [];
    if (!raw) return;
    const dialogue = raw.match(/^\*\*(Makoto|Noé)(（心声(?:｜([a-z0-9-]+))?）)?：\*\*\s*(.+)$/u);
    if (dialogue) {
      beats.push({
        text: dialogue[4],
        speaker: dialogue[1] === "Makoto" ? "makoto" : "noe",
        className: dialogue[2] ? "thought" : "character",
        persona: dialogue[3] ?? "",
        scene,
      });
      return;
    }
    const environment = raw.match(/^\*(.+)\*$/u);
    beats.push({ text: environment ? environment[1] : raw, speaker: "narration", className: "environment", scene });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      flushParagraph();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      if (line) beats.push({ text: line, speaker: "system", className: "system", scene });
      continue;
    }
    if (!line) flushParagraph();
    else paragraph.push(line);
  }
  flushParagraph();
  if (inCode) throw new Error(`Scene ${scene} 存在未闭合的代码块`);
  return beats;
}

export function compileStoryToInk(input, { author = "a_suozhang" } = {}) {
  const document = validateStoryDocument(structuredClone(input));
  const beats = document.acts.flatMap((act) => act.scenes.flatMap((scene) => parseSceneScript(scene.script, scene.key)));
  if (!beats.length) throw new Error("故事至少需要一个脚本段落");
  const pad = (number) => String(number).padStart(3, "0");
  const lines = [
    `# title: ${document.title.trim()}`,
    `# author: ${author}`,
    "",
    "// 由 story.md 通过 Story Studio 编译。请优先编辑 Markdown 源文件。",
    "// makoto / noe 为人物对话，narration 为环境与动作描写，system 为终端输出。",
    "// makoto + thought 表示 Makoto 心声；可选 #PERSONA 指定内在人格；#SCENE 标记叙事阶段。",
    "",
    "* [开始对话 ▸] -> beat_001",
    "",
  ];
  beats.forEach((beat, index) => {
    const number = index + 1;
    lines.push(
      `=== beat_${pad(number)} ===`,
      `${beat.text} #SPEAKER: ${beat.speaker} #CLASS: ${beat.className}${beat.persona ? ` #PERSONA: ${beat.persona}` : ""} #SCENE: ${beat.scene}`,
      number === beats.length ? "* [结束对话 ■] -> ending" : `* [继续 ▸] -> beat_${pad(number + 1)}`,
      "",
    );
  });
  lines.push("=== ending ===", "-> DONE");
  return { ink: `${lines.join("\n")}\n`, beatCount: beats.length };
}

export function normalizeGeneratedAct(value, fallbackId) {
  if (!value || typeof value !== "object") throw new Error("模型没有返回 Act 对象");
  const act = {
    id: /^[a-z0-9][a-z0-9-]*$/u.test(value.id ?? "") ? value.id : fallbackId,
    title: String(value.title ?? "").trim(),
    summary: String(value.summary ?? "").trim(),
    scenes: Array.isArray(value.scenes) ? value.scenes.map((scene, index) => ({
      key: /^[a-z0-9][a-z0-9-]*$/u.test(scene?.key ?? "") ? scene.key : `${fallbackId}-scene-${index + 1}`,
      title: String(scene?.title ?? `Scene ${index + 1}`).trim(),
      script: String(scene?.script ?? "").trim(),
    })) : [],
  };
  validateStoryDocument({ title: "draft", theme: "", outline: "", acts: [act] });
  return act;
}
