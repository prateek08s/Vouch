"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { browserEntries, subscribeLearning } from "@/lib/learning/browser";
import type { LearningEntry } from "@/lib/learning/model";
import { formatDuration } from "@/lib/format";
import { Facts } from "@/app/components/Facts";
import { LearningControls } from "./LearningControls";

export type LibraryView = "continue" | "saved" | "history";

export function Library({ entries: initial, signedIn, view }: {
  entries: LearningEntry[]; signedIn: boolean; view: LibraryView;
}) {
  const [guestEntries, setGuestEntries] = useState<LearningEntry[]>([]);
  useEffect(() => {
    if (signedIn) return;
    const read = () => setGuestEntries(browserEntries());
    read();
    return subscribeLearning(read);
  }, [signedIn]);
  const entries = signedIn ? initial : guestEntries;
  const filtered = entries.filter((entry) => view === "saved" ? entry.saved :
    view === "continue" ? entry.status === "in_progress" && entry.positionS > 0 : entry.status !== null);
  return (
    <>
      {!signedIn && <p className="section-note">Your history is saved in this browser. <Link href="/signin">Sign in</Link> to start account history across devices.</p>}
      {!filtered.length ? (
        <div className="empty">
          <strong>{view === "saved" ? "Save something for later." : view === "history" ? "Your history starts with a video." : "Ready when you are."}</strong>
          <p>{view === "saved" ? "Choose Save for later on a video to keep it here." : "Start a video and your place will be saved here."}</p>
          <Link className="button" href="/discover">Find a video</Link>
        </div>
      ) : (
        <div className="learning-library">
          {filtered.map((entry) => {
            const fraction = entry.status === "watched" ? 100 :
              entry.durationS ? Math.min(100, Math.round(entry.positionS / entry.durationS * 100)) : 0;
            return (
              <article className="learning-row" key={entry.id}>
                <Link href={`/watch/${entry.id}`} className="learning-image" tabIndex={-1} aria-hidden="true">
                  {entry.thumbnailUrl && <Image unoptimized src={entry.thumbnailUrl} alt="" width={320} height={180} />}
                </Link>
                <div className="learning-details">
                  <h2><Link href={`/watch/${entry.id}`}>{entry.title}</Link></h2>
                  <Facts items={[entry.creatorName, formatDuration(entry.durationS), entry.status === "watched" ? "Watched" : entry.status === "skipped" ? "Skipped" : null]} />
                  {view === "continue" && (
                    <div className="list-progress">
                      <span>Resume at {Math.floor(entry.positionS / 60)}:{String(entry.positionS % 60).padStart(2, "0")}</span>
                      {entry.durationS !== null && <div className="progress" role="progressbar" aria-label="Playback position" aria-valuenow={fraction} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${fraction}%` }} /></div>}
                    </div>
                  )}
                  <LearningControls video={entry} initial={entry} signedIn={signedIn} refreshOnChange />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
