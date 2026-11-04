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
      <h1>Rules</h1>
      <p className="intro">
        Your rules are absolute. They run before ranking, in every feed, and popularity never overrides them.
      </p>
      <Suspense fallback={<p>Loading your rules…</p>}>
        <Rules />
      </Suspense>
    </>
  );
}

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
      .map((t) => ({ slug: t.slug, name: t.depth === 0 ? `${t.name} (all)` : `${"  ".repeat(t.depth - 1)}${t.name}` })),
  }));

  return (
    <>
      <section aria-labelledby="active-h">
        <h2 id="active-h" className="eyebrow">Active rules</h2>
        {active.length === 0 ? (
          <p className="empty">No rules yet. Everything your circle vouches for can appear.</p>
        ) : (
          <ul className="people">
            {active.map((r) => (
              <li key={r.id}>
                <span className="grow">{describeRule(r, lookups)}</span>
                <form action={deleteRuleAction}>
                  <input type="hidden" name="ruleId" value={r.id} />
                  <button className="button ghost" aria-label={`Remove rule: ${describeRule(r, lookups)}`}>Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="trust-tag">To block a channel, open one of its videos and choose “Never show this channel”.</p>
      </section>

      <RuleControls topicOptions={topicOptions} hasNoShorts={has("no_shorts")} />
    </>
  );
}
