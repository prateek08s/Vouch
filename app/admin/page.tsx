import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { REASON_LABEL, openReports } from "@/lib/moderation";
import { plural } from "@/lib/format";
import { dismissReportsAction, hideVouchAction, suspendUserAction } from "./actions";

export const metadata: Metadata = { title: "Reports", robots: { index: false } };

/** Admin review queue: reported notes, grouped by vouch. Admins are set with users.is_admin. */
export default function AdminPage() {
  return (
    <>
      <header className="page-head">
        <h1>Reports</h1>
        <p>
          Notes people flagged. Hiding a vouch removes it everywhere; suspending an account signs it out and hides
          all its vouches. <Link href="/insights">Insights</Link>
        </p>
      </header>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Queue />
      </Suspense>
    </>
  );
}

async function Queue() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!user.is_admin) notFound();
  const reports = await openReports(await getDb());
  if (!reports.length) {
    return (
      <div className="empty">
        <strong>No open reports.</strong>
        <p>New reports from watch pages show up here.</p>
      </div>
    );
  }
  return (
    <ul className="queue">
      {reports.map((r) => (
        <li key={r.vouchId}>
          <p className="meta">
            {plural(r.reports, "report", "reports")}: {r.reasons.map((x) => REASON_LABEL[x]).join(", ")}
          </p>
          <p>
            <strong>{r.authorName}</strong> (@{r.authorUsername}) on{" "}
            <Link href={`/watch/${r.resourceId}`}>{r.title}</Link>
          </p>
          {r.note && <blockquote className="note">{r.note}</blockquote>}
          {r.details.length > 0 && (
            <ul className="meta">
              {r.details.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
          <div className="actions">
            <form action={hideVouchAction}>
              <input type="hidden" name="vouchId" value={r.vouchId} />
              <button type="submit" className="button small">Hide vouch</button>
            </form>
            <form action={dismissReportsAction}>
              <input type="hidden" name="vouchId" value={r.vouchId} />
              <button type="submit" className="button small ghost">Dismiss</button>
            </form>
            {!r.authorIsSystem && r.authorId !== user.id && (
              <form action={suspendUserAction}>
                <input type="hidden" name="userId" value={r.authorId} />
                <button type="submit" className="button small danger">Suspend @{r.authorUsername}</button>
              </form>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
