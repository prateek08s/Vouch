import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { publicPassport } from "@/lib/passport";
import { initials } from "@/lib/format";
import { PassportView } from "../PassportView";

// Generic on purpose: a title naming the person would hint that a private Passport exists.
export const metadata: Metadata = { title: "Taste Passport", description: "Someone's taste, in topics, from the videos they vouched for on Vouch." };

export default function PublicPassportPage(props: PageProps<"/passport/[username]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Public {...props} />
    </Suspense>
  );
}

/** Shared Passports only: anything else is a plain 404, so private ones cannot be probed. */
async function Public({ params }: PageProps<"/passport/[username]">) {
  await connection();
  const { username } = await params;
  const p = await publicPassport(await getDb(), decodeURIComponent(username));
  if (!p) notFound();
  return (
    <>
      <header className="profile-head">
        <span className="avatar lg" aria-hidden="true">{initials(p.user.displayName)}</span>
        <div className="grow">
          <p className="kicker" style={{ margin: 0 }}>Taste Passport</p>
          <h1>{p.user.displayName}</h1>
          <p className="muted">@{p.user.username}, from the videos they vouched for</p>
        </div>
      </header>
      <PassportView p={p} />
    </>
  );
}
