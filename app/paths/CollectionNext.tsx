"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { parse, readLocal, subscribeLocal } from "@/lib/learning/local";
import type { PathLesson } from "@/lib/paths/progress";

export function CollectionNext({ listId, title, currentId, lessons, signedIn }: {
  listId: string; title: string; currentId: string; lessons: PathLesson[]; signedIn: boolean;
}) {
  const raw = useSyncExternalStore(subscribeLocal, readLocal, () => "{}");
  const local = parse(raw);
  const current = lessons.findIndex((item) => item.resource_id === currentId);
  const next = lessons.slice(current + 1).find((item) => {
    const status = signedIn ? item.status : local.watched[item.resource_id] ? "watched" : local.progress[item.resource_id]?.status;
    return item.metadata_status !== "unavailable" && status !== "watched" && status !== "skipped";
  });
  return <section className="learning-next">
    <p className="muted">From <Link href={`/lists/${listId}`}>{title}</Link></p>
    {next ? <Link className="button outline" href={`/watch/${next.resource_id}?list=${listId}`}>Next video: {next.title}</Link> :
      <Link href={`/lists/${listId}`}>Back to the collection overview</Link>}
  </section>;
}
