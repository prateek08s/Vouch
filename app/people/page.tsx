import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { initials, plural } from "@/lib/format";
import { followAction } from "@/app/people/actions";
import { listPeople } from "@/lib/users/people";
import { Facts } from "@/app/components/Facts";

export const metadata: Metadata = { title: "People" };

export default function PeoplePage() {
  return (
    <>
      <header className="page-head">
        <h1>People</h1>
        <p>Follow people whose taste you trust. Vouch learns, topic by topic, whose picks work for you.</p>
      </header>
      <Suspense fallback={<p className="muted">Loading people…</p>}>
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
  const people = await listPeople(db, user.id);

  if (!people.length) {
    return (
      <div className="empty">
        <strong>No one else is here yet.</strong>
        <p>Invite someone whose taste you trust. Their vouches will start your Circle.</p>
      </div>
    );
  }
  const following = people.filter((p) => p.following).length;
  return (
    <>
      <p className="result-count">You follow {plural(following, "person", "people")}.</p>
      <ul className="rows">
        {people.map((p) => (
          <li key={p.id}>
            <span className="avatar" aria-hidden="true">{initials(p.display_name)}</span>
            <span className="grow">
              <Link href={`/u/${p.username}`}>{p.display_name}</Link>
              <Facts items={[`@${p.username}`, plural(p.vouch_count, "vouch", "vouches")]} />
              {p.bio && <span className="desc">{p.bio}</span>}
              {p.top_topics?.length ? (
                <span className="tags">{p.top_topics.map((t) => <span key={t} className="pill">{t}</span>)}</span>
              ) : null}
            </span>
            <form action={followAction}>
              <input type="hidden" name="userId" value={p.id} />
              <input type="hidden" name="op" value={p.following ? "unfollow" : "follow"} />
              <button className={p.following ? "button ghost" : "button outline"} aria-pressed={p.following}>
                {p.following ? "Following" : "Follow"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
