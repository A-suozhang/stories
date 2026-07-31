# Thoughts & Stories

一个用于发布线性短篇小说的动态网站原型。首页展示作品，单篇阅读器采用左侧场景、右侧渐进对话的沉浸式布局。

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`。生产构建使用 `npm run build`。

## 写作

示例剧本位于：

```text
content/stories/rain-atlas/story.ink
```

每一段使用这些标签驱动界面：

```ink
一小段正文。 #SPEAKER: makoto #CLASS: character #SCENE: counter
* [继续 ▸] -> next_paragraph
```

- `#SPEAKER`：说话人
- `#CLASS`：`narration`、`character`、`voice`、`system` 或 `task`
- `#SCENE`：左侧场景
- `▸` / `■`：继续 / 结束按钮

修改 `.ink` 后运行 `npm run story:compile`。`npm run build` 也会自动重新编译剧本。

## 参考与许可

对话标记方式与交互结构参考 [kciurleo/discoelysiumink](https://github.com/kciurleo/discoelysiumink)，其代码采用 MIT License，Copyright (c) 2022 kciurleo。本原型未包含该项目从《极乐迪斯科》提取的图片、字体或其他游戏素材。

正文使用 OFL 开源字体 Noto Serif SC，界面使用 OFL 开源字体 Commit Mono。

叙事运行层使用 [inkjs](https://github.com/y-lohse/inkjs)。
