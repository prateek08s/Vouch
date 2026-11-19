import { Suspense } from "react";
import Link from "next/link";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { discoverPicks } from "@/lib/public/discover";
import { loadTopics, groupedTopics } from "@/lib/topics";
import { plural } from "@/lib/format";
import { PublicPicks } from "@/app/components/PublicPicks";

export const metadata = { title: "Discover worthwhile videos", description: "The best-recommended videos on Vouch, each with a human reason to watch." };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function Discover(props: PageProps<"/discover">) {
  return (
    <>
      <header className="page-head">
        <h1>Discover</h1>
        <p>The best-recommended videos on Vouch, from everyone, not only people you follow. Ranked by recent Worth-it ratings and how many people recommend them.</p>
      </header>
      <Suspense fallback={<p className="muted">Loading recommendations…</p>}>
        <Picks {...props} />
      </Suspense>
    </>
  );
}

async function Picks({ searchParams }: PageProps<"/discover">) {
  const sp = await searchParams;
  const topic = one(sp.topic) || null;
  const cursor = Math.max(0, Number(one(sp.page)) || 0);
  const [user, db] = await Promise.all([getCurrentUser(), getDb()]);
  const [res, index] = await Promise.all([discoverPicks(db, user?.id ?? null, { topic, cursor }), loadTopics(db)]);
  const roots = groupedTopics(index).map((g) => g.root);
  const href = (t: string | null, page?: number) => {
    const q = new URLSearchParams();
    if (t) q.set("topic", t);
    if (page) q.set("page", String(page));
    const s = q.toString();
    return s ? `/discover?${s}` : "/discover";
  };
  return (
    <>
      <nav className="chips topic-filter" aria-label="Filter by topic">
        <Link className={topic ? "chip-link" : "chip-link on"} href={href(null)} aria-current={topic ? undefined : "page"}>All</Link>
        {roots.map((t) => (
          <Link key={t.slug} className={topic === t.slug ? "chip-link on" : "chip-link"} href={href(t.slug)} aria-current={topic === t.slug ? "page" : undefined}>
            {t.name}
          </Link>
        ))}
      </nav>
      <PublicPicks picks={res.picks} />
      <div className="more">
        {res.nextCursor !== null && <Link className="button ghost" href={href(topic, res.nextCursor)}>Show more</Link>}
        {res.hiddenByRules > 0 && <p className="muted">{plural(res.hiddenByRules, "video is", "videos are")} hidden by your <Link href="/settings/rules">rules</Link>.</p>}
      </div>
    </>
  );
}
