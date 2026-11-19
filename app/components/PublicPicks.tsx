import Image from "next/image";
import Link from "next/link";
import type { PublicPick } from "@/lib/public";
import { formatDuration, initials, monthYear, plural } from "@/lib/format";
import { Facts } from "./Facts";

type Pick = PublicPick & { people?: number; creatorName?: string | null; durationS?: number | null };

/**
 * Public picks. Each opens on Vouch's watch page, which anyone can view. An imported pick credits the
 * Hacker News commenter whose words are the note, with a link to the comment.
 * showReason=false hides the note and its credit (the experiment's "nonote" variant).
 */
export function PublicPicks({ picks, showCurator = true, showReason = true }: { picks: Pick[]; showCurator?: boolean; showReason?: boolean }) {
  if (!picks.length) {
    return (
      <div className="empty">
        <strong>No picks match.</strong>
        <p>Try another topic or length.</p>
      </div>
    );
  }
  return (
    <div className="feed">
      {picks.map((pick) => (
        <article className="rec" key={pick.id} aria-labelledby={`p-${pick.id}`} data-rid={pick.id}>
          <div className="rec-body">
            {showReason && showCurator && (pick.hn ? (
              <div className="byline">
                <span className="avatar" aria-hidden="true">{initials(pick.hn.author)}</span>
                <span className="byline-text">
                  <strong>{pick.hn.author}</strong>
                  <a href={pick.hn.url} target="_blank" rel="noreferrer">on Hacker News, {monthYear(pick.hn.postedAt)}</a>
                </span>
              </div>
            ) : (
              <div className="byline">
                <span className="avatar" aria-hidden="true">{initials(pick.curator)}</span>
                <span className="byline-text">
                  <strong><Link href={`/u/${pick.username}`}>{pick.curator}</Link></strong>
                  <span>@{pick.username}</span>
                </span>
              </div>
            ))}
            {showReason && pick.note && <blockquote className="note">{pick.note}</blockquote>}
            <h2 id={`p-${pick.id}`} className={showReason && pick.note ? "rec-title" : "rec-title solo"}>
              <Link href={`/watch/${pick.id}`}>{pick.title}</Link>
            </h2>
            <Facts
              items={[
                pick.creatorName,
                formatDuration(pick.durationS ?? null),
                pick.hn && pick.hn.total > 1
                  ? `In ${pick.hn.total} HN comments`
                  : !pick.hn && pick.people && pick.people > 1 ? `Recommended by ${plural(pick.people, "person", "people")}` : null,
              ]}
            />
            <span className="watched-badge" hidden>Watched</span>
          </div>
          <Link className="frame rec-media" href={`/watch/${pick.id}`} tabIndex={-1} aria-hidden="true">
            {pick.thumbnail_url ? <Image unoptimized src={pick.thumbnail_url} alt="" fill sizes="(max-width: 46rem) 100vw, 22rem" /> : <span className="placeholder">Vouch</span>}
          </Link>
        </article>
      ))}
    </div>
  );
}
