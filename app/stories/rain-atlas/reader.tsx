"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Story } from "inkjs";
import storyContent from "../../../content/stories/rain-atlas/story.json";

type InkLine = {
  id: number;
  text: string;
  speaker: string;
  className: string;
  scene: string;
};

type InkChoice = { index: number; text: string };

const speakers: Record<string, string> = {
  makoto: "星沢真 / MAKOTO",
  noe: "黑崎诺埃 / NOÉ",
  system: "SYSTEM",
};

const portraitLabels: Record<string, string> = {
  makoto: "MAKOTO",
  noe: "NOÉ",
};

const TOTAL_STORY_LINES = 151;
const assetBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const sceneLabels: Record<string, string> = {
  counter: "PUBLIC RAMEN STALL / 01:17",
  identity: "PERSONALITY / CONTINUITY",
  defense: "SOCIAL INTERFACE / ACTIVE",
  pressure: "CONVERSATION PRESSURE / RISING",
  diagnostic: "EMPATHY MODULE / DIAGNOSTIC",
  reconnect: "AFFECT BRIDGE / ONLINE",
  closing: "LAST BOWL / 02:18",
};

function parseTags(tags: string[]) {
  const result: Record<string, string> = {};
  tags.forEach((tag) => {
    const separator = tag.indexOf(":");
    if (separator === -1) return;
    result[tag.slice(0, separator).trim().toUpperCase()] = tag.slice(separator + 1).trim();
  });
  return result;
}

function cleanChoice(text: string) {
  return text.replace(/<[^>]+>/g, "").replace(/[\[\]▸■]/g, "").trim();
}

function createPrimedStory() {
  const story = new Story(storyContent);
  while (story.canContinue && story.currentChoices.length === 0) {
    story.Continue();
  }
  return story;
}

function choicesFrom(story: Story): InkChoice[] {
  return story.currentChoices.map((choice) => ({ index: choice.index, text: choice.text }));
}

export default function Reader() {
  const [initialStory] = useState(createPrimedStory);
  const storyRef = useRef<Story>(initialStory);
  const endRef = useRef<HTMLDivElement | null>(null);
  const dialogueRef = useRef<HTMLElement | null>(null);
  const currentLineRef = useRef<HTMLElement | null>(null);
  const portraitRef = useRef<HTMLElement | null>(null);
  const [lines, setLines] = useState<InkLine[]>([]);
  const [choices, setChoices] = useState<InkChoice[]>(() => choicesFrom(initialStory));
  const [scene, setScene] = useState("counter");
  const [fontSize, setFontSize] = useState(21);
  const [complete, setComplete] = useState(false);

  const readChoices = useCallback((story: Story) => {
    setChoices(choicesFrom(story));
  }, []);

  const resetStory = useCallback(() => {
    const story = createPrimedStory();
    storyRef.current = story;
    setLines([]);
    setScene("counter");
    setComplete(false);
    readChoices(story);
  }, [readChoices]);

  const continueStory = useCallback((choiceIndex: number) => {
    const story = storyRef.current;
    if (!story) return;

    story.ChooseChoiceIndex(choiceIndex);
    let paragraph = "";
    while (story.canContinue && !paragraph) {
      paragraph = story.Continue()?.trim() ?? "";
    }

    if (paragraph) {
      const tags = parseTags(story.currentTags ?? []);
      const nextLine: InkLine = {
        id: Date.now(),
        text: paragraph,
        speaker: tags.SPEAKER || "narration",
        className: tags.CLASS || "narration",
        scene: tags.SCENE || scene,
      };
      setLines((current) => [...current, nextLine]);
      setScene(nextLine.scene);
    }

    readChoices(story);
    if (!story.canContinue && story.currentChoices.length === 0) setComplete(true);
  }, [readChoices, scene]);

  useEffect(() => {
    if (complete || lines.length === 0) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }
    currentLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [lines, choices, complete]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "Enter" || event.key === " " || event.key === "ArrowDown") && choices.length === 1) {
        event.preventDefault();
        continueStory(choices[0].index);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [choices, continueStory]);

  const progress = Math.min(100, (lines.length / TOTAL_STORY_LINES) * 100);
  const currentSpeaker = complete ? undefined : lines[lines.length - 1]?.speaker;

  useEffect(() => {
    if (!currentSpeaker) return;

    const scroller = dialogueRef.current;
    let frame = 0;
    const syncPortrait = () => {
      const line = currentLineRef.current;
      const portrait = portraitRef.current;
      if (!line || !portrait) return;
      const rect = line.getBoundingClientRect();
      portrait.style.top = `${Math.round(rect.top)}px`;
      portrait.style.visibility = rect.bottom > 66 && rect.top < window.innerHeight ? "visible" : "hidden";
    };
    const requestSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncPortrait);
    };

    requestSync();
    scroller?.addEventListener("scroll", requestSync, { passive: true });
    window.addEventListener("scroll", requestSync, { passive: true });
    window.addEventListener("resize", requestSync);
    return () => {
      cancelAnimationFrame(frame);
      scroller?.removeEventListener("scroll", requestSync);
      window.removeEventListener("scroll", requestSync);
      window.removeEventListener("resize", requestSync);
    };
  }, [currentSpeaker, lines.length, fontSize]);

  const renderChoices = () => (
    <div className="ink-choices" aria-label="继续阅读">
      {choices.map((choice) => {
        const label = cleanChoice(choice.text);
        const isStart = lines.length === 0;
        const isEnd = choice.text.includes("■");
        return (
          <button
            className={`ink-choice ${isStart ? "start" : ""} ${isEnd ? "end" : ""}`}
            key={`${choice.index}-${choice.text}`}
            onClick={() => continueStory(choice.index)}
          >
            <span>{isEnd ? "■" : "▸"}</span>
            {label || (isEnd ? "结束本幕" : "继续")}
          </button>
        );
      })}
    </div>
  );

  return (
    <main
      className="reader ink-reader"
      style={{
        "--reader-font-size": `${fontSize}px`,
        "--scene-image": `url(${assetBasePath}/assets/ramen-talk-painterly-street-v5.webp)`,
      } as React.CSSProperties}
    >
      <div className="reader-progress" style={{ width: `${progress}%` }} aria-hidden="true" />
      <header className="reader-topbar">
        <Link className="back" href="/">← 返回作品集</Link>
        <span className="reader-title">Ramen Talk: Empathy Module</span>
        <div className="reader-tools" aria-label="阅读设置">
          <button onClick={resetStory} aria-label="从头开始" title="从头开始">↺</button>
          <button onClick={() => setFontSize((size) => Math.max(17, size - 1))} aria-label="缩小字号">A−</button>
          <button onClick={() => setFontSize((size) => Math.min(28, size + 1))} aria-label="放大字号">A+</button>
        </div>
      </header>

      <div className="reader-layout">
        <aside className="scene-panel" data-scene={scene} aria-label={`当前场景：${sceneLabels[scene]}`}>
          <div className="scene-grain" />
          <div className="rain" />
          <div className="scene-architecture" />
          <div className="scene-person" />
          <p className="scene-caption">{sceneLabels[scene]}<br />ARCHIVE VISUAL 001</p>
        </aside>

        {currentSpeaker && portraitLabels[currentSpeaker] && (
          <figure ref={portraitRef} className={`speaker-portrait-dock speaker-portrait-dock--${currentSpeaker}`} key={currentSpeaker}>
            {currentSpeaker === "makoto" ? (
              <img
                src={`${assetBasePath}/assets/makoto-hoshizawa-profile.png`}
                width="1254"
                height="1254"
                alt="星沢真（Makoto Hoshizawa）人物肖像"
              />
            ) : (
              <img
                src={`${assetBasePath}/assets/noe-kurosaki-profile-v2.png`}
                width="1254"
                height="1254"
                alt="黑崎诺埃（Noé Kurosaki）人物肖像"
              />
            )}
            <figcaption>{portraitLabels[currentSpeaker]}</figcaption>
          </figure>
        )}

        <section ref={dialogueRef} className="dialogue-panel ink-dialogue" aria-live="polite">
          <div className="ink-stream">
            {lines.length === 0 && (
              <header className="story-heading ink-heading">
                <p className="chapter-label">RAMEN TALK / 01</p>
                <h1>Ramen Talk:<br />Empathy Module</h1>
                <p className="story-deck">高架桥下的雨夜拉面摊里，两个人借一碗变冷的面谈论人格、接口，以及一句不愿回答的话。</p>
              </header>
            )}

            {lines.map((line, index) => {
              const isEnvironment = line.speaker === "narration" || line.className === "environment";
              const speakerLabel = line.className === "thought"
                ? `${speakers[line.speaker] || line.speaker} · 心声`
                : speakers[line.speaker] || line.speaker;
              return (
                <article
                  className={`ink-line speaker-${line.speaker} ${line.className} ${index === lines.length - 1 ? "current" : "past"}`}
                  key={line.id}
                  ref={index === lines.length - 1 ? currentLineRef : undefined}
                  aria-label={isEnvironment ? "环境描写" : undefined}
                >
                  <div className="ink-copy">
                    <p>
                      {!isEnvironment && <strong>{speakerLabel} — </strong>}
                      {line.text}
                    </p>
                  </div>
                  {index === lines.length - 1 && portraitLabels[line.speaker] && (
                    <figure className={`speaker-portrait-inline speaker-portrait-inline--${line.speaker}`}>
                      <img
                        src={`${assetBasePath}/assets/${line.speaker === "makoto" ? "makoto-hoshizawa-profile.png" : "noe-kurosaki-profile-v2.png"}`}
                        width="1254"
                        height="1254"
                        alt={`${line.speaker === "makoto" ? "星沢真（Makoto Hoshizawa）" : "黑崎诺埃（Noé Kurosaki）"}人物肖像`}
                      />
                      <figcaption>{portraitLabels[line.speaker]}</figcaption>
                    </figure>
                  )}
                </article>
              );
            })}

            {renderChoices()}
            <div ref={endRef} />

            {complete && (
              <div className="ink-complete">
                <p className="completion-label">本幕已结束</p>
                <div className="character-bios" aria-label="人物简介">
                  <article className="character-bio character-bio--profile">
                    <img
                      className="character-profile"
                      src={`${assetBasePath}/assets/makoto-hoshizawa-profile.png`}
                      width="1254"
                      height="1254"
                      loading="lazy"
                      alt="星沢真（Makoto Hoshizawa）人物肖像"
                    />
                    <div className="character-bio-copy">
                      <h2>星沢真｜Makoto Hoshizawa</h2>
                      <p>公安部前技术特工，负责网络入侵、电子战与战场系统接管。曾与Noé被派往一场没有安排撤离方案的任务，并作为“不应存在的生还者”返回。此后真实身份遭到注销，政府为他生成了“星沢真”这一新身份，并将他安置在持续监控之下。现与Noé共同经营一家万能事务所，承接设备维修、情报调查，以及委托人自己也解释不清的麻烦。思想尖锐，悲观而刻薄，习惯用玩笑拆穿他人的自我安慰；几乎从不表达关心，只会替人修好设备、删除记录，并预先规划逃生路线。他的名字意味着“真实”，但关于他的所有官方资料都是伪造的。</p>
                    </div>
                  </article>
                  <article className="character-bio character-bio--profile">
                    <img
                      className="character-profile"
                      src={`${assetBasePath}/assets/noe-kurosaki-profile-v2.png`}
                      width="1254"
                      height="1254"
                      loading="lazy"
                      alt="黑崎诺埃（Noé Kurosaki）人物肖像"
                    />
                    <div className="character-bio-copy">
                      <h2>黑崎诺埃｜Noé Kurosaki</h2>
                      <p>公安部前外勤特工，擅长渗透、交涉、近身行动与身份伪装。新档案称他拥有日法血统，但他从未确认这段身世是否真实——也没有表现出确认的兴趣。与Makoto从同一场必死任务中生还后，被赋予新身份并安置在万能事务所，负责接待客户、处理外勤，以及在Makoto得罪委托人以后挽救生意。性格随性，信奉知足常乐，认为活着本身就是一种不太体面的胜利；喜欢拉面、便利店积分和一切无法被写进任务报告的小事。他从不追究自己原本是谁，因为对他而言，继续生活远比证明究竟是谁在生活更重要。</p>
                    </div>
                  </article>
                </div>
                <Link href="/">返回短篇档案 →</Link>
              </div>
            )}
          </div>
          <p className="keyboard-hint">ENTER / SPACE 继续</p>
        </section>
      </div>
    </main>
  );
}
