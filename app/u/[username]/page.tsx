import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/server/db";
import { publicProfile } from "@/lib/public";
import { initials } from "@/lib/format";
import { PublicPicks } from "@/app/components/PublicPicks";

export default function ProfilePage(props: PageProps<"/u/[username]">) {
  return <Suspense fallback={<p className="muted">Loading curator…</p>}><Profile {...props} /></Suspense>;
}

async function Profile({ params }: PageProps<"/u/[username]">) {
  await connection();
  const { username } = await params;
  if (!/^[a-z0-9_]{3,24}$/.test(username)) notFound();
  const profile = await publicProfile(await getDb(), username);
  if (!profile) notFound();
  return (
    <>
      <header className="profile-head">
        <span className="avatar lg" aria-hidden="true">{initials(profile.display_name)}</span>
        <div className="grow">
          <h1>{profile.display_name}</h1>
          <p className="muted">@{profile.username}</p>
          {profile.bio && <p>{profile.bio}</p>}
        </div>
        <Link className="button ghost" href="/people">Find people to follow</Link>
      </header>

      {profile.lists.length > 0 && (
        <section className="section" aria-labelledby="lists-h">
          <h2 id="lists-h" className="section-title">Lists</h2>
          <ul className="rows">
            {profile.lists.map((l) => (
              <li key={l.id}>
                <span className="grow">
                  <Link href={`/lists/${l.id}`}>{l.title}</Link>
                  {l.description && <span className="desc">{l.description}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section" aria-labelledby="picks-h">
        <h2 id="picks-h" className="section-title">Vouched for</h2>
        <PublicPicks picks={profile.picks} showCurator={false} />
      </section>
    </>
  );
}
