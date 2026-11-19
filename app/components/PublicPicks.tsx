import Image from "next/image";
import Link from "next/link";
import type { PublicPick } from "@/lib/public";
import { initials, plural } from "@/lib/format";
import { Facts } from "./Facts";

type Pick = PublicPick & { people?: number; creatorName?: string | null };

/** Public picks. Each opens on Vouch's watch page, which anyone can view. */
export function PublicPicks({ picks, showCurator = true }: { picks: Pick[]; showCurator?: boolean }) {
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
              <Link href={`/watch/${pick.id}`}>{pick.title}</Link>
            </h2>
            <Facts items={[pick.creatorName, pick.people && pick.people > 1 ? `Recommended by ${plural(pick.people, "person", "people")}` : null]} />
          </div>
          <Link className="frame rec-media" href={`/watch/${pick.id}`} tabIndex={-1} aria-hidden="true">
            {pick.thumbnail_url ? <Image unoptimized src={pick.thumbnail_url} alt="" fill sizes="(max-width: 46rem) 100vw, 22rem" /> : <span className="placeholder">Vouch</span>}
          </Link>
        </article>
      ))}
    </div>
  );
}
