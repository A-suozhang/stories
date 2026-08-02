import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileStoryToInk,
  normalizeGeneratedAct,
  parseStoryDocument,
  serializeStoryDocument,
  validateStoryDocument,
} from "./lib/story-document.mjs";

export const STUDIO_HOST = "127.0.0.1";
export const DEFAULT_STUDIO_PORT = 4317;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(moduleDirectory, "../..");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
};

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("请求内容超过 2 MB"), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("请求不是有效 JSON"), { statusCode: 400 });
  }
}

function revisionFor(markdown) {
  return createHash("sha256").update(markdown).digest("hex");
}

async function atomicWrite(path, content) {
  const temporary = `${path}.story-studio-${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function assertLocalMutation(request) {
  if (request.headers["x-story-studio"] !== "1") {
    throw Object.assign(new Error("缺少本地编辑器请求标记"), { statusCode: 403 });
  }
  const origin = request.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/u.test(origin)) {
    throw Object.assign(new Error("拒绝非本地来源"), { statusCode: 403 });
  }
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? "")
    .join("");
}

function parseModelJson(text) {
  const cleaned = String(text).replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型没有返回 JSON Act 草稿");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function createActPrompt({ document, act, mode, instruction }) {
  const action = mode === "rewrite" ? "完整重写目标 Act" : "生成并细化目标 Act";
  return [
    `任务：${action}。`,
    "必须服从文章主旨和总体大纲，保持人物口吻、世界设定与前后 Act 连续。",
    instruction ? `作者补充要求：${instruction}` : "作者没有额外要求。",
    "",
    "输出只能是一个 JSON 对象，字段如下：",
    '{"id":"act-id","title":"标题","summary":"一段大意","scenes":[{"key":"scene-key","title":"场景标题","script":"Markdown脚本"}]}',
    "summary 必须是一段话。script 使用以下格式：环境描写写成 *文字*；人物对话写成 **Makoto：** 文字 或 **Noé：** 文字；Makoto心声写成 **Makoto（心声）：** 文字，也可用 **Makoto（心声｜machiavellian-king）：**、**Makoto（心声｜inner-court）：**、**Makoto（心声｜cynic-jester）：** 或 **Makoto（心声｜socratic-gadfly）：** 选择内在人格；系统输出放在 ```text 代码块中。",
    "不要在 script 中加入 Act 或 Scene 标题。不要解释 JSON。",
    "",
    "完整故事上下文：",
    JSON.stringify(document),
    "",
    "目标 Act：",
    JSON.stringify(act),
  ].join("\n");
}

function createSceneFormatPrompt({ actTitle, sceneTitle, script }) {
  return [
    "你是这个本地短篇小说工作台的 Markdown 场景格式化器。",
    "请把作者提供的一段散文、对白草稿或混合文本，整理成可直接放入本项目 Scene 脚本框的格式。",
    "必须保留原文的事实、顺序、人物关系、语气和信息，不续写、不删减剧情，不添加解释。",
    "严格遵守以下固定格式：",
    "1. 客观环境、动作、表情和声音写成单独一段，并用单个 *...* 包裹。",
    "2. 人物对白每句单独一行，使用 **Makoto：**、**Noé：** 或原文明确给出的角色名。",
    "3. Makoto 的内心使用 **Makoto（心声）：**；若原文明确指向某种人格，必须把中文人格名映射成括号后的固定 ID，而不是只保留中文称呼。映射如下：",
    "   - 马基雅维利国王 / 国王 / 王座 / 狮子与狐狸 → **Makoto（心声｜machiavellian-king）：**；语气计算资源、权力、背叛风险与生存控制，把共情当作情报而非命令。",
    "   - 康德的内在法庭 / 内在法庭 / 法庭 / 法官 / 罪证 → **Makoto（心声｜inner-court）：**；语气进行道德审判、追问动机和责任，不允许借理由自我豁免。",
    "   - 第欧根尼与犬儒小丑 / 犬儒小丑 / 小丑 / 提灯与犬 → **Makoto（心声｜cynic-jester）：**；语气用讥讽、玩笑拆穿权威和严肃性，把真话伪装成笑话。",
    "   - 苏格拉底牛虻 / 牛虻 / 追问者 / 毒芹与辩证环 → **Makoto（心声｜socratic-gadfly）：**；语气连续提问、定义概念、揭示矛盾，不接受未经检验的答案。",
    "   这些人格不是四个新人物，而是 Makoto 的四种内在声音；如果原文没有人格线索，则使用不带 ID 的 **Makoto（心声）：**，不要擅自分配人格。",
    "4. 系统、终端或诊断内容放入 ```text 代码块。",
    "5. 段落之间空一行；只返回整理后的 Markdown，不要返回标题、序号、说明文字或代码围栏（系统代码块除外）。",
    "",
    `当前 Act：${actTitle || "未命名 Act"}`,
    `当前 Scene：${sceneTitle || "未命名场景"}`,
    "",
    "作者原始文本：",
    script,
  ].join("\n");
}

function cleanFormattedScene(text) {
  return String(text)
    .replace(/^```(?:markdown|md|text)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
}

async function requestCodexSceneFormat({ codexPath, model, actTitle, sceneTitle, script, timeoutMs }) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "story-studio-format-"));
  const outputPath = join(temporaryDirectory, "formatted-scene.md");
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--color", "never",
    "--cd", temporaryDirectory,
    "--model", model,
    "--output-last-message", outputPath,
    "-",
  ];
  try {
    await runCodex({ codexPath, args, input: createSceneFormatPrompt({ actTitle, sceneTitle, script }), timeoutMs });
    return cleanFormattedScene(await readFile(outputPath, "utf8"));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function requestOpenAiSceneFormat({ apiKey, model, actTitle, sceneTitle, script }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      instructions: "只输出整理后的 Markdown 场景脚本，不要解释。",
      input: createSceneFormatPrompt({ actTitle, sceneTitle, script }),
      reasoning: { effort: "low" },
      text: { verbosity: "high" },
      max_output_tokens: 8000,
    }),
    signal: AbortSignal.timeout(180000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message ?? `OpenAI 请求失败（${response.status}）`);
  return cleanFormattedScene(extractResponseText(payload));
}

async function requestOpenAiActDraft({ apiKey, model, document, act, mode, instruction }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: "你是严谨的中文短篇小说编辑。维护既有设定，优先具体动作与克制对话，不擅自改变人物背景。",
      input: createActPrompt({ document, act, mode, instruction }),
      reasoning: { effort: "medium" },
      text: { verbosity: "high" },
      max_output_tokens: 12000,
    }),
    signal: AbortSignal.timeout(180000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message ?? `OpenAI 请求失败（${response.status}）`);
  const parsed = parseModelJson(extractResponseText(payload));
  return normalizeGeneratedAct(parsed, act.id);
}

function runCodex({ codexPath, args, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const codexEnvironment = { ...process.env };
    if (process.env.STORY_STUDIO_CODEX_PROXY !== "inherit") {
      for (const key of ["ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "all_proxy", "https_proxy", "http_proxy", "CODEX_THREAD_ID", "CODEX_CI", "CODEX_PERMISSION_PROFILE"]) {
        delete codexEnvironment[key];
      }
    }
    const child = spawn(codexPath, args, {
      env: codexEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`本地 Codex 生成超时（${Math.round(timeoutMs / 1000)} 秒）`)));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-1024 * 1024); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-1024 * 1024); });
    child.on("error", (error) => finish(() => reject(new Error(
      error.code === "ENOENT"
        ? `找不到本地 Codex：${codexPath}；请设置 STORY_STUDIO_CODEX_PATH。`
        : `无法启动本地 Codex：${error.message}`,
    ))));
    child.on("close", (code, signal) => finish(() => {
      if (code === 0) return resolve({ stdout, stderr });
      const detail = stderr.trim() || stdout.trim() || `signal ${signal ?? "unknown"}`;
      reject(new Error(`本地 Codex 生成失败（exit ${code ?? "unknown"}）：${detail.slice(-2000)}`));
    }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function requestCodexActDraft({ codexPath, schemaPath, model, document, act, mode, instruction, timeoutMs }) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "story-studio-codex-"));
  const outputPath = join(temporaryDirectory, "act-draft.json");
  const prompt = [
    "你是严谨的中文短篇小说编辑。维护既有设定，优先具体动作与克制对话，不擅自改变人物背景。",
    "不要调用工具，不要修改任何文件。严格按照输出 JSON Schema 返回候选稿。",
    "",
    createActPrompt({ document, act, mode, instruction }),
  ].join("\n");
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--color", "never",
    "--cd", temporaryDirectory,
    "--model", model,
    "--output-schema", schemaPath,
    "--output-last-message", outputPath,
    "-",
  ];
  try {
    await runCodex({ codexPath, args, input: prompt, timeoutMs });
    const parsed = parseModelJson(await readFile(outputPath, "utf8"));
    return normalizeGeneratedAct(parsed, act.id);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function createStoryStudioServer(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? defaultRepoRoot);
  const storyMarkdown = resolve(options.storyMarkdown ?? join(repoRoot, "content/stories/rain-atlas/story.md"));
  const storyInk = resolve(options.storyInk ?? join(repoRoot, "content/stories/rain-atlas/story.ink"));
  const storyJson = resolve(options.storyJson ?? join(repoRoot, "content/stories/rain-atlas/story.json"));
  const compiler = resolve(options.compiler ?? join(repoRoot, "node_modules/inkjs/bin/inkjs-compiler.js"));
  const publicDirectory = resolve(options.publicDirectory ?? join(moduleDirectory, "public"));
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  const provider = options.provider ?? process.env.STORY_STUDIO_AI_PROVIDER ?? (apiKey ? "openai" : "codex");
  const model = options.model ?? process.env.STORY_STUDIO_MODEL ?? "gpt-5.6-terra";
  const codexPath = options.codexPath ?? process.env.STORY_STUDIO_CODEX_PATH ?? "codex";
  const codexSchema = resolve(options.codexSchema ?? join(moduleDirectory, "act-draft.schema.json"));
  // A full Act request includes the complete story context and must pass
  // through the local Codex CLI startup/authentication path. Twelve seconds
  // is shorter than the normal cold-start latency, so it caused valid
  // generations to be aborted before Codex could return its JSON output.
  // Keep the timeout configurable, but give local generation a practical
  // two-minute default.
  const codexTimeoutMs = options.codexTimeoutMs ?? (Number.parseInt(process.env.STORY_STUDIO_AI_TIMEOUT_MS ?? "", 10) || 120000);
  if (!new Set(["codex", "openai"]).has(provider)) throw new Error(`未知 Story Studio AI provider：${provider}`);
  const aiConfigured = provider === "codex" || Boolean(apiKey);
  const draftRequester = options.draftRequester ?? (provider === "codex" ? requestCodexActDraft : requestOpenAiActDraft);
  const sceneFormatter = options.sceneFormatter ?? (provider === "codex" ? requestCodexSceneFormat : requestOpenAiSceneFormat);

  const compileAndWrite = async (document) => {
    const { ink, beatCount } = compileStoryToInk(document);
    await atomicWrite(storyInk, ink);
    execFileSync(process.execPath, [compiler, storyInk, "-o", storyJson], { cwd: repoRoot, stdio: "pipe" });
    const compiled = await readFile(storyJson, "utf8");
    await atomicWrite(storyJson, compiled.replace(/^\uFEFF/u, ""));
    return beatCount;
  };

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? STUDIO_HOST}`);
      if (request.method === "GET" && url.pathname === "/api/status") {
        return json(response, 200, { localOnly: true, host: STUDIO_HOST, aiConfigured, provider, model, storyPath: "content/stories/rain-atlas/story.md" });
      }
      if (request.method === "GET" && url.pathname === "/api/document") {
        const markdown = await readFile(storyMarkdown, "utf8");
        return json(response, 200, { document: parseStoryDocument(markdown), revision: revisionFor(markdown) });
      }
      if (request.method === "PUT" && url.pathname === "/api/document") {
        assertLocalMutation(request);
        const body = await readJsonBody(request);
        const document = validateStoryDocument(body.document);
        const previousMarkdown = await readFile(storyMarkdown, "utf8");
        if (body.revision !== revisionFor(previousMarkdown)) {
          return json(response, 409, { error: "源文件已在别处改变，请重新载入后再保存。" });
        }
        const previousInk = await readFile(storyInk, "utf8");
        const previousJson = await readFile(storyJson, "utf8");
        const markdown = serializeStoryDocument(document);
        try {
          await atomicWrite(storyMarkdown, markdown);
          const beatCount = await compileAndWrite(document);
          return json(response, 200, { revision: revisionFor(markdown), beatCount });
        } catch (error) {
          await Promise.all([
            atomicWrite(storyMarkdown, previousMarkdown),
            atomicWrite(storyInk, previousInk),
            atomicWrite(storyJson, previousJson),
          ]);
          throw error;
        }
      }
      if (request.method === "POST" && url.pathname === "/api/act-draft") {
        assertLocalMutation(request);
        if (!aiConfigured) return json(response, 503, { error: "OpenAI provider 未设置 OPENAI_API_KEY；手工编辑仍可正常使用。" });
        const body = await readJsonBody(request);
        const document = validateStoryDocument(body.document);
        const act = body.act;
        if (!act || typeof act !== "object") throw Object.assign(new Error("缺少目标 Act"), { statusCode: 400 });
        const draft = await draftRequester({
          apiKey,
          codexPath,
          schemaPath: codexSchema,
          model,
          document,
          act,
          mode: body.mode,
          instruction: String(body.instruction ?? "").slice(0, 4000),
          timeoutMs: codexTimeoutMs,
        });
        return json(response, 200, { act: draft, provider, model });
      }
      if (request.method === "POST" && url.pathname === "/api/format-scene") {
        assertLocalMutation(request);
        if (!aiConfigured) return json(response, 503, { error: "AI provider 未配置；手工编辑仍可正常使用。" });
        const body = await readJsonBody(request);
        const script = String(body.script ?? "").trim();
        if (!script) throw Object.assign(new Error("请先在场景脚本框中输入内容。"), { statusCode: 400 });
        const formatted = await sceneFormatter({
          apiKey,
          codexPath,
          model,
          actTitle: String(body.actTitle ?? ""),
          sceneTitle: String(body.sceneTitle ?? ""),
          script,
          timeoutMs: codexTimeoutMs,
        });
        if (!formatted) throw new Error("Codex 没有返回格式化后的脚本。");
        return json(response, 200, { script: formatted, provider, model });
      }

      if (request.method !== "GET") return json(response, 404, { error: "Not found" });
      const staticPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const staticFiles = new Map([
        ["index.html", join(publicDirectory, "index.html")],
        ["app.js", join(publicDirectory, "app.js")],
        ["styles.css", join(publicDirectory, "styles.css")],
        ["art/ramen-night.webp", join(repoRoot, "public/assets/ramen-talk-painterly-street-v5.webp")],
      ]);
      const filePath = staticFiles.get(staticPath);
      if (!filePath) return json(response, 404, { error: "Not found" });
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": contentTypes[extname(staticPath)] ?? "application/octet-stream",
        "content-length": body.length,
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
      });
      response.end(body);
    } catch (error) {
      json(response, error.statusCode ?? 500, { error: error.message ?? "Unknown error" });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.STORY_STUDIO_PORT ?? "", 10) || DEFAULT_STUDIO_PORT;
  const server = createStoryStudioServer();
  server.listen(port, STUDIO_HOST, () => {
    console.log(`Story Studio: http://${STUDIO_HOST}:${port}`);
    console.log("Local only — this server is not part of the public Next.js build.");
    const provider = process.env.STORY_STUDIO_AI_PROVIDER ?? (process.env.OPENAI_API_KEY ? "openai" : "codex");
    console.log(`AI drafting: ${provider} · ${process.env.STORY_STUDIO_MODEL ?? "gpt-5.6-terra"}`);
  });
}
