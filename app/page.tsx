import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { circleFeed, logImpressions } from "@/lib/feed/circle";
import { recordImpressions } from "@/lib/analytics";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { formatDuration, greeting, initials, plural } from "@/lib/format";
import { publicPicks } from "@/lib/public";
import { discoverPicks } from "@/lib/public/discover";
import { RecommendationCard } from "./components/RecommendationCard";
import { PublicPicks } from "./components/PublicPicks";
import { Facts } from "./components/Facts";
import { deleteRuleAction } from "./actions";
import { listRules } from "@/lib/rules";
import { describeRule } from "@/lib/rules/describe";
import { upNextFromLists, type UpNext } from "@/lib/lists";

export default async function CirclePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<p className="muted">Finding what your circle vouched for…</p>}>
      <Circle searchParams={searchParams} />
    </Suspense>
  );
}

async function Circle({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const user = await getCurrentUser();
  if (!user) return <Landing deleted={(await searchParams).deleted === "1"} />;

  // New people pick topics and first follows before their (otherwise empty) Circle.
  if (!user.onboarded_at) redirect("/onboarding");

  const sp = await searchParams;
  const cursor = Math.max(0, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 0);
  const blockedId = Array.isArray(sp.blocked) ? sp.blocked[0] : sp.blocked;
  const db = await getDb();
  const [page, upNext] = await Promise.all([circleFeed(db, user.id, { cursor }), cursor === 0 ? upNextFromLists(db, user.id) : []]);
  // What was shown, for Worth-It rates per explanation (plan 26, H1 to H4). Reloads within 6 hours count once.
  await Promise.all([
    logImpressions(db, user.id, page.items),
    recordImpressions(db, user.id, "list", upNext.map((u) => ({ resourceId: u.item.resource_id, explanationCode: "list_next" }))),
  ]);
  const banner = blockedId ? await BlockedBanner({ userId: user.id, ruleId: blockedId }) : null;
  const firstName = user.display_name.split(" ")[0];

  if (!page.items.length && cursor === 0) {
    const popular = page.hiddenByRules > 0 ? null : await discoverPicks(db, user.id, { limit: 6 });
    return (
      <>
        {banner}
        <header className="page-head circle-head">
          <h1>{greeting(new Date())}, {firstName}.</h1>
        </header>
        {page.hiddenByRules > 0 ? (
          <div className="empty">
            <strong>Your rules are hiding everything new.</strong>
            <p>
              Your circle vouched for {plural(page.hiddenByRules, "video", "videos")}, and your rules hid{" "}
              {page.hiddenByRules === 1 ? "it" : "all of them"}. Loosen a rule if you want to see more.
            </p>
            <div className="actions"><Link className="button" href="/settings/rules">Review your rules</Link></div>
          </div>
        ) : (
          <div className="empty">
            <strong>Nothing new from your circle.</strong>
            <p>Follow a few people whose taste you trust, and their vouches will show up here.</p>
            <div className="actions">
              <Link className="button" href="/people">Find people to follow</Link>
              <Link className="button ghost" href="/discover">Browse Discover</Link>
            </div>
          </div>
        )}
        <UpNextSection items={upNext} />
        {popular && popular.picks.length > 0 && (
          <section className="section" aria-labelledby="popular-h">
            <h2 id="popular-h" className="section-title">Popular on Vouch</h2>
            <p className="section-note">Not from your circle: the best-recommended picks from everyone.</p>
            <PublicPicks picks={popular.picks} />
          </section>
        )}
      </>
    );
  }

  const shown = cursor + page.items.length;
  return (
    <>
      {banner}
      <header className="page-head wide circle-head">
        <h1>{greeting(new Date())}, {firstName}.</h1>
        <p>
          {plural(page.curatorCount, "person you trust", "people you trust")} found{" "}
          {plural(shown, "thing", "things")}
          {page.nextCursor !== null ? "+" : ""} worth watching.
        </p>
      </header>

      <div className="feed">
        {page.items.map((item, index) => (
          <RecommendationCard key={item.resourceId} item={item} priority={index === 0} />
        ))}
      </div>

      {page.nextCursor !== null ? (
        <div className="more">
          <Link className="button ghost" href={`/?page=${page.nextCursor}`}>Show a few more</Link>
        </div>
      ) : (
        <footer className="caught-up">
          <span className="check-mark" aria-hidden="true">✓</span>
          <strong>You’re caught up.</strong>
          <p className="muted">That’s everything your circle vouched for. Go watch something worth your time.</p>
          {page.hiddenByRules > 0 && (
            <p className="muted">
              {plural(page.hiddenByRules, "video was", "videos were")} hidden by your <Link href="/settings/rules">rules</Link>.
            </p>
          )}
        </footer>
      )}

      <UpNextSection items={upNext} />
    </>
  );
}

/** Signed out: say what Vouch is, and show a real vouch rather than describing one. */
async function Landing({ deleted = false }: { deleted?: boolean }) {
  const picks = await publicPicks(await getDb());
  const specimen = picks.find((p) => p.note) ?? picks[0];
  const rest = picks.filter((p) => p !== specimen).slice(0, 6);
  return (
    <>
      {deleted && <div className="notice" role="status"><span>Your account and everything in it was deleted.</span></div>}
      <section className="landing" aria-labelledby="landing-h">
        <div>
          <h1 id="landing-h">Videos worth your time, picked by people you trust.</h1>
          <p className="lede">
            Vouch replaces the recommendation algorithm with people. Follow curators whose taste you trust, and every
            video in your feed tells you who picked it and why.
          </p>
          <div className="actions">
            <Link className="button large" href="/signin">Build your Circle</Link>
            <Link className="button ghost large" href="/discover">Browse picks</Link>
          </div>
          <ul className="landing-points">
            <li>Every pick names the person who vouched for it.</li>
            <li>Your rules always win. Block a channel and it never comes back.</li>
            <li>Your feed ends. No endless scroll, no autoplay.</li>
          </ul>
        </div>
        {specimen && (
          <figure className="specimen" aria-label="An example vouch">
            <div className="byline">
              <span className="avatar" aria-hidden="true">{initials(specimen.curator)}</span>
              <span className="byline-text">
                <strong>Vouched by {specimen.curator}</strong>
                <span>@{specimen.username}</span>
              </span>
            </div>
            {specimen.note && <blockquote className="note">{specimen.note}</blockquote>}
            <a className="frame" href={specimen.canonical_url} target="_blank" rel="noreferrer">
              {specimen.thumbnail_url ? <Image unoptimized src={specimen.thumbnail_url} alt="" fill sizes="(max-width: 52rem) 100vw, 32rem" priority /> : <span className="placeholder">Vouch</span>}
            </a>
            <strong className="rec-title">{specimen.title}</strong>
            <figcaption className="specimen-why">
              In your Circle, every pick says why it’s there: <b>who vouched for it</b>, and how often their picks were worth it to you.
            </figcaption>
          </figure>
        )}
      </section>
      {rest.length > 0 && (
        <section className="section" aria-labelledby="recent-h">
          <h2 id="recent-h" className="section-title">Recently vouched</h2>
          <p className="section-note">A sample of public picks. Sign in to see the ones from people you follow.</p>
          <PublicPicks picks={rest} />
        </section>
      )}
    </>
  );
}

/** Plan flow C: confirm the new rule right where the item disappeared, with an undo. */
async function BlockedBanner({ userId, ruleId }: { userId: string; ruleId: string }) {
  const db = await getDb();
  const rule = (await listRules(db, userId)).find((r) => r.id === ruleId);
  if (!rule) return null;
  const [ch] = await db.query<{ name: string }>(
    "select creator_name as name from resources where creator_external_id = $1 and creator_name is not null limit 1",
    [rule.value],
  );
  const label = describeRule(rule, { channelNames: new Map(ch ? [[rule.value, ch.name]] : []), topicNames: new Map() });
  return (
    <div className="notice" role="status">
      <span><strong>Rule added:</strong> {label}.</span>
      <form action={deleteRuleAction}>
        <input type="hidden" name="ruleId" value={rule.id} />
        <input type="hidden" name="back" value="circle" />
        <button className="link-button">Undo</button>
      </form>
      <Link href="/settings/rules">See all rules</Link>
    </div>
  );
}

/** Lists are paths: show the next step in each followed list, not a re-ranked mix. */
function UpNextSection({ items }: { items: UpNext[] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="upnext-h" className="upnext">
      <h2 id="upnext-h" className="section-title">Up next in your lists</h2>
      <p className="section-note">The next unwatched video in each list you follow.</p>
      <ul className="upnext-grid">
        {items.map((u) => (
          <li key={u.listId}>
            <span className="step">
              Video {u.index + 1} of {u.total} in <Link href={`/lists/${u.listId}`}>{u.listTitle}</Link>
            </span>
            <div className="progress" aria-hidden="true">
              <span style={{ width: `${Math.round((u.index / Math.max(1, u.total)) * 100)}%` }} />
            </div>
            <Link className="title" href={`/watch/${u.item.resource_id}`}>{u.item.title}</Link>
            <Facts items={[`List by ${u.ownerName}`, formatDuration(u.item.duration_s)]} />
            {u.item.note && <p className="note sm indent">{u.item.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
