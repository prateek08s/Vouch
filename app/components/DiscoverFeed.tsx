import Link from "next/link";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { LENGTHS, SORTS, discoverPicks, type LengthKey, type SortKey } from "@/lib/public/discover";
import { discoverHref, parseDiscoverFilters } from "@/lib/public/discover-filters";
import { loadTopics, groupedTopics } from "@/lib/topics";
import { plural } from "@/lib/format";
import { recordAnon } from "@/lib/experiment";
import { anonContext } from "@/lib/experiment/server";
import { PublicPicks } from "./PublicPicks";
import { WatchedFilter } from "./local/WatchedFilter";

type SP = Record<string, string | string[] | undefined>;

/** `skip`: picks already featured above the feed, left out of its first unfiltered page. */
export async function DiscoverFeed({ searchParams, base, skip = [] }: { searchParams: Promise<SP>; base: string; skip?: string[] }) {
  const filters = parseDiscoverFilters(await searchParams);
  const { topics, length, sort, channel, maxMinutes } = filters;
  const [user, db, anon] = await Promise.all([getCurrentUser(), getDb(), anonContext()]);
  const [res, index] = await Promise.all([
    discoverPicks(db, user?.id ?? null, filters), loadTopics(db),
  ]);
  if (anon) await recordAnon(db, anon.anonId, anon.variant, "impression", res.picks.map((p) => p.id));
  const groups = groupedTopics(index);
  const href = (next: Parameters<typeof discoverHref>[2]) => discoverHref(base, filters, next);
  const active = topics.length > 0 || length !== null || channel !== "" || maxMinutes !== null;

  return (
    <>
      <nav className="chips topic-filter" aria-label="Filter by topic">
        <Link className={topics.length ? "chip-link" : "chip-link on"} href={href({ topics: [] })} aria-current={topics.length ? undefined : "page"}>All</Link>
        {groups.map(({ root: t }) => {
          const selected = topics.includes(t.slug);
          return (
            <Link key={t.slug} className={selected ? "chip-link on" : "chip-link"}
              href={href({ topics: selected ? topics.filter((slug) => slug !== t.slug) : [...topics, t.slug] })}
              aria-current={selected ? "page" : undefined}>
              {t.name}
            </Link>
          );
        })}
      </nav>
      <div className="feed-controls">
        <nav className="chips" aria-label="Filter by length">
          <Link className={length ? "chip-link" : "chip-link on"} href={href({ length: null })} aria-current={length ? undefined : "page"}>Any length</Link>
          {(Object.keys(LENGTHS) as LengthKey[]).map((k) => (
            <Link key={k} className={length === k ? "chip-link on" : "chip-link"} href={href({ length: k })} aria-current={length === k ? "page" : undefined}>{LENGTHS[k].label}</Link>
          ))}
        </nav>
        <nav className="chips" aria-label="Sort">
          {(Object.keys(SORTS) as SortKey[]).map((k) => (
            <Link key={k} className={sort === k ? "chip-link on" : "chip-link"} href={href({ sort: k })} aria-current={sort === k ? "page" : undefined}>{SORTS[k]}</Link>
          ))}
        </nav>
        <WatchedFilter ids={res.picks.map((p) => p.id)} />
      </div>
      <details className="discover-filters" open={channel !== "" || maxMinutes !== null || topics.length > 1 || topics.some((slug) => index.bySlug.get(slug)?.parentId !== null)}>
        <summary>More filters</summary>
        <form key={JSON.stringify(filters)} action={base} method="get" className="discover-filter-form">
          {length && <input type="hidden" name="len" value={length} />}
          {sort !== "top" && <input type="hidden" name="sort" value={sort} />}
          <label className="discover-topics">
            Topics
            <select aria-label="Topics" name="topic" multiple size={8} defaultValue={topics} aria-describedby="discover-topic-help">
              {groups.map((group) => (
                <optgroup key={group.root.slug} label={group.root.name}>
                  {group.topics.map((t) => <option key={t.slug} value={t.slug}>{t.depth ? "  ".repeat(t.depth) : ""}{t.name}</option>)}
                </optgroup>
              ))}
            </select>
            <span id="discover-topic-help" className="muted">Match any selected topic, including its subtopics. On desktop, hold Ctrl or Command to select more than one. Choose up to 20.</span>
          </label>
          <div className="discover-filter-fields">
            <label>Channel name
              <input type="search" name="channel" defaultValue={channel} maxLength={120} placeholder="For example, 3Blue1Brown" />
              <span className="muted">Matches part of a YouTube channel name.</span>
            </label>
            <label>Time available in minutes
              <input type="number" name="maxMinutes" defaultValue={maxMinutes ?? ""} min={1} max={1440} step={1} placeholder="For example, 30" />
              <span className="muted">Only videos with a known runtime that fits your time.</span>
            </label>
            <div className="actions">
              <button type="submit" className="button small">Apply filters</button>
              <Link href={base} className="button quiet small">Clear filters</Link>
            </div>
          </div>
        </form>
      </details>
      {active && <p className="section-note" role="status">
        {topics.length ? `Matching any of ${topics.length} selected ${topics.length === 1 ? "topic" : "topics"}. ` : ""}
        {channel && <>Channel contains “{channel}”. </>}
        {maxMinutes !== null && <>Up to {maxMinutes} minutes. </>}
        <Link href={base}>Clear filters</Link>
      </p>}
      <PublicPicks
        picks={!active && sort === "top" && !filters.cursor ? res.picks.filter((p) => !skip.includes(p.id)) : res.picks}
        showReason={anon?.variant !== "nonote"}
      />
      <div className="more">
        {res.nextCursor !== null && <Link className="button ghost" href={href({ cursor: res.nextCursor })}>Show more</Link>}
        {res.hiddenByRules > 0 && <p className="muted">{plural(res.hiddenByRules, "video is", "videos are")} hidden by your <Link href="/settings/rules">rules</Link>.</p>}
      </div>
    </>
  );
}
