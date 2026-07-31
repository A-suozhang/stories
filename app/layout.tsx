import type { Metadata } from "next";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource/commit-mono/400.css";
import "@fontsource/commit-mono/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Thoughts & Stories",
    template: "%s | Thoughts & Stories",
  },
  description: "Thoughts and short stories by a_suozhang.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
