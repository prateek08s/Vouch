import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/server/session";
import { deleteAccountAction } from "../actions";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage(props: PageProps<"/settings/account">) {
  return (
    <>
      <header className="page-head">
        <h1>Account</h1>
        <p>Download a copy of your data, or delete your account.</p>
      </header>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Account {...props} />
      </Suspense>
    </>
  );
}

async function Account({ searchParams }: PageProps<"/settings/account">) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const { error } = await searchParams;
  return (
    <div className="stack" style={{ maxWidth: "38rem" }}>
      <section className="panel stack" aria-labelledby="export-h">
        <h2 id="export-h" className="section-title">Download your data</h2>
        <p className="muted">Your profile, vouches, Worth-it ratings, follows, lists, rules and topics, as a JSON file.</p>
        <div className="actions"><a className="button ghost" href="/settings/account/export" download>Download my data</a></div>
      </section>
      <section className="panel stack" aria-labelledby="delete-h">
        <h2 id="delete-h" className="section-title">Delete your account</h2>
        <p className="muted">
          This permanently deletes your profile, vouches, ratings, follows, lists and rules, and signs you out.
          It can&apos;t be undone.
        </p>
        <form action={deleteAccountAction} className="field">
          <label htmlFor="confirm">Type your username, <strong>{user.username}</strong>, to confirm</label>
          <div className="create-row">
            <input id="confirm" name="confirm" type="text" className="input" autoComplete="off" required aria-invalid={error === "confirm"} />
            <button className="button danger-button">Delete account</button>
          </div>
          {error === "confirm" && <p className="error" role="alert">That doesn&apos;t match your username. Nothing was deleted.</p>}
        </form>
      </section>
    </div>
  );
}
