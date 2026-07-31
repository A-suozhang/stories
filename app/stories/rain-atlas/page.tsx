import type { Metadata } from "next";
import Reader from "./reader";

export const metadata: Metadata = {
  title: "Ramen Talk: Empathy Module",
  description: "雨夜拉面店里，两个人谈论一枚即将被移除的共情模块。",
};

export default function StoryPage() {
  return <Reader />;
}
