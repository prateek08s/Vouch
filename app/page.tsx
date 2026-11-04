import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { circleFeed, logImpressions } from "@/lib/feed/circle";
import { recordImpressions } from "@/lib/analytics";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { greeting, plural } from "@/lib/format";
import { RecommendationCard } from "./components/RecommendationCard";
import { deleteRuleAction } from "./actions";
import { listRules } from "@/lib/rules";
import { describeRule } from "@/lib/rules/describe";
import { upNextFromLists, type UpNext } from "@/lib/lists";
import { formatDuration } from "@/lib/format";

export default async function CirclePage({ searchParams }: PageProps<"/">) {
  return (
    <>
      <div className="screening-heading"><p className="screening-kicker"><span aria-hidden="true" /> Your personal screening room</p><h1>Good taste.<br /><span>Great rabbit holes.</span></h1><p className="screening-caption">A few things worth your attention, chosen by people worth listening to.</p></div>
      <Suspense fallback={<p className="intro">Finding what your circle vouched for…</p>}>
        <Circle searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Circle({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="empty">
        <p>Vouch shows you what people whose taste you trust think is worth your time.</p>
        <div className="actions"><Link className="button" href="/discover">Explore recommendations</Link><Link className="button ghost" href="/signin">Build your Circle</Link></div>
      </div>
    );
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

  if (!page.items.length && cursor === 0) {
    return (
      <>
      {banner}
      <UpNextSection items={upNext} />
      {page.hiddenByRules > 0 ? (
        <div className="empty">
          <p><strong>Your rules are hiding everything new.</strong></p>
          <p>
            Your circle vouched for {plural(page.hiddenByRules, "video", "videos")}, and your rules hid{" "}
            {page.hiddenByRules === 1 ? "it" : "all of them"}. That is working as intended, but you may want to loosen one.
          </p>
          <Link className="button" href="/settings/rules">Review your rules</Link>
        </div>
      ) : (
        <div className="empty">
          <p><strong>Nothing new from your circle.</strong></p>
          <p>Follow a few people whose taste you trust, and their vouches will show up here.</p>
          <Link className="button" href="/people">Find people</Link>
        </div>
      )}
      </>
    );
  }

  const shown = cursor + page.items.length;
  return (
    <>
      {banner}
      <p className="intro">
        {greeting(new Date())}. {plural(page.curatorCount, "person you trust", "people you trust")} found{" "}
        {plural(shown, "thing", "things")}
        {page.nextCursor !== null ? "+" : ""} worth watching.
      </p>

      <div className="screening-grid">{page.items.map((item, index) => (
        <RecommendationCard key={item.resourceId} item={item} featured={index === 0} />
      ))}</div>

      <UpNextSection items={upNext} />

      {page.nextCursor !== null ? (
        <div className="caught-up">
          <Link className="button ghost" href={`/?page=${page.nextCursor}`}>Show a few more</Link>
        </div>
      ) : (
        <footer className="caught-up">
          <strong><span aria-hidden="true">✓ </span>You’re caught up.</strong>
          Go watch something worth your time.
          {page.hiddenByRules > 0 && (
            <p className="trust-tag">{plural(page.hiddenByRules, "video was", "videos were")} hidden by your rules.</p>
          )}
        </footer>
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
    <div className="provenance banner" role="status">
      <span><strong>Rule added:</strong> {label}.</span>
      <form action={deleteRuleAction}>
        <input type="hidden" name="ruleId" value={rule.id} />
        <input type="hidden" name="back" value="circle" />
        <button className="link-button">Undo</button>
      </form>
      <Link href="/settings/rules">All rules</Link>
    </div>
  );
}

/** Lists are paths: show the next step in each followed list, not a re-ranked mix. */
function UpNextSection({ items }: { items: UpNext[] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="upnext-h" className="upnext">
      <h2 id="upnext-h" className="eyebrow">Up next from your lists</h2>
      <ul className="people">
        {items.map((u) => (
          <li key={u.listId}>
            <span className="grow">
              <Link href={`/watch/${u.item.resource_id}`}><strong>{u.item.title}</strong></Link>
              <small>
                {u.index + 1} of {u.total} in <Link href={`/lists/${u.listId}`}>{u.listTitle}</Link> by {u.ownerName}
                {formatDuration(u.item.duration_s) ? ` · ${formatDuration(u.item.duration_s)}` : ""}
              </small>
              {u.item.note && <small>“{u.item.note}”</small>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
