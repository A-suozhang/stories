import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
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

async function requestActDraft({ apiKey, model, document, act, mode, instruction }) {
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

export function createStoryStudioServer(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? defaultRepoRoot);
  const storyMarkdown = resolve(options.storyMarkdown ?? join(repoRoot, "content/stories/rain-atlas/story.md"));
  const storyInk = resolve(options.storyInk ?? join(repoRoot, "content/stories/rain-atlas/story.ink"));
  const storyJson = resolve(options.storyJson ?? join(repoRoot, "content/stories/rain-atlas/story.json"));
  const compiler = resolve(options.compiler ?? join(repoRoot, "node_modules/inkjs/bin/inkjs-compiler.js"));
  const publicDirectory = resolve(options.publicDirectory ?? join(moduleDirectory, "public"));
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  const model = options.model ?? process.env.STORY_STUDIO_MODEL ?? "gpt-5.6-terra";

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
        return json(response, 200, { localOnly: true, host: STUDIO_HOST, aiConfigured: Boolean(apiKey), model, storyPath: "content/stories/rain-atlas/story.md" });
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
        if (!apiKey) return json(response, 503, { error: "未设置 OPENAI_API_KEY；手工编辑仍可正常使用。" });
        const body = await readJsonBody(request);
        const document = validateStoryDocument(body.document);
        const act = body.act;
        if (!act || typeof act !== "object") throw Object.assign(new Error("缺少目标 Act"), { statusCode: 400 });
        const draft = await requestActDraft({ apiKey, model, document, act, mode: body.mode, instruction: String(body.instruction ?? "").slice(0, 4000) });
        return json(response, 200, { act: draft, model });
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
    if (!process.env.OPENAI_API_KEY) console.log("AI drafting disabled: set OPENAI_API_KEY to enable it.");
  });
}
