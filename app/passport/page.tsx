import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { ownPassport } from "@/lib/passport";
import { passportSettingsAction } from "@/app/passport/actions";
import { PassportView } from "./PassportView";

export const metadata: Metadata = { title: "Taste Passport" };

export default function PassportPage() {
  return (
    <>
      <header className="page-head">
        <h1>Your Taste Passport</h1>
        <p>What your vouches and Worth-it ratings say about your taste. Private unless you share it.</p>
      </header>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Own />
      </Suspense>
    </>
  );
}

async function Own() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const p = await ownPassport(await getDb(), user.id);
  if (!p) redirect("/signin");
  const publicPath = `/passport/${p.user.username}`;
  return (
    <>
      <PassportView p={p} />
      <form action={passportSettingsAction} className="panel stack passport-settings">
        <fieldset className="field">
          <legend>Sharing</legend>
          <div className="stack" style={{ gap: "0.9rem" }}>
            <label className="check">
              <input type="checkbox" name="public" defaultChecked={p.settings.isPublic} />
              <span>
                Make my Passport public
                <small>The public version uses only your vouches. Your Worth-it ratings stay private.</small>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" name="success" defaultChecked={p.settings.showSuccess} />
              <span>Show how my picks are rated on the public version</span>
            </label>
          </div>
        </fieldset>
        <div className="actions">
          <button className="button">Save sharing settings</button>
          {p.settings.isPublic && <Link href={publicPath}>View your public Passport</Link>}
        </div>
      </form>
    </>
  );
}
