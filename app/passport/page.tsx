import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { ownPassport } from "@/lib/passport";
import { passportSettingsAction } from "@/app/actions";
import { PassportView } from "./PassportView";

export const metadata: Metadata = { title: "Taste Passport" };

export default function PassportPage() {
  return (
    <>
      <h1>Taste Passport</h1>
      <p className="intro">What your vouches and Worth-It ratings say about your taste. Private unless you share it.</p>
      <Suspense fallback={<p>Loading…</p>}>
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
      <form action={passportSettingsAction} className="stack passport-settings">
        <fieldset className="field">
          <legend>Sharing</legend>
          <label className="check">
            <input type="checkbox" name="public" defaultChecked={p.settings.isPublic} />
            <span>
              Make my Passport public
              <small className="trust-tag"> The public version uses only your vouches. Your Worth-It ratings stay private.</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" name="success" defaultChecked={p.settings.showSuccess} />
            <span>Show how my picks are rated on the public version</span>
          </label>
        </fieldset>
        <div className="actions">
          <button className="button">Save</button>
          {p.settings.isPublic && <Link href={publicPath}>View your public Passport ↗</Link>}
        </div>
      </form>
    </>
  );
}
