import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { socialEnabled } from "@/lib/flags";
import { publicPaths } from "@/lib/paths";
import { listsFor, type ListSummary } from "@/lib/lists";
import { plural } from "@/lib/format";
import { followListAction } from "@/app/lists/actions";
import { Facts } from "@/app/components/Facts";
import { CreateListForm } from "./ListForms";

export const metadata: Metadata = { title: socialEnabled() ? "Lists" : "Collections" };

const NOBODY = "00000000-0000-0000-0000-000000000000";

export default function ListsPage() {
  return (
    <>
      <header className="page-head">
        <h1>{socialEnabled() ? "Lists" : "Collections"}</h1>
        <p>
          {socialEnabled()
            ? "Ordered collections of videos. Follow one and Vouch keeps your place, one video at a time."
            : "Hacker News picks gathered by topic, and any lists you make."}
        </p>
      </header>
      <Suspense fallback={<p className="muted">Loading lists…</p>}>
        <Lists />
      </Suspense>
    </>
  );
}

function ListRow({ l, followable }: { l: ListSummary; followable?: boolean }) {
  return (
    <li>
      <span className="grow">
        <Link href={`/lists/${l.id}`}>{l.title}</Link>
        <Facts
          items={[
            `By ${l.owner_name}`,
            plural(l.item_count, "video", "videos"),
            l.follower_count > 0 && plural(l.follower_count, "follower", "followers"),
            !l.is_public && <span className="pill quiet">Private</span>,
          ]}
        />
        {l.description && <span className="desc">{l.description}</span>}
      </span>
      {followable && (
        <form action={followListAction}>
          <input type="hidden" name="listId" value={l.id} />
          <input type="hidden" name="op" value={l.following ? "unfollow" : "follow"} />
          <button className={l.following ? "button ghost" : "button outline"} aria-pressed={l.following}>
            {l.following ? "Following" : "Follow"}
          </button>
        </form>
      )}
    </li>
  );
}

async function Lists() {
  const user = await getCurrentUser();
  const db = await getDb();
  const [{ mine, following, discover }, paths] = await Promise.all([listsFor(db, user?.id ?? NOBODY), publicPaths(db)]);
  const followable = Boolean(user) && socialEnabled();
  return (
    <div className="split">
      <div>
        {/* Only point at learning paths once there is one to open. */}
        {paths.length > 0 && (
          <p className="section-note"><Link href="/paths">Explore learning paths</Link> with prerequisites and clear learning outcomes.</p>
        )}
        {following.length > 0 && (
          <section className="section" aria-labelledby="following-h">
            <h2 id="following-h" className="section-title">Lists you follow</h2>
            <ul className="rows">{following.map((l) => <ListRow key={l.id} l={l} followable={followable} />)}</ul>
          </section>
        )}
        {user && (
          <section className="section" aria-labelledby="mine-h">
            <h2 id="mine-h" className="section-title">Your lists</h2>
            {mine.length ? (
              <ul className="rows">{mine.map((l) => <ListRow key={l.id} l={l} />)}</ul>
            ) : (
              <p className="section-note">You haven’t made a list yet. Start one on the right.</p>
            )}
          </section>
        )}
        {discover.length > 0 && (
          <section className="section" aria-labelledby="discover-h">
            <h2 id="discover-h" className="section-title">{user ? "Lists by others" : "Collections"}</h2>
            <ul className="rows">{discover.map((l) => <ListRow key={l.id} l={l} followable={followable} />)}</ul>
          </section>
        )}
      </div>
      {user ? (
        <section className="panel" aria-labelledby="new-h">
          <h2 id="new-h" className="section-title">Make a list</h2>
          <p className="section-note">Put videos in the order someone should watch them.</p>
          <CreateListForm />
        </section>
      ) : (
        <section className="panel" aria-labelledby="new-h">
          <h2 id="new-h" className="section-title">Saving a video?</h2>
          <p className="section-note">Use Save for later on any video. It keeps a list in this browser, no account needed.</p>
          <Link className="button ghost" href="/saved">Your saved videos</Link>
        </section>
      )}
    </div>
  );
}
