import { authConfigured, demoAuthAllowed } from "@/lib/auth/config";
import { oauthSignIn } from "@/app/actions";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { initials } from "@/lib/format";
import { createAccountAction, signInAs } from "@/app/actions";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  if (authConfigured()) return (
    <>
      <h1>Your next great find starts here.</h1>
      <p className="intro">Sign in to follow people whose taste you trust, save discoveries, and build your Circle.</p>
      <form action={oauthSignIn} className="actions">
        <button className="button" name="provider" value="google">Continue with Google</button>
        <button className="button ghost" name="provider" value="github">Continue with GitHub</button>
      </form>
      <Suspense fallback={null}><OAuthError searchParams={searchParams} /></Suspense>
    </>
  );
  if (!demoAuthAllowed()) return <><h1>Sign-in is being configured</h1><p>Check back soon.</p></>;  return (
    <>
      <h1>Sign in</h1>
      <p className="intro">
        Development sign-in. Start as a new person, or pick a demo account. Google and GitHub sign-in arrive with Supabase Auth.
      </p>
      <form action={createAccountAction} className="field">
        <label htmlFor="name">New here? Your name</label>
        <div className="actions" style={{ marginTop: 0 }}>
          <input id="name" name="name" required maxLength={60} autoComplete="name" placeholder="Sam Rivera" />
          <button className="button">Create an account</button>
        </div>
        <Suspense fallback={null}>
          <NameError searchParams={searchParams} />
        </Suspense>
      </form>
      <h2 className="eyebrow">Demo accounts</h2>
      <Suspense fallback={<p>Loading accounts…</p>}>
        <Accounts />
      </Suspense>
    </>
  );
}

async function NameError({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const sp = await searchParams;
  if (sp.error !== "name") return null;
  return <p className="error" role="alert">Enter a name of up to 60 characters.</p>;
}

async function Accounts() {
  await connection();
  const db = await getDb();
  const users = await db.query<{ username: string; display_name: string; bio: string | null }>(
    "select username, display_name, bio from users where not is_system order by trust_tier = 'founding', display_name",
  );
  return (
    <ul className="people">
      {users.map((u) => (
        <li key={u.username}>
          <span className="avatar" aria-hidden="true">{initials(u.display_name)}</span>
          <span className="grow">
            <strong>{u.display_name}</strong> <span className="trust-tag">@{u.username}</span>
            {u.bio && <small>{u.bio}</small>}
          </span>
          <form action={signInAs}>
            <input type="hidden" name="username" value={u.username} />
            <button className="button ghost">Continue as {u.display_name.split(" ")[0]}</button>
          </form>
        </li>
      ))}
    </ul>
  );
}

async function OAuthError({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const params = await searchParams;
  return params.error ? <p className="error" role="alert">Sign-in could not be completed. Please try again.</p> : null;
}