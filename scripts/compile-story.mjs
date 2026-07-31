import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("content/stories/rain-atlas/story.ink");
const output = resolve("content/stories/rain-atlas/story.json");
const compiler = resolve("node_modules/inkjs/bin/inkjs-compiler.js");

execFileSync(process.execPath, [compiler, source, "-o", output], {
  stdio: "inherit",
});

const compiled = await readFile(output, "utf8");
await writeFile(output, compiled.replace(/^\uFEFF/, ""), "utf8");
