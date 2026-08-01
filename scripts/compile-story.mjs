import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileStoryToInk, parseStoryDocument } from "../tools/story-studio/lib/story-document.mjs";

const markdownSource = resolve("content/stories/rain-atlas/story.md");
const source = resolve("content/stories/rain-atlas/story.ink");
const output = resolve("content/stories/rain-atlas/story.json");
const compiler = resolve("node_modules/inkjs/bin/inkjs-compiler.js");

const markdown = await readFile(markdownSource, "utf8");
const document = parseStoryDocument(markdown);
const { ink } = compileStoryToInk(document);
await writeFile(source, ink, "utf8");

execFileSync(process.execPath, [compiler, source, "-o", output], {
  stdio: "inherit",
});

const compiled = await readFile(output, "utf8");
await writeFile(output, compiled.replace(/^\uFEFF/, ""), "utf8");
