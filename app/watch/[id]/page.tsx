import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { getWatchData } from "@/lib/watch";
import { hnMentionsFor } from "@/lib/hn/import";
import { markOpened } from "@/lib/analytics";
import { recordOpen } from "@/lib/ratings";
import { TRUST_LABEL, formatDuration, initials, monthYear, plural } from "@/lib/format";
import { blockChannelAction, rateAction, reportAction } from "@/app/watch/actions";
import { REASON_LABEL, REPORT_REASONS } from "@/lib/moderation";
import { AddToList } from "@/app/lists/ListForms";
import { myListsFor } from "@/lib/lists";
import { Facts } from "@/app/components/Facts";
import { LocalActions } from "@/app/components/local/LocalActions";
import { socialEnabled } from "@/lib/flags";
import { recordAnon } from "@/lib/experiment";
import { anonContext } from "@/lib/experiment/server";

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
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const viaRaw = Array.isArray(sp.via) ? sp.via[0] : sp.via;
  const via = viaRaw && UUID.test(viaRaw) ? viaRaw : null;

  const db = await getDb();
  const w = await getWatchData(db, user?.id ?? null, id, via);
  if (!w) notFound();
  const social = socialEnabled();
  const anon = await anonContext();
  if (anon) await recordAnon(db, anon.anonId, anon.variant, "open", [id]);
  if (user) {
    // Opening a recommendation is the step between "shown" and "worth it". Credit goes to the
    // curator whose pick the person opened first (recordOpen keeps the first attribution).
    await markOpened(db, user.id, id);
    if (via) await recordOpen(db, { userId: user.id, resourceId: id, vouchId: via });
  }
  const myLists = user ? await myListsFor(db, user.id, id) : [];
  const hn = await hnMentionsFor(db, id, 10);
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
            {user && <AddToList resourceId={r.id} lists={myLists} />}
            <LocalActions resourceId={r.id} title={r.title} thumb={r.thumbnail_url} rate={false} />
            {user && r.creator_external_id && (
              <form action={blockChannelAction} className="inline-form">
                <input type="hidden" name="resourceId" value={r.id} />
                <button className="link-button">Never show {r.creator_name ?? "this channel"}</button>
              </form>
            )}
          </div>
        </div>

        <aside className="watch-aside" aria-label="About this pick">
          {social && w.via && (
            <p className="via">
              <span className="avatar sm" aria-hidden="true">{initials(w.via.curatorName)}</span>
              <span>
                Reached you through <strong>{w.via.curatorName}</strong>.{" "}
                {w.via.inCircle ? "You follow them." : "You don’t follow them yet."}
              </span>
            </p>
          )}

          {user ? (
            <WorthIt resourceId={r.id} via={w.via?.vouchId ?? ""} rating={w.rating} viaName={social ? w.via?.curatorName ?? null : null} />
          ) : !social ? (
            <LocalActions resourceId={r.id} title={r.title} thumb={r.thumbnail_url} rate />
          ) : (
            <section className="worth" aria-labelledby="worth-h">
              <h2 id="worth-h">Was this worth your time?</h2>
              <p>Sign in to rate it, save it to a list, and get picks like this from people you trust.</p>
              <div className="actions"><Link className="button" href="/signin">Sign in to rate</Link></div>
            </section>
          )}

          {w.notes.length > 0 && (
            <section aria-labelledby="notes-h">
              <h2 id="notes-h" className="section-title">{user && social ? "Why your circle vouched" : "Why people vouched"}</h2>
              <ul className="notes">
                {w.notes.map((n) => {
                  // An imported note is a quote: credit the commenter who wrote it, not the importer.
                  const quoted = n.isSystem ? hn.mentions.find((m) => m.excerpt && m.excerpt === n.note) ?? null : null;
                  return (
                  <li key={n.vouchId}>
                    <div className="byline">
                      <span className="avatar" aria-hidden="true">{initials(quoted?.author ?? n.curatorName)}</span>
                      <span className="byline-text">
                        <strong>{quoted?.author ?? n.curatorName}</strong>
                        {quoted && (
                          <a href={quoted.url} target="_blank" rel="noreferrer">
                            on Hacker News, {monthYear(quoted.postedAt)}
                          </a>
                        )}
                        {user && social && <span>{TRUST_LABEL[n.trustLevel]}</span>}
                      </span>
                      {n.isOwnContent && <span className="pill creator">Creator vouch</span>}
                    </div>
                    {n.note && <blockquote className="note">{n.note}</blockquote>}
                    {user && n.note && (w.reported.includes(n.vouchId) ? (
                      <p className="report-done">Reported. Thanks, an admin will review it.</p>
                    ) : (
                      <details className="report">
                        <summary>Report</summary>
                        <form action={reportAction}>
                          <input type="hidden" name="vouchId" value={n.vouchId} />
                          <fieldset>
                            <legend>What&apos;s wrong with this note?</legend>
                            {REPORT_REASONS.map((r, i) => (
                              <label key={r}>
                                <input type="radio" name="reason" value={r} required defaultChecked={i === 0} /> {REASON_LABEL[r]}
                              </label>
                            ))}
                          </fieldset>
                          <label>
                            Details (optional)
                            <textarea name="details" maxLength={500} rows={2} />
                          </label>
                          <button type="submit" className="button small">Send report</button>
                        </form>
                      </details>
                    ))}
                  </li>
                  );
                })}
              </ul>
            </section>
          )}
          {user && social && outside > 0 && (
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
      <p className="back"><Link href="/">{user && social ? "Back to your Circle" : "Browse more picks"}</Link></p>
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
