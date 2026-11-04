import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { groupedTopics, loadTopics } from "@/lib/topics";
import { remainingVouchesToday } from "@/lib/vouches";
import { VouchComposer } from "./VouchComposer";

export const metadata: Metadata = { title: "Vouch" };

export default function VouchPage() {
  return (
    <>
      <h1>Vouch</h1>
      <p className="intro">Found something genuinely worth another person’s time? Put your name on it.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <Composer />
      </Suspense>
    </>
  );
}

async function Composer() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const db = await getDb();
  const [topics, remaining] = await Promise.all([loadTopics(db), remainingVouchesToday(db, user.id)]);

  // Grouped as a tree so 42 topics stay scannable: Hardware sits right before CPU and GPU.
  const groups = groupedTopics(topics).map((g) => ({
    name: g.root.name,
    topics: g.topics.map((t) => ({ slug: t.slug, name: t.name })),
  }));
  return <VouchComposer groups={groups} remaining={remaining} />;
}
