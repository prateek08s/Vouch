import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { publicProfile } from "@/lib/public";
import { PublicPicks } from "@/app/components/PublicPicks";
import Link from "next/link";

export default function ProfilePage(props: PageProps<"/u/[username]">) {
  return <Suspense fallback={<p>Loading curator…</p>}><Profile {...props} /></Suspense>;
}
async function Profile({ params }: PageProps<"/u/[username]">) {
  await connection();
  const { username } = await params;
  if (!/^[a-z0-9_]{3,24}$/.test(username)) notFound();
  const profile = await publicProfile(await getDb(), username);
  if (!profile) notFound();
  return <>
    <p className="screening-kicker">@{profile.username}</p>
    <h1>{profile.display_name}</h1>
    {profile.bio && <p className="intro">{profile.bio}</p>}
    <p><Link className="button" href="/people">Find people to follow</Link></p>
    <h2>Vouched for</h2>
    <PublicPicks picks={profile.picks} />
  </>;
}
