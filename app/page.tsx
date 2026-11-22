import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { circleFeed, logImpressions } from "@/lib/feed/circle";
import { recordImpressions } from "@/lib/analytics";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { formatDuration, greeting, monthYear, plural } from "@/lib/format";
import { discoverPicks } from "@/lib/public/discover";
import { RecommendationCard } from "./components/RecommendationCard";
import { DiscoverFeed } from "./components/DiscoverFeed";
import { socialEnabled } from "@/lib/flags";
import { PublicPicks } from "./components/PublicPicks";
import { Facts } from "./components/Facts";
import { deleteRuleAction } from "@/app/settings/rules/actions";
import { listRules } from "@/lib/rules";
import { describeRule } from "@/lib/rules/describe";
import { channelNames } from "@/lib/rules/channels";
import { upNextFromLists, type UpNext } from "@/lib/lists";

export default async function CirclePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<p className="muted">Loading picks…</p>}>
      <Circle searchParams={searchParams} />
    </Suspense>
  );
}

async function Circle({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const user = await getCurrentUser();
  // Until there are real curators to follow, everyone's home is Discover (critique, changes 1 and 5).
  if (!user || !socialEnabled()) {
    return <Home signedIn={Boolean(user)} searchParams={searchParams} />;
  }

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

/** Home: what Vouch is, in one line, then the picks themselves. Nothing to sign up for first. */
async function Home({ signedIn, searchParams }: { signedIn: boolean; searchParams: PageProps<"/">["searchParams"] }) {
  const sp = await searchParams;
  const stats = await catalogStats(await getDb());
  return (
    <>
      {sp.deleted === "1" && <div className="notice" role="status"><span>Your account and everything in it was deleted.</span></div>}
      {signedIn ? (
        <header className="page-head">
          <h1>Discover</h1>
          <p>Long videos Hacker News commenters recommended, each with the comment that recommended it.</p>
        </header>
      ) : (
        <section className="hero" aria-labelledby="hero-h">
          <h1 id="hero-h">Long videos Hacker News recommends, with the comment that recommended them.</h1>
          <p className="lede">
            {stats.videos.toLocaleString("en-US")} talks, lectures and documentaries that HN commenters said were worth
            watching{stats.latest ? `, up to ${monthYear(stats.latest)}` : ""}. No account needed: save, rate and hide
            what you&apos;ve watched, right here.
          </p>
        </section>
      )}
      <Suspense fallback={<p className="muted">Loading picks…</p>}>
        <DiscoverFeed searchParams={searchParams} base="/" />
      </Suspense>
    </>
  );
}

async function catalogStats(db: Awaited<ReturnType<typeof getDb>>) {
  const [row] = await db.query<{ videos: number; latest: Date | null }>(
    `select (select count(distinct v.resource_id)::int from vouches v where v.hidden_at is null) as videos,
            (select max(posted_at) from hn_mentions) as latest`,
  );
  return row;
}

/** Plan flow C: confirm the new rule right where the item disappeared, with an undo. */
async function BlockedBanner({ userId, ruleId }: { userId: string; ruleId: string }) {
  const db = await getDb();
  const rule = (await listRules(db, userId)).find((r) => r.id === ruleId);
  if (!rule) return null;
  const label = describeRule(rule, { channelNames: await channelNames(db, [rule.value]), topicNames: new Map() });
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
            <Link className="title" href={`/watch/${u.item.resource_id}?list=${u.listId}`}>{u.item.title}</Link>
            <Facts items={[`List by ${u.ownerName}`, formatDuration(u.item.duration_s)]} />
            {u.item.note && <p className="note sm indent">{u.item.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
