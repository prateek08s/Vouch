import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { search } from "@/lib/search";
import { allow, LIMIT_MESSAGE } from "@/lib/limits";
import { recordImpressions } from "@/lib/analytics";
import { groupedTopics, loadTopics } from "@/lib/topics";
import { formatDuration, plural } from "@/lib/format";
import { Facts } from "@/app/components/Facts";

export const metadata: Metadata = { title: "Search" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <>
      <header className="page-head">
        <h1>Search</h1>
        <p>Only videos someone vouched for. Search a title or topic, or a curator with <code>@username</code>.</p>
      </header>
      <Suspense fallback={<p className="muted">Searching…</p>}>
        <Results {...props} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: PageProps<"/search">) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 200);
  const circleOnly = one(sp.circle) === "1";
  const topic = one(sp.topic) || null;

  const db = await getDb();
  if ((q.trim() || topic) && !(await allow(db, "search", user.id))) {
    return <div className="empty" role="alert"><strong>Too many searches.</strong><p>{LIMIT_MESSAGE}</p></div>;
  }
  const [res, topics] = await Promise.all([search(db, user.id, q, { circleOnly, topic }), loadTopics(db)]);
  const groups = groupedTopics(topics);
  const searched = Boolean(q.trim() || topic);
  // Circle-backed results are the human signal worth comparing with plain matches.
  await recordImpressions(db, user.id, "search", res.results.map((r) => ({
    resourceId: r.resourceId,
    explanationCode: r.circleVouchers.length ? "search_circle" : "search_match",
  })));

  return (
    <>
      <form role="search" action="/search" className="search-form">
        <div className="search-box">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.75" />
            <path d="m13 13 4.25 4.25" strokeLinecap="round" />
          </svg>
          <label htmlFor="q" className="skip-label">Search vouched videos</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="transformers, @priya, GPU…" autoComplete="off" />
        </div>
        <button className="button">Search</button>
        <div className="search-filters">
          <select name="topic" defaultValue={topic ?? ""} aria-label="Topic">
            <option value="">All topics</option>
            {groups.map((g) => (
              <optgroup key={g.root.id} label={g.root.name}>
                {g.topics.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.depth === 0 ? `All ${t.name}` : `${"  ".repeat(t.depth - 1)}${t.name}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" name="circle" value="1" defaultChecked={circleOnly} />
            <span>Only from my circle</span>
          </label>
        </div>
      </form>

      {searched && (
        <p className="result-count" role="status">
          {plural(res.results.length, "result", "results")}
          {res.query.curator && ` vouched by @${res.query.curator}`}
          {circleOnly && " from your circle"}
          {res.hiddenByRules > 0 && `. ${plural(res.hiddenByRules, "more was", "more were")} hidden by your rules.`}
        </p>
      )}

      {res.lists.length > 0 && (
        <section className="section" aria-labelledby="lists-h" style={{ marginTop: "1.5rem" }}>
          <h2 id="lists-h" className="section-title">Lists</h2>
          <ul className="rows">
            {res.lists.map((l) => (
              <li key={l.id}>
                <span className="grow">
                  <Link href={`/lists/${l.id}`}>{l.title}</Link>
                  <Facts items={[`By ${l.ownerName}`, plural(l.itemCount, "video", "videos")]} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {res.results.length > 0 && (
        <section className="section" aria-labelledby="videos-h" style={{ marginTop: "2rem" }}>
          {res.lists.length > 0 && <h2 id="videos-h" className="section-title">Videos</h2>}
          <ol className="list-items" aria-labelledby={res.lists.length > 0 ? "videos-h" : undefined} aria-label={res.lists.length > 0 ? undefined : "Videos"}>
            {res.results.map((r) => (
              <li key={r.resourceId}>
                {r.thumbnailUrl && <Image unoptimized className="thumb list-thumb" src={r.thumbnailUrl} alt="" width={160} height={90} />}
                <span className="grow">
                  <Link href={`/watch/${r.resourceId}`}>{r.title}</Link>
                  <Facts items={[r.creatorName, formatDuration(r.durationS), r.topics.join(", ") || null]} />
                  <span className="muted">
                    {r.circleVouchers.length
                      ? `Vouched by ${r.circleVouchers.slice(0, 2).join(" and ")}${r.circleVouchers.length > 2 ? ` and ${r.circleVouchers.length - 2} more` : ""} in your circle`
                      : `${plural(r.vouchCount, "vouch", "vouches")}, none from your circle yet`}
                  </span>
                  {r.topNote && <span className="item-note">“{r.topNote.text}” <span className="muted">{r.topNote.by}</span></span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {searched && !res.results.length && !res.lists.length && (
        <div className="empty">
          <strong>No one has vouched for that yet.</strong>
          <p>Try a broader word or a parent topic. Found something worth it yourself?</p>
          <div className="actions"><Link className="button" href="/vouch">Vouch for a video</Link></div>
        </div>
      )}
    </>
  );
}
