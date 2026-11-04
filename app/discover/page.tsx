import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { getDb } from "@/lib/server/db";
import { publicPicks } from "@/lib/public";
import { PublicPicks } from "@/app/components/PublicPicks";

export const metadata = { title: "Discover worthwhile videos", description: "Video recommendations with a human reason to watch." };
export default function Discover() {
  return <>
    <h1>Worth a little of your time.</h1>
    <p className="intro">Explore videos people chose to vouch for. Each pick comes with a person behind it.</p>
    <p className="actions"><Link href="/signin" className="button">Build your Circle</Link></p>
    <Suspense fallback={<p>Loading recommendations…</p>}><Picks /></Suspense>
  </>;
}
async function Picks() {
  await connection();
  return <PublicPicks picks={await publicPicks(await getDb())} />;
}
