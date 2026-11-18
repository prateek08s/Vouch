import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { getWatchData } from "@/lib/watch";
import { hnMentionsFor } from "@/lib/hn/import";
import { markOpened } from "@/lib/analytics";
import { TRUST_LABEL, formatDuration, initials, plural } from "@/lib/format";
import { blockChannelAction, rateAction } from "@/app/actions";
import { AddToList } from "@/app/lists/ListForms";
import { Facts } from "@/app/components/Facts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function WatchPage(props: PageProps<"/watch/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading the video…</p>}>
      <Watch {...props} />
    </Suspense>
  );
}

async function Watch({ params, searchParams }: PageProps<"/watch/[id]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const viaRaw = Array.isArray(sp.via) ? sp.via[0] : sp.via;
  const via = viaRaw && UUID.test(viaRaw) ? viaRaw : null;

  const db = await getDb();
  const w = await getWatchData(db, user.id, id, via);
  if (!w) notFound();
  // Opening a recommendation is the step between "shown" and "worth it".
  await markOpened(db, user.id, id);
  const myLists = await db.query<{ id: string; title: string; has: boolean }>(
    `select l.id, l.title, exists (select 1 from list_items li where li.list_id = l.id and li.resource_id = $2) as has
     from lists l where l.owner_id = $1 order by l.created_at desc`,
    [user.id, id],
  );
  const hn = await hnMentionsFor(db, id);
  const r = w.resource;
  const runtime = formatDuration(r.duration_s);
  // Official embed, privacy-enhanced domain, no autoplay (plan 30: avoid autoplay).
  const embed = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(r.external_id)}?rel=0`;
  const outside = w.publicVouchCount - w.notes.length;

  return (
    <>
      <article className="watch">
        <div>
          <div className="player">
            <iframe
              src={embed}
              title={`YouTube video player: ${r.title}`}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>

          <h1 className="watch-title">{r.title}</h1>
          <Facts items={[r.creator_name, runtime, ...w.topics.map((t) => t.name)]} />

          <div className="watch-tools">
            <a className="tool" href={r.canonical_url} target="_blank" rel="noreferrer">Open on YouTube</a>
            <AddToList resourceId={r.id} lists={myLists} />
            {r.creator_external_id && (
              <form action={blockChannelAction} className="inline-form">
                <input type="hidden" name="resourceId" value={r.id} />
                <button className="link-button">Never show {r.creator_name ?? "this channel"}</button>
              </form>
            )}
          </div>
        </div>

        <aside className="watch-aside" aria-label="About this pick">
          {w.via && (
            <p className="via">
              <span className="avatar sm" aria-hidden="true">{initials(w.via.curatorName)}</span>
              <span>
                Reached you through <strong>{w.via.curatorName}</strong>.{" "}
                {w.via.inCircle ? "You follow them." : "You don’t follow them yet."}
              </span>
            </p>
          )}

          <WorthIt resourceId={r.id} via={w.via?.vouchId ?? ""} rating={w.rating} viaName={w.via?.curatorName ?? null} />

          {w.notes.length > 0 && (
            <section aria-labelledby="notes-h">
              <h2 id="notes-h" className="section-title">Why your circle vouched</h2>
              <ul className="notes">
                {w.notes.map((n) => (
                  <li key={n.vouchId}>
                    <div className="byline">
                      <span className="avatar" aria-hidden="true">{initials(n.curatorName)}</span>
                      <span className="byline-text">
                        <strong>{n.curatorName}</strong>
                        <span>{TRUST_LABEL[n.trustLevel]}</span>
                      </span>
                      {n.isOwnContent && <span className="pill creator">Creator vouch</span>}
                    </div>
                    {n.note && <blockquote className="note">{n.note}</blockquote>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {outside > 0 && (
            <p className="muted">
              {plural(outside, "more person", "more people")} outside your circle vouched for this.
            </p>
          )}
        </aside>
      </article>

      {hn.total > 0 && (
        <section className="hn" aria-labelledby="hn-h">
          <h2 id="hn-h" className="section-title">Recommended on Hacker News</h2>
          <p className="section-note">
            {plural(hn.total, "commenter", "commenters")} recommended this
            {hn.total > hn.mentions.length ? `. Showing the latest ${hn.mentions.length}.` : "."}
          </p>
          <ul className="notes">
            {hn.mentions.map((m) => (
              <li key={m.commentId}>
                <div className="byline">
                  <span className="avatar" aria-hidden="true">{initials(m.author)}</span>
                  <span className="byline-text">
                    <strong>{m.author}</strong>
                    <a href={m.url} target="_blank" rel="noreferrer">
                      Comment from {m.postedAt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}
                    </a>
                  </span>
                </div>
                {m.excerpt && <blockquote className="note">{m.excerpt}</blockquote>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="back"><Link href="/">Back to your Circle</Link></p>
    </>
  );
}

function WorthIt({ resourceId, via, rating, viaName }: { resourceId: string; via: string; rating: boolean | null; viaName: string | null }) {
  return (
    <section className="worth" aria-labelledby="worth-h">
      <h2 id="worth-h">Was this worth your time?</h2>
      <form action={rateAction} className="verdicts">
        <input type="hidden" name="resourceId" value={resourceId} />
        <input type="hidden" name="via" value={via} />
        <button className="verdict yes" name="verdict" value="worth" aria-pressed={rating === true}>Worth it</button>
        <button className="verdict no" name="verdict" value="not" aria-pressed={rating === false}>Not worth it</button>
      </form>
      {rating === null ? (
        <p>Private to you. It teaches Vouch whose picks work for you{viaName ? `, starting with ${viaName}` : ""}.</p>
      ) : (
        <p className="done" role="status">
          {rating ? "Saved as Worth it. Thanks for closing the loop." : "Saved as Not worth it. Similar picks will weigh a little less."}
        </p>
      )}
    </section>
  );
}
