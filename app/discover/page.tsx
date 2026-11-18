import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { getDb } from "@/lib/server/db";
import { publicPicks } from "@/lib/public";
import { PublicPicks } from "@/app/components/PublicPicks";

export const metadata = { title: "Discover worthwhile videos", description: "Video recommendations with a human reason to watch." };

export default function Discover() {
  return (
    <>
      <header className="page-head">
        <h1>Discover</h1>
        <p>The latest public vouches from everyone on Vouch. Each one has a person and a reason behind it.</p>
        <div className="actions">
          <Link href="/people" className="button ghost">Find people to follow</Link>
        </div>
      </header>
      <Suspense fallback={<p className="muted">Loading recommendations…</p>}>
        <Picks />
      </Suspense>
    </>
  );
}

async function Picks() {
  await connection();
  return <PublicPicks picks={await publicPicks(await getDb())} />;
}
