import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { listRules } from "@/lib/rules";
import { describeRule, sortRules } from "@/lib/rules/describe";
import { groupedTopics, loadTopics } from "@/lib/topics";
import { deleteRuleAction } from "@/app/actions";
import { RuleControls } from "./RuleControls";

export const metadata: Metadata = { title: "Rules" };

export default function RulesPage() {
  return (
    <>
      <header className="page-head">
        <h1>Rules</h1>
        <p>Your rules are absolute. They run before ranking in your Circle, your lists and search, and popularity never overrides them.</p>
      </header>
      <Suspense fallback={<p className="muted">Loading your rules…</p>}>
        <Rules />
      </Suspense>
    </>
  );
}

const KIND_ICON: Record<string, React.ReactNode> = {
  channel: <path d="M3 5.5h14v9H3zM8.5 8v4l3.5-2z" />,
  topic: <path d="M4 4h5l7 7-5 5-7-7zM7 7h.01" />,
  keyword: <path d="M5 5h10M10 5v10M7 15h6" />,
  min_duration: <path d="M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM10 7v3l2 1.5" />,
  max_duration: <path d="M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM10 7v3l2 1.5" />,
  no_shorts: <path d="M7 3.5h6v13H7zM4 4l12 12" />,
};

async function Rules() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const db = await getDb();
  const [rules, topics] = await Promise.all([listRules(db, user.id), loadTopics(db)]);

  const channelIds = rules.filter((r) => r.kind === "channel").map((r) => r.value);
  const channels = channelIds.length
    ? await db.query<{ id: string; name: string }>(
        `select distinct on (creator_external_id) creator_external_id as id, creator_name as name
         from resources where creator_external_id = any($1::text[]) and creator_name is not null`,
        [channelIds],
      )
    : [];
  const lookups = {
    channelNames: new Map(channels.map((c) => [c.id, c.name])),
    topicNames: new Map([...topics.bySlug.values()].map((t) => [t.slug, t.name])),
  };
  const active = sortRules(rules);
  const has = (kind: string) => rules.some((r) => r.kind === kind);
  const blocked = new Set(rules.filter((r) => r.kind === "topic").map((r) => r.value));
  const topicOptions = groupedTopics(topics).map((g) => ({
    group: g.root.name,
    options: g.topics
      .filter((t) => !blocked.has(t.slug))
      .map((t) => ({ slug: t.slug, name: t.depth === 0 ? `${t.name} (all)` : `${"  ".repeat(t.depth - 1)}${t.name}` })),
  }));

  return (
    <div className="split">
      <section aria-labelledby="active-h">
        <h2 id="active-h" className="section-title">Active rules</h2>
        {active.length === 0 ? (
          <p className="section-note">No rules yet. Everything your circle vouches for can appear.</p>
        ) : (
          <ul className="rows">
            {active.map((r) => (
              <li key={r.id}>
                <span className="rule-kind" aria-hidden="true">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    {KIND_ICON[r.kind] ?? KIND_ICON.keyword}
                  </svg>
                </span>
                <span className="grow">{describeRule(r, lookups)}</span>
                <form action={deleteRuleAction}>
                  <input type="hidden" name="ruleId" value={r.id} />
                  <button className="button ghost small" aria-label={`Remove rule: ${describeRule(r, lookups)}`}>Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="hint" style={{ marginTop: "1rem" }}>To block a channel, open one of its videos and choose “Never show” under the player.</p>
      </section>

      <RuleControls topicOptions={topicOptions} hasNoShorts={has("no_shorts")} />
    </div>
  );
}
