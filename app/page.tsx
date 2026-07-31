import Link from "next/link";

const stories = [
  {
    title: "Ramen Talk: Empathy Module",
    date: "2026.07.31",
    dateTime: "2026-07-31",
    href: "/stories/rain-atlas",
  },
];

export default function Home() {
  return (
    <div className="archive-page">
      <header className="archive-header">
        <h1>Thoughts &amp; Stories</h1>
      </header>

      <main className="archive-home">
        <ol className="archive-index">
          {stories.map((story) => (
            <li key={story.href}>
              <Link href={story.href}>
                <time dateTime={story.dateTime}>{story.date}</time>
                <span>{story.title}</span>
              </Link>
            </li>
          ))}
        </ol>
      </main>

      <footer className="archive-footer">
        <small>Copyright © a_suozhang</small>
      </footer>
    </div>
  );
}
