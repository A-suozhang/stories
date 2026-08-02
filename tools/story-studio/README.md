# Story Studio

Story Studio 是仓库内的本地创作工具，不是公开网站的 Next.js 路由。它固定绑定 `127.0.0.1`，直接编辑：

`content/stories/rain-atlas/story.md`

## 启动

```bash
npm run studio
```

然后打开：

`http://127.0.0.1:4317`

服务不会监听局域网地址。GitHub Pages 工作流只上传 Next.js 的 `out/`，不会包含 `tools/story-studio/`。

## 使用本地 Codex 生成 Act

本机已经通过 `codex login` 登录时，直接运行 `npm run studio` 即会使用本地 Codex CLI。它复用 CLI 保存的登录状态，不需要把 API Key 交给浏览器：

```bash
npm run studio
```

可显式配置 provider、模型、Codex 路径和超时时间：

```bash
STORY_STUDIO_AI_PROVIDER="codex" \
STORY_STUDIO_MODEL="gpt-5.6-terra" \
STORY_STUDIO_CODEX_PATH="codex" \
STORY_STUDIO_AI_TIMEOUT_MS="120000" \
npm run studio
```

每次生成都通过 `codex exec --ephemeral --sandbox read-only` 在临时目录运行，只返回符合 JSON Schema 的候选 Act，不会直接修改故事文件。
生成期间面板会显示请求状态；默认最多等待 120 秒，给本地 Codex 留出冷启动、登录状态检查和完整故事上下文处理的时间。如本地 Codex 或网络不可用，会把具体错误显示在 AI 输出区；如需调整，可通过 `STORY_STUDIO_AI_TIMEOUT_MS` 修改。
Story Studio 默认不把当前 shell 的 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 传给 Codex 子进程，避免失效的本机代理阻断生成。如果本机必须通过这些代理联网，可设置 `STORY_STUDIO_CODEX_PROXY="inherit"`。

在每个 Scene 的“实际脚本”标题旁，可以点击 `✦ 格式化`。它会把当前文本交给本地 Codex，按固定提示词整理为环境描写、人物对白、心声和系统代码块格式；其中“国王 / 法庭 / 小丑 / 牛虻”会分别映射为 `machiavellian-king`、`inner-court`、`cynic-jester`、`socratic-gadfly`。结果会直接回填当前文本框，并标记为本地未保存修改，仍需点击“保存更改”。

仍可切换到 Responses API 备用模式：

```bash
STORY_STUDIO_AI_PROVIDER="openai" OPENAI_API_KEY="..." npm run studio
```

密钥只由本地 Node 服务读取，不会返回给浏览器，也不要写入仓库或 `.env` 提交。即使不配置任何 AI，主旨、大纲、Act、Scene 和逐段编辑仍可正常使用。

## Markdown 结构

```markdown
# Story title

## 文章主旨

一段主旨。

## 故事大纲

总体结构，以及如何划分 Act。

## Act: act-1｜Act 标题

### 大意

一段话概述。

### Scene: opening｜场景标题

*环境描写。*

**Makoto：** 人物对话。
```

运行 `npm run story:compile` 时，Markdown 会先生成带 `SPEAKER / CLASS / SCENE` 标签的 `story.ink`，再生成供网站使用的 `story.json`。
