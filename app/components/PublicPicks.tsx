import Image from "next/image";
import Link from "next/link";
import type { PublicPick } from "@/lib/public";
import { formatDuration, monthYear, plural } from "@/lib/format";
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
        <p>Try fewer filters or a different topic, channel, or time budget.</p>
      </div>
    );
  }
  return (
    <div className="feed">
      {picks.map((pick) => {
        const runtime = formatDuration(pick.durationS ?? null);
        const vouches = pick.hn ? pick.hn.total : pick.people ?? 1;
        const quote = showReason && pick.note;
        return (
          <article className="rec" key={pick.id} aria-labelledby={`p-${pick.id}`} data-rid={pick.id}>
            <Link className="frame rec-media" href={`/watch/${pick.id}`} tabIndex={-1} aria-hidden="true">
              {pick.thumbnail_url ? <Image unoptimized src={pick.thumbnail_url} alt="" fill sizes="(max-width: 46rem) 100vw, 18rem" /> : <span className="placeholder">Vouch</span>}
              {runtime && <span className="runtime">{runtime}</span>}
            </Link>
            <div className="rec-body">
              {quote && <blockquote className="note">{pick.note}</blockquote>}
              {showReason && showCurator && (pick.hn ? (
                <p className="credit">
                  <strong>{pick.hn.author}</strong>, <a href={pick.hn.url} target="_blank" rel="noreferrer">on Hacker News, {monthYear(pick.hn.postedAt)}</a>
                </p>
              ) : (
                <p className="credit">
                  <strong><Link href={`/u/${pick.username}`}>{pick.curator}</Link></strong> @{pick.username}
                </p>
              ))}
              <h2 id={`p-${pick.id}`} className={quote ? "rec-title" : "rec-title solo"}>
                <Link href={`/watch/${pick.id}`}>{pick.title}</Link>
              </h2>
              <div className="rec-meta">
                <Facts items={[pick.creatorName, runtime]} />
                {vouches > 1 && <span className="stamp" title={pick.hn ? `Recommended in ${plural(vouches, "Hacker News comment", "Hacker News comments")}` : undefined}>Vouched {vouches}×</span>}
                <span className="watched-badge" hidden>Watched</span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
