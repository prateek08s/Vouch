import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/server/session";
import { Avatar } from "@/app/components/Avatar";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <>
      <header className="page-head">
        <h1>Profile</h1>
        <p>How you appear next to your vouches and on your public page.</p>
      </header>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Profile />
      </Suspense>
    </>
  );
}

async function Profile() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return (
    <div className="split">
      <ProfileForm initial={{ username: user.username, displayName: user.display_name, bio: user.bio ?? "" }} />
      <aside className="stack">
        <div className="profile-head" style={{ marginBottom: 0 }}>
          <Avatar name={user.display_name} src={user.avatar_url} size="lg" />
          <div className="grow">
            <strong>{user.display_name}</strong>
            <span className="muted">@{user.username}</span>
          </div>
        </div>
        <p className="muted">Your picture comes from GitHub. Change it there and sign in again.</p>
        <p><Link href={`/u/${user.username}`}>View your public page</Link></p>
      </aside>
    </div>
  );
}
