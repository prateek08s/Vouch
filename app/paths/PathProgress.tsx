"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { parse, readLocal, subscribeLocal } from "@/lib/learning/local";
import { pathProgress, type PathLesson } from "@/lib/paths/progress";

export function PathProgress({ listId, lessons, signedIn }: { listId: string; lessons: PathLesson[]; signedIn: boolean }) {
  const raw = useSyncExternalStore(subscribeLocal, readLocal, () => "{}");
  const local = parse(raw);
  const progress = pathProgress(signedIn ? lessons : lessons.map((lesson) => ({
    ...lesson, status: local.watched[lesson.resource_id] ? "watched" : local.progress[lesson.resource_id]?.status ?? null,
  })));
  const next = progress.next ?? progress.review;
  return (
    <section className="path-progress" aria-label="Learning path progress">
      <p>{progress.watched} of {progress.total} available lessons watched{progress.skipped ? `, ${progress.skipped} skipped` : ""}.</p>
      <div className="progress" role="progressbar" aria-label="Lessons watched" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress.percent}%` }} /></div>
      {progress.unavailable > 0 && <p className="muted">{progress.unavailable} unavailable lessons are excluded from this progress.</p>}
      {progress.completed ? <p className="success" role="status">You have watched every available lesson.</p> :
        next ? <Link className="button small" href={`/watch/${next.resource_id}?list=${listId}`}>{progress.next ? progress.watched || progress.skipped ? "Continue learning" : "Start learning" : "Revisit skipped lessons"}</Link> :
        <p className="muted">There are no available lessons yet.</p>}
      {!signedIn && <p className="muted">Progress stays in this browser.</p>}
    </section>
  );
}
