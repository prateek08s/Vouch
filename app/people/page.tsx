import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { initials } from "@/lib/format";
import { followAction } from "@/app/actions";

export const metadata: Metadata = { title: "People" };

export default function PeoplePage() {
  return (
    <>
      <h1>People</h1>
      <p className="intro">Follow people whose taste you trust. Vouch learns, topic by topic, whose picks work for you.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <People />
      </Suspense>
    </>
  );
}

async function People() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const db = await getDb();
  // Reputation is recommendation quality, not follower count (plan 8). Counts only, never per-user ratings.
  const people = await db.query<{
    id: string; username: string; display_name: string; bio: string | null;
    following: boolean; vouch_count: number; top_topics: string[] | null;
  }>(
    `select u.id, u.username, u.display_name, u.bio,
            exists (select 1 from follows f where f.follower_id = $1 and f.followee_id = u.id) as following,
            (select count(*)::int from vouches v where v.user_id = u.id) as vouch_count,
            (select array_agg(name) from (
               select t.name from vouches v join vouch_topics vt on vt.vouch_id = v.id join topics t on t.id = vt.topic_id
               where v.user_id = u.id group by t.name order by count(*) desc, t.name limit 3) x) as top_topics
     from users u where u.id <> $1
     order by following desc, vouch_count desc, u.display_name`,
    [user.id],
  );

  if (!people.length) return <p className="empty">No one else is here yet.</p>;
  return (
    <ul className="people">
      {people.map((p) => (
        <li key={p.id}>
          <span className="avatar" aria-hidden="true">{initials(p.display_name)}</span>
          <span className="grow">
            <strong>{p.display_name}</strong> <span className="trust-tag">@{p.username} · {p.vouch_count} {p.vouch_count === 1 ? "vouch" : "vouches"}</span>
            {p.top_topics?.length ? <small>{p.top_topics.join(" · ")}</small> : null}
            {p.bio && <small>{p.bio}</small>}
          </span>
          <form action={followAction}>
            <input type="hidden" name="userId" value={p.id} />
            <input type="hidden" name="op" value={p.following ? "unfollow" : "follow"} />
            <button className={p.following ? "button ghost" : "button"} aria-pressed={p.following}>
              {p.following ? "Following" : "Follow"}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
