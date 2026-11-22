import Image from "next/image";
import Link from "next/link";
import type { DiscoverPick } from "@/lib/public/discover";
import { formatDuration, monthYear } from "@/lib/format";

/** Picks whose quote reads well large: credited to a commenter, a sentence or two long. */
export function quotable(picks: DiscoverPick[]): DiscoverPick[] {
  return picks.filter((p) => p.hn && p.note && p.note.length >= 40 && p.note.length <= 200);
}

/**
 * The home page's hook: the most-recommended pick's quote, set like a critic's pull-quote with a
 * highlighter stroke, plus two more. Real comments only, each linked to where it was written.
 */
export function FeaturedQuotes({ picks }: { picks: DiscoverPick[] }) {
  const [lead, ...rest] = picks;
  if (!lead?.hn) return null;
  const runtime = formatDuration(lead.durationS ?? null);
  return (
    <div className="featured">
      <figure className="spotlight">
        <div className="spotlight-text">
          <blockquote className="spotlight-quote">
            <p><span className="hl">{lead.note}</span></p>
          </blockquote>
          <figcaption>
            <p className="credit">
              <strong>{lead.hn.author}</strong>, <a href={lead.hn.url} target="_blank" rel="noreferrer">on Hacker News, {monthYear(lead.hn.postedAt)}</a>
            </p>
            <p className="spotlight-title"><Link href={`/watch/${lead.id}`}>{lead.title}</Link></p>
            <p className="spotlight-meta">
              {lead.creatorName && <span>{lead.creatorName}</span>}
              {lead.hn.total > 1 && <span className="stamp">Vouched {lead.hn.total}×</span>}
            </p>
          </figcaption>
          <Link className="button" href={`/watch/${lead.id}`}>Watch{runtime ? ` · ${runtime}` : ""}</Link>
        </div>
        <Link className="frame spotlight-media" href={`/watch/${lead.id}`} tabIndex={-1} aria-hidden="true">
          {lead.thumbnail_url ? <Image unoptimized src={lead.thumbnail_url} alt="" fill sizes="(max-width: 46rem) 100vw, 28rem" priority /> : <span className="placeholder">Vouch</span>}
        </Link>
      </figure>
      {rest.length > 0 && (
        <div className="also">
          {rest.slice(0, 2).map((p) => (
            <figure key={p.id} className="also-quote">
              <blockquote><p>{p.note}</p></blockquote>
              <figcaption>
                <span className="credit"><strong>{p.hn!.author}</strong> on <Link href={`/watch/${p.id}`}>{p.title}</Link></span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
