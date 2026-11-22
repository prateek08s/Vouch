import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { socialEnabled } from "@/lib/flags";
import { getList } from "@/lib/lists";
import { formatDuration, plural } from "@/lib/format";
import { deleteListAction, followListAction, listItemAction } from "@/app/lists/actions";
import { Facts } from "@/app/components/Facts";
import { pathMetadata, PATH_LEVELS } from "@/lib/paths";
import { PathEditor } from "@/app/paths/PathEditor";
import { PathProgress } from "@/app/paths/PathProgress";
import { lessonResources } from "@/lib/lesson-resources";
import { LessonLinks } from "@/app/paths/LessonLinks";
import { ResourceEditor } from "@/app/paths/ResourceEditor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ListPage(props: PageProps<"/lists/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading list…</p>}>
      <ListView {...props} />
    </Suspense>
  );
}

async function ListView({ params }: PageProps<"/lists/[id]">) {
  // Public lists are readable signed out; "nobody" matches no owner, follow or rating.
  const user = await getCurrentUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const v = await getList(await getDb(), user?.id ?? null, id);
  if (!v) notFound();
  const { list, items } = v;
  const db = await getDb();
  const [path, attachments] = await Promise.all([
    pathMetadata(db, user?.id ?? null, id), lessonResources(db, user?.id ?? null, id),
  ]);
  const watched = items.filter((i) => i.status === "watched").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const done = watched + skipped;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  return (
    <>
      <header className="list-head">
        <p className="kicker">
          <Link href="/lists">{socialEnabled() ? "Lists" : "Collections"}</Link> / {v.isOwner ? "Your list" : `List by ${v.owner.display_name}`}
          {!list.is_public && <> <span className="pill quiet">Private</span></>}
        </p>
        <h1>{list.title}</h1>
        {list.description && <p className="intro">{list.description}</p>}
        <Facts items={[plural(items.length, "video", "videos"), v.followerCount > 0 && plural(v.followerCount, "follower", "followers")]} />
        {!path && user && items.length > 0 && (
          <div className="list-progress">
            <span>{watched} watched{skipped > 0 ? `, ${skipped} skipped` : ""} of {items.length}</span>
            <div className="progress" role="progressbar" aria-label="Watched or skipped" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {user && socialEnabled() && !v.isOwner && (
          <form action={followListAction} className="actions">
            <input type="hidden" name="listId" value={list.id} />
            <input type="hidden" name="op" value={v.isFollowing ? "unfollow" : "follow"} />
            <button className={v.isFollowing ? "button ghost" : "button"} aria-pressed={v.isFollowing}>
              {v.isFollowing ? "Following this list" : "Follow this list"}
            </button>
          </form>
        )}
      </header>

      {path && <section className="path-overview" aria-label="About this learning path">
        <p className="kicker">Learning path · {PATH_LEVELS[path.level]} · Level set by the curator</p>
        <div className="path-goals">
          <div><h2>Before you start</h2>{path.prerequisites.length ? <ul>{path.prerequisites.map((text) => <li key={text}>{text}</li>)}</ul> : <p>No prerequisites listed by the curator.</p>}</div>
          <div><h2>What you will learn</h2><ul>{path.outcomes.map((text) => <li key={text}>{text}</li>)}</ul></div>
        </div>
        <PathProgress listId={list.id} lessons={items} signedIn={!!user} />
      </section>}
      {v.isOwner && <PathEditor listId={list.id} metadata={path} />}

      {!user && <p className="section-note"><Link href="/signin">Sign in</Link> to follow this list and sync progress across devices.</p>}
      {v.hiddenByRules > 0 && <p className="section-note">{plural(v.hiddenByRules, "video is", "videos are")} hidden by your <Link href="/settings/rules">rules</Link>.</p>}
      {items.length === 0 ? (
        <div className="empty">
          <strong>{v.isOwner ? "No videos yet." : "This list is empty."}</strong>
          {v.isOwner && <p>Open any video and choose “Add to a list” to put it here.</p>}
        </div>
      ) : (
        <ol className="list-items">
          {items.map((it, idx) => (
            <li key={it.resource_id} className={it.status === "watched" || it.status === "skipped" ? "watched" : undefined}>
              <span className="list-num" aria-hidden="true">{idx + 1}</span>
              {it.thumbnail_url && <Image unoptimized className="thumb list-thumb" src={it.thumbnail_url} alt="" width={160} height={90} />}
              <div className="grow">
                {it.metadata_status === "unavailable" ? (
                  <span>{it.title} <span className="pill quiet">No longer available</span></span>
                ) : (
                  <Link href={`/watch/${it.resource_id}?list=${list.id}`}>{it.title}</Link>
                )}
                <Facts
                  items={[
                    it.creator_name,
                    formatDuration(it.duration_s),
                    it.status === "watched" ? "Watched" : it.status === "skipped" ? "Skipped" : null,
                    it.rated === true ? "You: Worth it" : it.rated === false ? "You: Not worth it" : null,
                  ]}
                />
                {it.note && <span className="item-note">“{it.note}”</span>}
                <LessonLinks resources={attachments.filter((attachment) => attachment.resource_id === it.resource_id)} />
                {v.isOwner && <ResourceEditor listId={list.id} resourceId={it.resource_id} resources={attachments.filter((attachment) => attachment.resource_id === it.resource_id)} />}
              </div>
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
        <form action={deleteListAction} className="back">
          <input type="hidden" name="listId" value={list.id} />
          <button className="link-button danger">Delete this list</button>
        </form>
      )}
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
