import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { search } from "@/lib/search";
import { groupedTopics, loadTopics } from "@/lib/topics";
import { formatDuration, plural } from "@/lib/format";

export const metadata: Metadata = { title: "Search" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <>
      <h1>Search</h1>
      <p className="intro">Only things someone vouched for. Try a topic, a title, or <code>@username</code>.</p>
      <Suspense fallback={<p>Searching…</p>}>
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
  const [res, topics] = await Promise.all([search(db, user.id, q, { circleOnly, topic }), loadTopics(db)]);
  const groups = groupedTopics(topics);
  const searched = Boolean(q.trim() || topic);

  return (
    <>
      <form role="search" action="/search" className="search-form">
        <label htmlFor="q" className="skip-label">Search vouched videos</label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="transformers, @priya, GPU…" autoComplete="off" />
        <select name="topic" defaultValue={topic ?? ""} aria-label="Topic">
          <option value="">All topics</option>
          {groups.map((g) => (
            <optgroup key={g.root.id} label={g.root.name}>
              {g.topics.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.depth === 0 ? `All ${t.name}` : `${"  ".repeat(t.depth - 1)}${t.name}`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" name="circle" value="1" defaultChecked={circleOnly} />
          <span>Circle only</span>
        </label>
        <button className="button">Search</button>
      </form>

      {searched && (
        <p className="trust-tag" role="status">
          {plural(res.results.length, "result", "results")}
          {res.query.curator && ` vouched by @${res.query.curator}`}
          {circleOnly && " from your circle"}
          {res.hiddenByRules > 0 && ` · ${plural(res.hiddenByRules, "more was", "more were")} hidden by your rules`}
        </p>
      )}

      {res.lists.length > 0 && (
        <section aria-labelledby="lists-h">
          <h2 id="lists-h" className="eyebrow">Lists</h2>
          <ul className="people">
            {res.lists.map((l) => (
              <li key={l.id}>
                <span className="grow">
                  <Link href={`/lists/${l.id}`}><strong>{l.title}</strong></Link>
                  <small>by {l.ownerName} · {plural(l.itemCount, "video", "videos")}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {res.results.length > 0 && (
        <ol className="list-items" aria-label="Videos">
          {res.results.map((r) => (
            <li key={r.resourceId}>
              {r.thumbnailUrl && <Image className="thumb list-thumb" src={r.thumbnailUrl} alt="" width={160} height={90} />}
              <span className="grow">
                <Link href={`/watch/${r.resourceId}`}><strong>{r.title}</strong></Link>
                <small>
                  {[r.creatorName, formatDuration(r.durationS), r.topics.join(", ") || null].filter(Boolean).join(" · ")}
                </small>
                <small>
                  {r.circleVouchers.length
                    ? `Vouched by ${r.circleVouchers.slice(0, 2).join(" and ")}${r.circleVouchers.length > 2 ? ` and ${r.circleVouchers.length - 2} more` : ""} in your circle`
                    : `${plural(r.vouchCount, "vouch", "vouches")}, none from your circle yet`}
                </small>
                {r.topNote && <small>“{r.topNote.text}” · {r.topNote.by}</small>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {searched && !res.results.length && !res.lists.length && (
        <div className="empty" style={{ marginTop: "1.5rem" }}>
          <p><strong>No one has vouched for that yet.</strong></p>
          <p>Found something worth it? <Link href="/vouch">Be the first to vouch</Link>.</p>
        </div>
      )}
    </>
  );
}
