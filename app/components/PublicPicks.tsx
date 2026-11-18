import Image from "next/image";
import Link from "next/link";
import type { PublicPick } from "@/lib/public";
import { initials } from "@/lib/format";

/** Public picks, for people who are not signed in. The video opens on YouTube. */
export function PublicPicks({ picks, showCurator = true }: { picks: PublicPick[]; showCurator?: boolean }) {
  if (!picks.length) {
    return (
      <div className="empty">
        <strong>No public picks yet.</strong>
        <p>The first recommendations will appear here as soon as someone vouches.</p>
      </div>
    );
  }
  return (
    <div className="feed">
      {picks.map((pick) => (
        <article className="rec" key={pick.id} aria-labelledby={`p-${pick.id}`}>
          <div className="rec-body">
            {showCurator && (
              <div className="byline">
                <span className="avatar" aria-hidden="true">{initials(pick.curator)}</span>
                <span className="byline-text">
                  <strong><Link href={`/u/${pick.username}`}>{pick.curator}</Link></strong>
                  <span>@{pick.username}</span>
                </span>
              </div>
            )}
            {pick.note && <blockquote className="note">{pick.note}</blockquote>}
            <h2 id={`p-${pick.id}`} className={pick.note ? "rec-title" : "rec-title solo"}>
              <a href={pick.canonical_url} target="_blank" rel="noreferrer">{pick.title}</a>
            </h2>
          </div>
          <a className="frame rec-media" href={pick.canonical_url} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
            {pick.thumbnail_url ? <Image src={pick.thumbnail_url} alt="" fill sizes="(max-width: 46rem) 100vw, 22rem" /> : <span className="placeholder">Vouch</span>}
          </a>
        </article>
      ))}
    </div>
  );
}
