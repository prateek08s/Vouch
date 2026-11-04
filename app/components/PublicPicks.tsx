import Image from "next/image";
import Link from "next/link";
import type { PublicPick } from "@/lib/public";

export function PublicPicks({ picks }: { picks: PublicPick[] }) {
  if (!picks.length) return <p className="empty">The first recommendations are on their way.</p>;
  return <div className="screening-grid">{picks.map(pick => (
    <article className="screening" key={pick.id}>
      <a href={pick.canonical_url} className="screening-image" target="_blank" rel="noreferrer" aria-label={`Watch ${pick.title} on YouTube`}>
        {pick.thumbnail_url && <Image src={pick.thumbnail_url} alt="" fill sizes="(max-width: 750px) 100vw, 40vw" />}
        <span className="screening-play" aria-hidden="true">↗</span>
      </a>
      <div className="screening-body">
        <Link href={`/u/${pick.username}`}>Vouched by {pick.curator}</Link>
        <h2><a href={pick.canonical_url} target="_blank" rel="noreferrer">{pick.title}</a></h2>
        {pick.note && <blockquote>“{pick.note}”</blockquote>}
      </div>
    </article>
  ))}</div>;
}
