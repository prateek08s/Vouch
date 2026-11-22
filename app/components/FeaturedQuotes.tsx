import Link from "next/link";
import type { DiscoverPick } from "@/lib/public/discover";
import { formatDuration, monthYear } from "@/lib/format";

/** Picks whose quote reads well as a headline: credited to a commenter, one or two sentences. */
export function quotable(picks: DiscoverPick[]): DiscoverPick[] {
  return picks.filter((p) => p.hn && p.note && p.note.length >= 40 && p.note.length <= 170);
}

export type CatalogStats = { videos: number; people: number; channels: number; shorts: number; latest: Date | null };

/**
 * The home hero. The most-recommended pick's real comment is the visual headline, behind a
 * highlighter stroke that draws in once; the h1 says plainly what Vouch is. Below it, real numbers.
 */
export function HomeHero({ lead, stats }: { lead: DiscoverPick | null; stats: CatalogStats }) {
  const runtime = lead ? formatDuration(lead.durationS ?? null) : null;
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <section className="hero" aria-labelledby="hero-h">
      <h1 id="hero-h" className="hero-kicker">YouTube picks from Hacker News commenters, one sentence at a time</h1>
      {lead?.hn ? (
        <figure className="hero-quote">
          <blockquote cite={lead.hn.url}>
            <p>
              <span className="hq-open" aria-hidden="true">“</span>
              <span className="hl">{lead.note}</span>
              <span aria-hidden="true">”</span>
            </p>
          </blockquote>
          <figcaption className="hero-credit">
            <span className="credit">
              <strong>{lead.hn.author}</strong>, <a href={lead.hn.url} target="_blank" rel="noreferrer">on Hacker News, {monthYear(lead.hn.postedAt)}</a>
            </span>
            <Link className="hero-title" href={`/watch/${lead.id}`}>{lead.title}</Link>
            {lead.hn.total > 1 && <span className="stamp">Vouched {lead.hn.total}×</span>}
            <Link className="button large" href={`/watch/${lead.id}`}>Watch{runtime ? ` · ${runtime}` : ""}</Link>
          </figcaption>
        </figure>
      ) : (
        <p className="hero-fallback">The talks, lectures and documentaries people said were worth the hour, each with the comment that said so.</p>
      )}
      <dl className="proof" aria-label="Vouch in numbers">
        <div><dt>Videos people said were worth it</dt><dd>{n(stats.videos)}</dd></div>
        <div><dt>Different commenters vouched</dt><dd>{n(stats.people)}</dd></div>
        <div><dt>Channels, not just the big ones</dt><dd>{n(stats.channels)}</dd></div>
        {/* No ads and no autoplay are true by design; Shorts only while none are listed. */}
        <div><dt>{stats.shorts === 0 ? "Ads, autoplay or Shorts" : "Ads or autoplay"}</dt><dd>0</dd></div>
      </dl>
      {stats.latest && <p className="proof-note">Comments up to {monthYear(stats.latest)}. No account needed to watch, save or rate.</p>}
    </section>
  );
}
