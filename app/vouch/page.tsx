import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { socialEnabled } from "@/lib/flags";
import { groupedTopics, loadTopics } from "@/lib/topics";
import { DAILY_LIMIT, remainingVouchesToday } from "@/lib/vouches";
import { VouchComposer } from "./VouchComposer";

export const metadata: Metadata = { title: "Vouch for a video" };

export default function VouchPage() {
  return (
    <>
      <header className="page-head">
        <h1>Vouch for a video</h1>
        <p>Found something genuinely worth another person’s time? Put your name on it.</p>
      </header>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Composer />
      </Suspense>
    </>
  );
}

async function Composer() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  // Public vouching waits for the social layer; admins can still add picks (lib/flags).
  if (!socialEnabled() && !user.is_admin) notFound();
  const db = await getDb();
  const [topics, remaining] = await Promise.all([loadTopics(db), remainingVouchesToday(db, user.id)]);

  // Grouped as a tree so 42 topics stay scannable: Hardware sits right before CPU and GPU.
  const groups = groupedTopics(topics).map((g) => ({
    name: g.root.name,
    topics: g.topics.map((t) => ({ slug: t.slug, name: t.name })),
  }));
  return <VouchComposer groups={groups} remaining={remaining} limit={DAILY_LIMIT[user.trust_tier] ?? remaining} />;
}
