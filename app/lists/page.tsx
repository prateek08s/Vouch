import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { listsFor, type ListSummary } from "@/lib/lists";
import { plural } from "@/lib/format";
import { followListAction } from "@/app/actions";
import { CreateListForm } from "./ListForms";

export const metadata: Metadata = { title: "Lists" };

export default function ListsPage() {
  return (
    <>
      <h1>Lists</h1>
      <p className="intro">Ordered collections. Follow one and Vouch keeps your place, one video at a time.</p>
      <Suspense fallback={<p>Loading lists…</p>}>
        <Lists />
      </Suspense>
    </>
  );
}

function ListRow({ l, followable }: { l: ListSummary; followable?: boolean }) {
  return (
    <li>
      <span className="grow">
        <Link href={`/lists/${l.id}`}><strong>{l.title}</strong></Link>
        {!l.is_public && <> <span className="pill quiet">Private</span></>}
        <small>
          by {l.owner_name} · {plural(l.item_count, "video", "videos")}
          {l.follower_count > 0 && ` · ${plural(l.follower_count, "follower", "followers")}`}
        </small>
        {l.description && <small>{l.description}</small>}
      </span>
      {followable && (
        <form action={followListAction}>
          <input type="hidden" name="listId" value={l.id} />
          <input type="hidden" name="op" value={l.following ? "unfollow" : "follow"} />
          <button className={l.following ? "button ghost" : "button"} aria-pressed={l.following}>
            {l.following ? "Following" : "Follow"}
          </button>
        </form>
      )}
    </li>
  );
}

async function Lists() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const { mine, following, discover } = await listsFor(await getDb(), user.id);
  return (
    <>
      {following.length > 0 && (
        <section aria-labelledby="following-h">
          <h2 id="following-h" className="eyebrow">Lists you follow</h2>
          <ul className="people">{following.map((l) => <ListRow key={l.id} l={l} followable />)}</ul>
        </section>
      )}
      <section aria-labelledby="mine-h" style={{ marginTop: "2rem" }}>
        <h2 id="mine-h" className="eyebrow">Your lists</h2>
        {mine.length ? (
          <ul className="people">{mine.map((l) => <ListRow key={l.id} l={l} />)}</ul>
        ) : (
          <p className="trust-tag">You haven’t made a list yet.</p>
        )}
      </section>
      {discover.length > 0 && (
        <section aria-labelledby="discover-h" style={{ marginTop: "2rem" }}>
          <h2 id="discover-h" className="eyebrow">Lists by others</h2>
          <ul className="people">{discover.map((l) => <ListRow key={l.id} l={l} followable />)}</ul>
        </section>
      )}
      <section aria-labelledby="new-h" style={{ marginTop: "2.5rem" }}>
        <h2 id="new-h" className="eyebrow">Make a list</h2>
        <CreateListForm />
      </section>
    </>
  );
}
