import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { getList } from "@/lib/lists";
import { formatDuration, plural } from "@/lib/format";
import { deleteListAction, followListAction, listItemAction } from "@/app/actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ListPage(props: PageProps<"/lists/[id]">) {
  return (
    <Suspense fallback={<p className="intro">Loading list…</p>}>
      <ListView {...props} />
    </Suspense>
  );
}

async function ListView({ params }: PageProps<"/lists/[id]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const v = await getList(await getDb(), user.id, id);
  if (!v) notFound();
  const { list, items } = v;
  const done = items.filter((i) => i.rated !== null).length;

  return (
    <>
      <p className="eyebrow">List by {v.isOwner ? "you" : v.owner.display_name}{!list.is_public && " · Private"}</p>
      <h1 style={{ fontSize: "clamp(2.2rem, 7vw, 4rem)" }}>{list.title}</h1>
      {list.description && <p className="intro">{list.description}</p>}
      <div className="meta">
        <span className="pill quiet">{plural(items.length, "video", "videos")}</span>
        {items.length > 0 && <span className="pill quiet">{done} of {items.length} watched</span>}
        {v.followerCount > 0 && <span className="pill quiet">{plural(v.followerCount, "follower", "followers")}</span>}
      </div>

      {!v.isOwner && (
        <form action={followListAction} className="actions">
          <input type="hidden" name="listId" value={list.id} />
          <input type="hidden" name="op" value={v.isFollowing ? "unfollow" : "follow"} />
          <button className={v.isFollowing ? "button ghost" : "button"} aria-pressed={v.isFollowing}>
            {v.isFollowing ? "Following" : "Follow this list"}
          </button>
        </form>
      )}

      {items.length === 0 ? (
        <p className="empty" style={{ marginTop: "2rem" }}>
          {v.isOwner ? "No videos yet. Open any video and use “Add to list”." : "This list is empty."}
        </p>
      ) : (
        <ol className="list-items">
          {items.map((it, idx) => (
            <li key={it.resource_id} className={it.rated !== null ? "watched" : undefined}>
              <span className="list-num" aria-hidden="true">{idx + 1}</span>
              {it.thumbnail_url && <Image className="thumb list-thumb" src={it.thumbnail_url} alt="" width={160} height={90} />}
              <span className="grow">
                {it.metadata_status === "unavailable" ? (
                  <span>{it.title} <span className="pill quiet">No longer available</span></span>
                ) : (
                  <Link href={`/watch/${it.resource_id}`}>{it.title}</Link>
                )}
                <small>
                  {[it.creator_name, formatDuration(it.duration_s), it.rated === true ? "You: Worth it" : it.rated === false ? "You: Not worth it" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                {it.note && <small>“{it.note}”</small>}
              </span>
              {v.isOwner && (
                <span className="list-controls">
                  <ItemButton listId={list.id} resourceId={it.resource_id} op="move" to={idx - 1} disabled={idx === 0} label={`Move “${it.title}” up`}>↑</ItemButton>
                  <ItemButton listId={list.id} resourceId={it.resource_id} op="move" to={idx + 1} disabled={idx === items.length - 1} label={`Move “${it.title}” down`}>↓</ItemButton>
                  <ItemButton listId={list.id} resourceId={it.resource_id} op="remove" label={`Remove “${it.title}” from list`}>Remove</ItemButton>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {v.isOwner && (
        <form action={deleteListAction} style={{ marginTop: "3rem" }}>
          <input type="hidden" name="listId" value={list.id} />
          <button className="link-button" style={{ color: "var(--danger)" }}>Delete this list</button>
        </form>
      )}
      <p><Link href="/lists">← All lists</Link></p>
    </>
  );
}

function ItemButton(props: { listId: string; resourceId: string; op: "move" | "remove"; to?: number; disabled?: boolean; label: string; children: React.ReactNode }) {
  return (
    <form action={listItemAction}>
      <input type="hidden" name="listId" value={props.listId} />
      <input type="hidden" name="resourceId" value={props.resourceId} />
      <input type="hidden" name="op" value={props.op} />
      {props.to !== undefined && <input type="hidden" name="to" value={props.to} />}
      <button className="button ghost small" disabled={props.disabled} aria-label={props.label}>{props.children}</button>
    </form>
  );
}
