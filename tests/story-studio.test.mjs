import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import test from "node:test";
import { compileStoryToInk, parseStoryDocument, serializeStoryDocument } from "../tools/story-studio/lib/story-document.mjs";
import { createStoryStudioServer, STUDIO_HOST } from "../tools/story-studio/server.mjs";

const sourceUrl = new URL("../content/stories/rain-atlas/story.md", import.meta.url);

test("round-trips the structured Markdown story", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const document = parseStoryDocument(source);
  const roundTrip = parseStoryDocument(serializeStoryDocument(document));
  assert.deepEqual(roundTrip, document);
  assert.equal(document.acts.length, 4);
  assert.equal(document.acts.flatMap((act) => act.scenes).length, 7);
  assert.match(document.theme, /人格究竟是内在真实/);
  assert.match(document.outline, /故事分为四个Act/);
});

test("compiles the current Markdown into the complete progressive Ink story", async () => {
  const document = parseStoryDocument(await readFile(sourceUrl, "utf8"));
  const { ink, beatCount } = compileStoryToInk(document);
  assert.equal(beatCount, 164);
  assert.match(ink, /=== beat_001 ===[\s\S]*?等待比追踪更诚实[\s\S]*?#SPEAKER: makoto #CLASS: thought #PERSONA: machiavellian-king #SCENE: counter/);
  assert.match(ink, /#SPEAKER: makoto #CLASS: character #SCENE: counter/);
  assert.match(ink, /#SPEAKER: noe #CLASS: character #SCENE: closing/);
  assert.match(ink, /#SPEAKER: narration #CLASS: environment/);
  assert.match(ink, /#SPEAKER: system #CLASS: system/);
  assert.match(ink, /#SPEAKER: makoto #CLASS: thought/);
  assert.match(ink, /#PERSONA: machiavellian-king/);
  assert.match(ink, /#PERSONA: inner-court/);
  assert.match(ink, /#PERSONA: cynic-jester/);
  assert.match(ink, /#PERSONA: socratic-gadfly/);
  assert.match(ink, /法官，把起诉书收起来/);
  assert.match(ink, /国王把“害怕失去Noé”印成“关键人员风险”/);
  assert.match(ink, /什么可观察的事实能够区分拒绝与缺失/);
  assert.match(ink, /=== beat_164 ===[\s\S]*?无法转交给故障的责任[\s\S]*?\* \[结束对话 ■\] -> ending/);
  assert.match(ink, /HISTORICAL FAULTS: NONE/);
});

test("serves the authoring tool only on the loopback server", async (context) => {
  const server = createStoryStudioServer({ provider: "openai", apiKey: "", model: "test-model" });
  server.listen(0, STUDIO_HOST);
  await once(server, "listening");
  context.after(() => server.close());
  const { port, address } = server.address();
  assert.equal(address, STUDIO_HOST);

  const base = `http://${STUDIO_HOST}:${port}`;
  const status = await fetch(`${base}/api/status`).then((response) => response.json());
  assert.deepEqual({ localOnly: status.localOnly, host: status.host, aiConfigured: status.aiConfigured }, { localOnly: true, host: STUDIO_HOST, aiConfigured: false });

  const documentResponse = await fetch(`${base}/api/document`);
  const documentPayload = await documentResponse.json();
  assert.equal(documentPayload.document.acts.length, 4);
  assert.match(documentPayload.revision, /^[a-f0-9]{64}$/u);

  const pageResponse = await fetch(base);
  assert.match(pageResponse.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.match(await pageResponse.text(), /Story Studio · Local/);

  const artResponse = await fetch(`${base}/art/ramen-night.webp`);
  assert.equal(artResponse.status, 200);
  assert.equal(artResponse.headers.get("content-type"), "image/webp");
  assert.ok(Number(artResponse.headers.get("content-length")) > 1000);

  const aiResponse = await fetch(`${base}/api/act-draft`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-story-studio": "1" },
    body: JSON.stringify({}),
  });
  assert.equal(aiResponse.status, 503);
});

test("routes Act generation through the configured local Codex provider", async (context) => {
  let request;
  let formatRequest;
  const server = createStoryStudioServer({
    provider: "codex",
    model: "test-codex-model",
    draftRequester: async (value) => {
      request = value;
      return {
        id: value.act.id,
        title: "候选 Act",
        summary: "由本地 Codex 返回的候选大意。",
        scenes: [{ key: "candidate-scene", title: "候选场景", script: "**Makoto：** 测试。" }],
      };
    },
    sceneFormatter: async (value) => {
      formatRequest = value;
      return "*雨声贴着棚布落下。*\n\n**Makoto：** 测试。";
    },
  });
  server.listen(0, STUDIO_HOST);
  await once(server, "listening");
  context.after(() => server.close());
  const { port } = server.address();
  const base = `http://${STUDIO_HOST}:${port}`;
  const status = await fetch(`${base}/api/status`).then((response) => response.json());
  assert.equal(status.aiConfigured, true);
  assert.equal(status.provider, "codex");

  const document = parseStoryDocument(await readFile(sourceUrl, "utf8"));
  const response = await fetch(`${base}/api/act-draft`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-story-studio": "1" },
    body: JSON.stringify({ document, act: document.acts[0], mode: "generate", instruction: "保持克制。" }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.provider, "codex");
  assert.equal(payload.act.title, "候选 Act");
  assert.equal(request.model, "test-codex-model");
  assert.equal(request.instruction, "保持克制。");

  const formatResponse = await fetch(`${base}/api/format-scene`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-story-studio": "1" },
    body: JSON.stringify({ actTitle: "替换与连续性", sceneTitle: "雨夜", script: "雨很大。Makoto说测试。" }),
  });
  const formatPayload = await formatResponse.json();
  assert.equal(formatResponse.status, 200);
  assert.match(formatPayload.script, /\*雨声贴着棚布落下。\*/);
  assert.equal(formatRequest.sceneTitle, "雨夜");
});
