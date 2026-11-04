import Image from "next/image";
import Link from "next/link";
import type { RankedItem } from "@/lib/feed/rank";
import { TRUST_LABEL, formatDuration, initials } from "@/lib/format";

export function RecommendationCard({ item, featured = false }: { item: RankedItem; featured?: boolean }) {
  const e = item.explanation;
  const href = `/watch/${item.resourceId}?via=${item.leadVouchId}`;
  const titleId = `t-${item.resourceId}`;
  const runtime = formatDuration(item.durationS);
  return (
    <article className={featured ? "screening screening-featured" : "screening"} aria-labelledby={titleId}>
      <Link className="screening-image" href={href} aria-label={`Watch ${item.title}`}>
        {item.thumbnailUrl ? <Image src={item.thumbnailUrl} alt="" fill sizes={featured ? "(max-width: 700px) 100vw, 65vw" : "(max-width: 700px) 100vw, 40vw"} /> : <span className="screening-placeholder">Vouch</span>}
        <span className="screening-play" aria-hidden="true">↗</span>
        {runtime && <span className="screening-time">{runtime}</span>}
        {item.primaryTopic && <span className="screening-topic">{item.primaryTopic.name}</span>}
      </Link>
      <div className="screening-body">
        <div className="screening-author"><span className="avatar" aria-hidden="true">{initials(e.leadCurator.name)}</span><span>{e.headline}<small>{TRUST_LABEL[e.leadCurator.level]}</small></span></div>
        <h2 id={titleId}><Link href={href}>{item.title}</Link></h2>
        <p className="screening-channel">{item.creatorName}{e.creatorVouch && <span className="pill creator">Creator vouch</span>}</p>
        {e.featuredNote && <blockquote>“{e.featuredNote.text}”<cite>{e.featuredNote.by}</cite></blockquote>}
        <details className="why"><summary>Behind this pick</summary><p>{e.whyThis}</p></details>
      </div>
    </article>
  );
}
