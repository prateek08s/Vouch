import Link from "next/link";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { LENGTHS, SORTS, discoverPicks, isLength, isSort, type LengthKey, type SortKey } from "@/lib/public/discover";
import { loadTopics, groupedTopics } from "@/lib/topics";
import { plural } from "@/lib/format";
import { recordAnon } from "@/lib/experiment";
import { anonContext } from "@/lib/experiment/server";
import { PublicPicks } from "./PublicPicks";
import { WatchedFilter } from "./local/WatchedFilter";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Discover's filters and picks. The home page and /discover share it; `base` is the page's path. */
export async function DiscoverFeed({ searchParams, base }: { searchParams: Promise<SP>; base: string }) {
  const sp = await searchParams;
  const topic = one(sp.topic) || null;
  const lenRaw = one(sp.len);
  const sortRaw = one(sp.sort);
  const length: LengthKey | null = isLength(lenRaw) ? lenRaw : null;
  const sort: SortKey = isSort(sortRaw) ? sortRaw : "top";
  const cursor = Math.max(0, Number(one(sp.page)) || 0);
  const [user, db, anon] = await Promise.all([getCurrentUser(), getDb(), anonContext()]);
  const [res, index] = await Promise.all([
    discoverPicks(db, user?.id ?? null, { topic, cursor, length, sort }),
    loadTopics(db),
  ]);
  if (anon) await recordAnon(db, anon.anonId, anon.variant, "impression", res.picks.map((p) => p.id));
  const roots = groupedTopics(index).map((g) => g.root);

  const href = (next: Partial<{ topic: string | null; len: string | null; sort: string | null; page: number }>) => {
    const v = { topic, len: length as string | null, sort: sort === "top" ? null : (sort as string), page: 0, ...next };
    const q = new URLSearchParams();
    if (v.topic) q.set("topic", v.topic);
    if (v.len) q.set("len", v.len);
    if (v.sort && v.sort !== "top") q.set("sort", v.sort);
    if (v.page) q.set("page", String(v.page));
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <>
      <nav className="chips topic-filter" aria-label="Filter by topic">
        <Link className={topic ? "chip-link" : "chip-link on"} href={href({ topic: null })} aria-current={topic ? undefined : "page"}>All</Link>
        {roots.map((t) => (
          <Link key={t.slug} className={topic === t.slug ? "chip-link on" : "chip-link"} href={href({ topic: t.slug })} aria-current={topic === t.slug ? "page" : undefined}>
            {t.name}
          </Link>
        ))}
      </nav>
      <div className="feed-controls">
        <nav className="chips" aria-label="Filter by length">
          <Link className={length ? "chip-link" : "chip-link on"} href={href({ len: null })} aria-current={length ? undefined : "page"}>Any length</Link>
          {(Object.keys(LENGTHS) as LengthKey[]).map((k) => (
            <Link key={k} className={length === k ? "chip-link on" : "chip-link"} href={href({ len: k })} aria-current={length === k ? "page" : undefined}>
              {LENGTHS[k].label}
            </Link>
          ))}
        </nav>
        <nav className="chips" aria-label="Sort">
          {(Object.keys(SORTS) as SortKey[]).map((k) => (
            <Link key={k} className={sort === k ? "chip-link on" : "chip-link"} href={href({ sort: k })} aria-current={sort === k ? "page" : undefined}>
              {SORTS[k]}
            </Link>
          ))}
        </nav>
        <WatchedFilter ids={res.picks.map((p) => p.id)} />
      </div>
      <PublicPicks picks={res.picks} showReason={anon?.variant !== "nonote"} />
      <div className="more">
        {res.nextCursor !== null && <Link className="button ghost" href={href({ page: res.nextCursor })}>Show more</Link>}
        {res.hiddenByRules > 0 && <p className="muted">{plural(res.hiddenByRules, "video is", "videos are")} hidden by your <Link href="/settings/rules">rules</Link>.</p>}
      </div>
    </>
  );
}
