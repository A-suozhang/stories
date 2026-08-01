import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the fiction library", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Thoughts &amp; Stories/);
  assert.match(html, /Copyright © a_suozhang/);
  assert.match(html, /2026\.07\.31/);
  assert.match(html, /Ramen Talk: Empathy Module/);
  assert.match(html, /\/stories\/rain-atlas/);
  assert.doesNotMatch(html, /一些发生在|最新收录|低轨来信|独立写作与实验叙事/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("server-renders the progressive story route", async () => {
  const response = await render("/stories/rain-atlas");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Ramen Talk:/);
  assert.match(html, /Empathy Module/);
  assert.match(html, /开始对话/);
});

test("keeps editable progressive Ink with scrollable dialogue history", async () => {
  const [ink, reader, styles, packageJson] = await Promise.all([
    readFile(new URL("../content/stories/rain-atlas/story.ink", import.meta.url), "utf8"),
    readFile(new URL("../app/stories/rain-atlas/reader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(ink, /#SPEAKER: makoto/);
  assert.match(ink, /#SPEAKER: noe/);
  assert.match(ink, /#SPEAKER: narration #CLASS: environment/);
  assert.match(ink, /#SPEAKER: system #CLASS: system/);
  assert.match(ink, /#SPEAKER: makoto #CLASS: thought/);
  assert.doesNotMatch(ink, /#SPEAKER: (?!makoto|noe|narration|system)/);
  assert.match(ink, /高架桥的阴影压在一排自动售货机和公共拉面摊上/);
  assert.match(ink, /你的维护层接受了拉面摊的卫生证书/);
  assert.match(ink, /所谓persona，大概不是一张假脸/);
  assert.match(ink, /HISTORICAL FAULTS: NONE/);
  assert.doesNotMatch(ink, /#PORTRAIT:/);
  assert.match(ink, /#SCENE: diagnostic/);
  assert.match(ink, /#SCENE: reconnect/);
  assert.match(ink, /=== beat_150 ===[\s\S]*?\* \[继续 ▸\] -> beat_151/);
  assert.match(ink, /=== beat_151 ===[\s\S]*?\* \[结束对话 ■\] -> ending/);
  assert.match(reader, /lines\.map\(\(line, index\)/);
  assert.match(reader, /const isEnvironment = line\.speaker === "narration" \|\| line\.className === "environment"/);
  assert.match(reader, /const speakerLabel = line\.className === "thought"/);
  assert.match(reader, /system: "SYSTEM"/);
  assert.match(reader, /!isEnvironment && <strong>/);
  assert.match(reader, /aria-label=\{isEnvironment \? "环境描写" : undefined\}/);
  assert.match(reader, /speaker-\$\{line\.speaker\}/);
  assert.match(reader, /index === lines\.length - 1 \? "current" : "past"/);
  assert.match(reader, /useState\(21\)/);
  assert.match(reader, /const TOTAL_STORY_LINES = 151/);
  assert.doesNotMatch(reader, /ink-portrait|tags\.PORTRAIT/);
  assert.match(reader, /星沢真｜Makoto Hoshizawa/);
  assert.match(reader, /makoto-hoshizawa-profile\.png/);
  assert.match(reader, /星沢真（Makoto Hoshizawa）人物肖像/);
  assert.match(reader, /const currentSpeaker = complete \? undefined : lines\[lines\.length - 1\]\?\.speaker/);
  assert.match(reader, /speaker-portrait-dock--\$\{currentSpeaker\}/);
  assert.match(reader, /speaker-portrait-inline--\$\{line\.speaker\}/);
  assert.match(reader, /index === lines\.length - 1 && portraitLabels\[line\.speaker\]/);
  assert.match(reader, /currentLineRef\.current\?\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(reader, /const rect = line\.getBoundingClientRect\(\)/);
  assert.match(reader, /scroller\?\.addEventListener\("scroll", requestSync/);
  assert.match(reader, /ref=\{index === lines\.length - 1 \? currentLineRef : undefined\}/);
  assert.match(reader, /noe-kurosaki-profile-v2\.png/);
  assert.match(reader, /黑崎诺埃（Noé Kurosaki）人物肖像/);
  assert.doesNotMatch(reader, /人物肖像尚未录入|speaker-portrait-placeholder/);
  assert.match(reader, /黑崎诺埃｜Noé Kurosaki/);
  assert.match(reader, /不应存在的生还者/);
  assert.match(reader, /继续生活远比证明究竟是谁在生活更重要/);
  assert.match(reader, /ramen-talk-painterly-street-v5\.webp/);
  assert.match(styles, /var\(--scene-image\)/);
  assert.match(styles, /\.speaker-portrait-dock \{[\s\S]*?display: none;/);
  assert.match(styles, /\.speaker-portrait-inline \{[\s\S]*?display: block;/);
  assert.match(styles, /\.ink-line\.speaker-makoto \.ink-copy strong \{ color: var\(--makoto-name\); \}/);
  assert.match(styles, /\.ink-line\.speaker-noe \.ink-copy strong \{ color: var\(--noe-name\); \}/);
  assert.match(styles, /\.ink-line\.environment \.ink-copy/);
  assert.match(styles, /\.ink-line\.thought \.ink-copy/);
  assert.match(packageJson, /"inkjs"/);
  assert.match(packageJson, /"story:compile"/);
});
