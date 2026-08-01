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

## 可选的 Act 生成

AI 未配置时，主旨、大纲、Act、Scene 和逐段编辑全部可用。要启用“生成 Act”和“重写 Act”：

```bash
OPENAI_API_KEY="..." npm run studio
```

默认模型为 `gpt-5.6-terra`，可以显式覆盖：

```bash
OPENAI_API_KEY="..." STORY_STUDIO_MODEL="gpt-5.6-terra" npm run studio
```

密钥只由本地 Node 服务读取，不会返回给浏览器，也不要写入仓库或 `.env` 提交。

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
