import Image from "next/image";
import Link from "next/link";
import type { RankedItem } from "@/lib/feed/rank";
import { TRUST_LABEL, formatDuration, initials } from "@/lib/format";
import { Facts } from "./Facts";

/**
 * One pick in the Circle. The person and their reason lead; the video is the attachment.
 * Without a note, the title takes the note's place.
 */
export function RecommendationCard({ item, priority = false }: { item: RankedItem; priority?: boolean }) {
  const e = item.explanation;
  const href = `/watch/${item.resourceId}?via=${item.leadVouchId}`;
  const titleId = `t-${item.resourceId}`;
  const runtime = formatDuration(item.durationS);
  const note = e.featuredNote;
  return (
    <article className="rec" aria-labelledby={titleId}>
      <div className="rec-body">
        <div className="byline">
          <span className="avatar" aria-hidden="true">{initials(e.leadCurator.name)}</span>
          <span className="byline-text">
            <strong>{e.headline}</strong>
            <span>{TRUST_LABEL[e.leadCurator.level]}</span>
          </span>
        </div>

        {note && <blockquote className="note">{note.text}</blockquote>}
        {note && note.by !== e.leadCurator.name && <p className="note-by">Note by {note.by}</p>}

        <div className="rec-video">
          <h2 id={titleId} className={note ? "rec-title" : "rec-title solo"}>
            <Link href={href}>{item.title}</Link>
          </h2>
          <Facts
            items={[
              item.creatorName,
              item.primaryTopic?.name,
              e.creatorVouch && <span className="pill creator">Creator vouch</span>,
            ]}
          />
        </div>

        <details className="why">
          <summary>Why am I seeing this?</summary>
          <p>{e.whyThis}</p>
        </details>
      </div>

      <Link className="frame rec-media" href={href} tabIndex={-1} aria-hidden="true">
        {item.thumbnailUrl ? (
          <Image src={item.thumbnailUrl} alt="" fill sizes="(max-width: 46rem) 100vw, 22rem" priority={priority} />
        ) : (
          <span className="placeholder">Vouch</span>
        )}
        {runtime && <span className="runtime">{runtime}</span>}
      </Link>
    </article>
  );
}
