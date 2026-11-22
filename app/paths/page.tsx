import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getDb } from "@/lib/server/db";
import { PATH_LEVELS, publicPaths } from "@/lib/paths";
import { formatDuration, plural } from "@/lib/format";

export const metadata = { title: "Learning paths", description: "Human-curated videos arranged into learning paths with prerequisites and clear outcomes." };
export default function PathsPage() {
  return <>
    <header className="page-head"><h1>Learning paths</h1><p>Learn toward an outcome, one lesson at a time.</p></header>
    <Suspense fallback={<p className="muted">Loading learning paths…</p>}><Paths /></Suspense>
  </>;
}
async function Paths() {
  await connection();
  const paths = await publicPaths(await getDb());
  return <>
    <p className="section-note"><Link href="/roadmaps">Explore learning roadmaps</Link> · <Link href="/lists">Browse collections or create your own path</Link>. Prerequisites and levels are set by each curator.</p>
    {!paths.length ? <div className="empty"><strong>No public learning paths yet.</strong><p>Turn a collection into a path by adding learning outcomes and prerequisites in its settings.</p><Link href="/lists" className="button">Go to collections</Link></div> :
      <ul className="rows">{paths.map((path) => <li key={path.id}><div className="grow">
        <h2><Link href={`/lists/${path.id}`}>{path.title}</Link></h2>
        <p className="muted">{PATH_LEVELS[path.level]} · {plural(path.lesson_count, "lesson", "lessons")} · {path.duration_s > 0 ? `${path.unknown_runtime ? "At least " : ""}${formatDuration(path.duration_s)}` : "Runtime not available"} · By {path.owner_name}</p>
        {path.description && <p>{path.description}</p>}
        <p>{path.outcomes[0]}</p>
      </div></li>)}</ul>}
  </>;
}
